import {
	type Api,
	type Context,
	type Model,
	type SimpleStreamOptions,
	streamSimpleAnthropic,
	streamSimpleOpenAICompletions,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI, ProviderModelConfig } from "@mariozechner/pi-coding-agent";

const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_TOKENS = 32768;
export const ZENMUX_MODELS_URL = "https://zenmux.ai/api/v1/models";
export const MODELS_DEV_URL = "https://models.dev/api.json";

export const ZENMUX_BASE_URL = (process.env.ZENMUX_BASE_URL || "https://zenmux.ai").replace(/\/$/, "");
export const ZENMUX_OPENAI_BASE_URL = `${ZENMUX_BASE_URL}/api/v1`;
export const ZENMUX_ANTHROPIC_BASE_URL = `${ZENMUX_BASE_URL}/api/anthropic`;
export const ZENMUX_ROUTER_API = "zenmux-router";

type PricingTier = {
	value?: number;
	conditions?: {
		prompt_tokens?: {
			gte?: number;
		};
	};
};

type ZenmuxRawModel = {
	id?: string;
	display_name?: string;
	owned_by?: string;
	input_modalities?: string[];
	capabilities?: {
		reasoning?: boolean;
	};
	pricings?: {
		prompt?: PricingTier[];
		completion?: PricingTier[];
		input_cache_read?: PricingTier[];
		input_cache_write_5_min?: PricingTier[];
	};
	context_length?: number | string;
};

type ZenmuxModelsPayload = {
	data?: ZenmuxRawModel[];
};

function toPositiveInt(value: unknown, fallback: number): number {
	const num = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(num) || num <= 0) return fallback;
	return Math.floor(num);
}

function getBasePrice(items: PricingTier[] | undefined): number {
	if (!Array.isArray(items) || items.length === 0) return 0;

	const baseline = items.find((item) => {
		if (!item || typeof item !== "object") return false;
		const promptTokens = item.conditions?.prompt_tokens;
		return !item.conditions || (promptTokens?.gte ?? 0) === 0;
	});

	const value = baseline?.value ?? items[0]?.value ?? 0;
	return Number.isFinite(value) ? value : 0;
}

function isAnthropicModel(model: ZenmuxRawModel): boolean {
	return model.owned_by === "anthropic" || String(model.id || "").startsWith("anthropic/");
}

function resolveModelsDevMaxTokens(model: Record<string, unknown>): number | undefined {
	const limit = typeof model.limit === "object" && model.limit ? (model.limit as Record<string, unknown>) : undefined;

	const candidates = [
		limit?.output,
		limit?.max_output_tokens,
		limit?.max_tokens,
		model.max_output_tokens,
		model.max_tokens,
		model.output_tokens,
	];

	for (const candidate of candidates) {
		const parsed = toPositiveInt(candidate, 0);
		if (parsed > 0) return parsed;
	}

	return undefined;
}

function buildModelsDevMaxTokensMap(modelsDevPayload: Record<string, unknown>): Map<string, number> {
	const map = new Map<string, number>();

	for (const providerValue of Object.values(modelsDevPayload)) {
		if (!providerValue || typeof providerValue !== "object") continue;
		const models = (providerValue as { models?: Record<string, unknown> }).models;
		if (!models || typeof models !== "object") continue;

		for (const [modelId, modelInfo] of Object.entries(models)) {
			if (!modelInfo || typeof modelInfo !== "object") continue;
			const maxTokens = resolveModelsDevMaxTokens(modelInfo as Record<string, unknown>);
			if (!maxTokens) continue;
			map.set(modelId, maxTokens);
		}
	}

	return map;
}

function toProviderModel(rawModel: ZenmuxRawModel, modelsDevMaxTokens: Map<string, number>): ProviderModelConfig | null {
	const id = String(rawModel.id || "").trim();
	if (!id) return null;

	const supportsImage = Array.isArray(rawModel.input_modalities) && rawModel.input_modalities.includes("image");
	const maxTokensFromModelsDev = modelsDevMaxTokens.get(id);

	return {
		id,
		name: String(rawModel.display_name || id),
		api: isAnthropicModel(rawModel) ? "anthropic-messages" : "openai-completions",
		reasoning: Boolean(rawModel.capabilities?.reasoning),
		input: supportsImage ? ["text", "image"] : ["text"],
		cost: {
			input: getBasePrice(rawModel.pricings?.prompt),
			output: getBasePrice(rawModel.pricings?.completion),
			cacheRead: getBasePrice(rawModel.pricings?.input_cache_read),
			cacheWrite: getBasePrice(rawModel.pricings?.input_cache_write_5_min),
		},
		contextWindow: toPositiveInt(rawModel.context_length, DEFAULT_CONTEXT_WINDOW),
		maxTokens: maxTokensFromModelsDev ?? DEFAULT_MAX_TOKENS,
	};
}

const FETCH_TIMEOUT_MS = 15_000;

async function fetchJson<T>(url: string, timeoutMs: number = FETCH_TIMEOUT_MS): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			method: "GET",
			headers: { Accept: "application/json" },
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(`${url} -> HTTP ${response.status}`);
		}

		return (await response.json()) as T;
	} finally {
		clearTimeout(timer);
	}
}

export async function fetchZenmuxProviderModels(): Promise<ProviderModelConfig[]> {
	const [zenmuxPayload, modelsDevPayload] = await Promise.all([
		fetchJson<ZenmuxModelsPayload>(ZENMUX_MODELS_URL),
		fetchJson<Record<string, unknown>>(MODELS_DEV_URL).catch(() => undefined),
	]);

	const zenmuxModels = Array.isArray(zenmuxPayload?.data) ? zenmuxPayload.data : [];
	if (zenmuxModels.length === 0) {
		throw new Error("ZenMux model list is empty");
	}

	const modelsDevMaxTokens = modelsDevPayload
		? buildModelsDevMaxTokensMap(modelsDevPayload)
		: new Map<string, number>();

	const uniqueModels = new Map<string, ProviderModelConfig>();
	for (const rawModel of zenmuxModels) {
		const model = toProviderModel(rawModel, modelsDevMaxTokens);
		if (!model) continue;
		uniqueModels.set(model.id, model);
	}

	const models = [...uniqueModels.values()].sort((a, b) => a.id.localeCompare(b.id));
	if (models.length === 0) {
		throw new Error("No valid models fetched");
	}

	return models;
}

export function routeModel(model: Model<Api>): Model<Api> {
	if (model.id.startsWith("anthropic/")) {
		const { compat: _compat, ...rest } = model as Model<Api> & { compat?: unknown };
		return {
			...rest,
			api: "anthropic-messages",
			baseUrl: ZENMUX_ANTHROPIC_BASE_URL,
		};
	}

	return {
		...model,
		api: "openai-completions",
		baseUrl: ZENMUX_OPENAI_BASE_URL,
	};
}

export function asZenmuxRouterModels(models: ProviderModelConfig[]): ProviderModelConfig[] {
	return models.map((model) => ({
		...model,
		api: ZENMUX_ROUTER_API,
	}));
}

export function streamSimpleZenmux(model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
	const routedModel = routeModel(model);
	if (routedModel.api === "anthropic-messages") {
		return streamSimpleAnthropic(routedModel as Model<"anthropic-messages">, context, options);
	}
	return streamSimpleOpenAICompletions(routedModel as Model<"openai-completions">, context, options);
}

export default async function registerZenmuxProvider(pi: ExtensionAPI): Promise<void> {
	const models = await fetchZenmuxProviderModels();
	pi.registerProvider("zenmux", {
		name: "ZenMux",
		baseUrl: ZENMUX_OPENAI_BASE_URL,
		apiKey: "$ZENMUX_API_KEY",
		api: ZENMUX_ROUTER_API,
		models: asZenmuxRouterModels(models),
		streamSimple: streamSimpleZenmux,
	});
}
import {
	type Api,
	type Context,
	type Model,
	type SimpleStreamOptions,
	streamSimpleAnthropic,
	streamSimpleOpenAICompletions,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI, ProviderModelConfig } from "@mariozechner/pi-coding-agent";

export const ZENMUX_BASE_URL = (process.env.ZENMUX_BASE_URL || "https://zenmux.ai").replace(/\/$/, "");
export const ZENMUX_OPENAI_BASE_URL = `${ZENMUX_BASE_URL}/api/v1`;
export const ZENMUX_ANTHROPIC_BASE_URL = `${ZENMUX_BASE_URL}/api/anthropic`;
export const ZENMUX_ROUTER_API = "zenmux-router";

export const MODEL_DISCOVERY_TIMEOUT_MS = 8000;
export const DEFAULT_CONTEXT_WINDOW = 128000;
export const DEFAULT_MAX_TOKENS = 32768;

export interface ZenmuxPricingItem {
	value: number;
	unit?: string;
	currency?: string;
	conditions?: {
		prompt_tokens?: { gte?: number; gt?: number; lt?: number | null; lte?: number };
	};
}

export interface ZenmuxModel {
	id: string;
	display_name?: string;
	owned_by?: string;
	input_modalities?: string[];
	capabilities?: { reasoning?: boolean };
	context_length?: number;
	pricings?: {
		prompt?: ZenmuxPricingItem[];
		completion?: ZenmuxPricingItem[];
		input_cache_read?: ZenmuxPricingItem[];
		input_cache_write_5_min?: ZenmuxPricingItem[];
	};
}

interface ZenmuxModelsResponse {
	data?: ZenmuxModel[];
}

export const FALLBACK_MODELS: ProviderModelConfig[] = [
	{
		id: "anthropic/claude-opus-4.6",
		name: "Anthropic: Claude Opus 4.6",
		api: "anthropic-messages",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
		contextWindow: 1000000,
		maxTokens: 32768,
	},
	{
		id: "anthropic/claude-sonnet-4.6",
		name: "Anthropic: Claude Sonnet 4.6",
		api: "anthropic-messages",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		contextWindow: 1000000,
		maxTokens: 32768,
	},
	{
		id: "anthropic/claude-haiku-4.5",
		name: "Anthropic: Claude Haiku 4.5",
		api: "anthropic-messages",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
		contextWindow: 200000,
		maxTokens: 32768,
	},
	{
		id: "openai/gpt-5.3-codex",
		name: "OpenAI: GPT-5.3-Codex",
		api: "openai-completions",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
		contextWindow: 400000,
		maxTokens: 32768,
	},
	{
		id: "openai/gpt-5.3-chat",
		name: "OpenAI: GPT-5.3 Chat",
		api: "openai-completions",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 32768,
	},
	{
		id: "google/gemini-3.1-pro-preview",
		name: "Google: Gemini 3.1 Pro Preview",
		api: "openai-completions",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0.8333333333333334 },
		contextWindow: 1048576,
		maxTokens: 32768,
	},
	{
		id: "google/gemini-3.1-flash-lite-preview",
		name: "Google: Gemini 3.1 Flash Lite Preview",
		api: "openai-completions",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0.25, output: 1.5, cacheRead: 0.024999999999999998, cacheWrite: 0.08333333333333334 },
		contextWindow: 1048576,
		maxTokens: 65536,
	},
	{
		id: "deepseek/deepseek-v3.2",
		name: "DeepSeek: DeepSeek V3.2",
		api: "openai-completions",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.28, output: 0.43, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 32768,
	},
	{
		id: "z-ai/glm-5",
		name: "Z.AI: GLM 5",
		api: "openai-completions",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.58, output: 2.6, cacheRead: 0.14, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 32768,
	},
	{
		id: "minimax/minimax-m2.5",
		name: "MiniMax: MiniMax M2.5",
		api: "openai-completions",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 32768,
	},
	{
		id: "moonshotai/kimi-k2.5",
		name: "MoonshotAI: Kimi K2.5",
		api: "openai-completions",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 32768,
	},
];

export function isAnthropicModel(model: Pick<ZenmuxModel, "id" | "owned_by">): boolean {
	return model.owned_by === "anthropic" || model.id.startsWith("anthropic/");
}

export function getBasePrice(items?: ZenmuxPricingItem[]): number {
	if (!items || items.length === 0) return 0;

	const baseline = items.find((item) => !item.conditions || (item.conditions.prompt_tokens?.gte ?? 0) === 0);
	const value = baseline?.value ?? items[0]?.value ?? 0;
	return Number.isFinite(value) ? value : 0;
}

export function toPositiveInt(value: unknown, fallback: number): number {
	const num = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(num) || num <= 0) return fallback;
	return Math.floor(num);
}

export function toProviderModel(model: ZenmuxModel): ProviderModelConfig | null {
	const id = model.id?.trim();
	if (!id) return null;

	const supportsImage = model.input_modalities?.includes("image") ?? false;
	const pricing = model.pricings;

	return {
		id,
		name: model.display_name?.trim() || id,
		api: isAnthropicModel(model) ? "anthropic-messages" : "openai-completions",
		reasoning: model.capabilities?.reasoning ?? false,
		input: supportsImage ? ["text", "image"] : ["text"],
		cost: {
			input: getBasePrice(pricing?.prompt),
			output: getBasePrice(pricing?.completion),
			cacheRead: getBasePrice(pricing?.input_cache_read),
			cacheWrite: getBasePrice(pricing?.input_cache_write_5_min),
		},
		contextWindow: toPositiveInt(model.context_length, DEFAULT_CONTEXT_WINDOW),
		maxTokens: DEFAULT_MAX_TOKENS,
	};
}

interface FetchZenmuxModelsOptions {
	timeoutMs?: number;
	fetcher?: typeof fetch;
	logger?: Pick<Console, "log" | "warn">;
}

export async function fetchZenmuxModels(options: FetchZenmuxModelsOptions = {}): Promise<ProviderModelConfig[]> {
	const timeoutMs = options.timeoutMs ?? MODEL_DISCOVERY_TIMEOUT_MS;
	const fetcher = options.fetcher ?? fetch;
	const logger = options.logger ?? console;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetcher(`${ZENMUX_OPENAI_BASE_URL}/models`, {
			method: "GET",
			signal: controller.signal,
			headers: { Accept: "application/json" },
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}

		const payload = (await response.json()) as ZenmuxModelsResponse;
		if (!Array.isArray(payload.data) || payload.data.length === 0) {
			throw new Error("Empty model list");
		}

		const uniqueModels = new Map<string, ProviderModelConfig>();
		for (const rawModel of payload.data) {
			const model = toProviderModel(rawModel);
			if (!model) continue;
			uniqueModels.set(model.id, model);
		}

		if (uniqueModels.size === 0) {
			throw new Error("No valid models");
		}

		logger.log(`[pi-zenmux] Loaded ${uniqueModels.size} models from ZenMux.`);
		return [...uniqueModels.values()];
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		logger.warn(`[pi-zenmux] Failed to discover models (${reason}), using ${FALLBACK_MODELS.length} fallback models.`);
		return FALLBACK_MODELS;
	} finally {
		clearTimeout(timeout);
	}
}

export function routeModel(model: Model<Api>): Model<Api> {
	if (model.api === "anthropic-messages" || model.id.startsWith("anthropic/")) {
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
	const models = await fetchZenmuxModels();
	const routerModels = asZenmuxRouterModels(models);

	pi.registerProvider("zenmux", {
		baseUrl: ZENMUX_OPENAI_BASE_URL,
		apiKey: "ZENMUX_API_KEY",
		api: ZENMUX_ROUTER_API,
		models: routerModels,
		streamSimple: streamSimpleZenmux,
	});
}

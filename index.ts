import {
	type Api,
	type Context,
	type Model,
	type SimpleStreamOptions,
	streamSimpleAnthropic,
	streamSimpleOpenAICompletions,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI, ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import { ZENMUX_MODELS } from "./zenmux-models.generated.js";

export const ZENMUX_BASE_URL = (process.env.ZENMUX_BASE_URL || "https://zenmux.ai").replace(/\/$/, "");
export const ZENMUX_OPENAI_BASE_URL = `${ZENMUX_BASE_URL}/api/v1`;
export const ZENMUX_ANTHROPIC_BASE_URL = `${ZENMUX_BASE_URL}/api/anthropic`;
export const ZENMUX_ROUTER_API = "zenmux-router";

export const ZENMUX_MODELS_SNAPSHOT: ProviderModelConfig[] = ZENMUX_MODELS;

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

export default function registerZenmuxProvider(pi: ExtensionAPI): void {
	pi.registerProvider("zenmux", {
		baseUrl: ZENMUX_OPENAI_BASE_URL,
		apiKey: "ZENMUX_API_KEY",
		api: ZENMUX_ROUTER_API,
		models: asZenmuxRouterModels(ZENMUX_MODELS_SNAPSHOT),
		streamSimple: streamSimpleZenmux,
	});
}

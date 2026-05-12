import assert from "node:assert/strict";
import test from "node:test";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ProviderConfig } from "@mariozechner/pi-coding-agent";
import registerZenmuxProvider, {
	MODELS_DEV_URL,
	ZENMUX_ANTHROPIC_BASE_URL,
	ZENMUX_MODELS_URL,
	ZENMUX_OPENAI_BASE_URL,
	ZENMUX_ROUTER_API,
	asZenmuxRouterModels,
	fetchZenmuxProviderModels,
	routeModel,
} from "./index.js";

function makeModel(overrides: Partial<Model<Api>> = {}): Model<Api> {
	return {
		id: "openai/gpt-5.3-chat",
		name: "OpenAI: GPT-5.3 Chat",
		api: ZENMUX_ROUTER_API,
		provider: "zenmux",
		baseUrl: ZENMUX_OPENAI_BASE_URL,
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 32768,
		...overrides,
	};
}

function jsonResponse(payload: unknown): Response {
	return new Response(JSON.stringify(payload), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

test("fetchZenmuxProviderModels fetches live models and merges maxTokens", async () => {
	const originalFetch = globalThis.fetch;
	const calledUrls: string[] = [];

	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		calledUrls.push(url);

		if (url === ZENMUX_MODELS_URL) {
			return jsonResponse({
				data: [
					{
						id: "openai/gpt-5.3-chat",
						display_name: "OpenAI: GPT-5.3 Chat",
						owned_by: "openai",
						input_modalities: ["text", "image"],
						capabilities: { reasoning: true },
						context_length: 256000,
						pricings: {
							prompt: [{ value: 1.75 }],
							completion: [{ value: 14 }],
							input_cache_read: [{ value: 0.175 }],
							input_cache_write_5_min: [{ value: 0 }],
						},
					},
					{
						id: "anthropic/claude-sonnet-4.6",
						display_name: "Anthropic: Claude Sonnet 4.6",
						owned_by: "anthropic",
						input_modalities: ["text"],
						capabilities: { reasoning: false },
						context_length: 200000,
						pricings: {
							prompt: [{ value: 3 }],
							completion: [{ value: 15 }],
						},
					},
				],
			});
		}

		if (url === MODELS_DEV_URL) {
			return jsonResponse({
				openai: {
					models: {
						"openai/gpt-5.3-chat": {
							limit: { max_output_tokens: 16384 },
						},
					},
				},
				anthropic: {
					models: {
						"anthropic/claude-sonnet-4.6": {
							max_tokens: 8192,
						},
					},
				},
			});
		}

		throw new Error(`unexpected fetch URL: ${url}`);
	}) as typeof fetch;

	try {
		const models = await fetchZenmuxProviderModels();
		assert.ok(calledUrls.includes(ZENMUX_MODELS_URL));
		assert.ok(calledUrls.includes(MODELS_DEV_URL));
		assert.equal(models.length, 2);

		const anthropic = models.find((model) => model.id === "anthropic/claude-sonnet-4.6");
		assert.ok(anthropic);
		assert.equal(anthropic.api, "anthropic-messages");
		assert.equal(anthropic.maxTokens, 8192);
		assert.deepEqual(anthropic.input, ["text"]);

		const openai = models.find((model) => model.id === "openai/gpt-5.3-chat");
		assert.ok(openai);
		assert.equal(openai.api, "openai-completions");
		assert.equal(openai.maxTokens, 16384);
		assert.deepEqual(openai.input, ["text", "image"]);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("registerZenmuxProvider registers live model list", async () => {
	const originalFetch = globalThis.fetch;
	let providerName = "";
	let providerConfig: ProviderConfig | undefined;

	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		if (url === ZENMUX_MODELS_URL) {
			return jsonResponse({
				data: [
					{
						id: "openai/gpt-5.3-chat",
						display_name: "OpenAI: GPT-5.3 Chat",
						owned_by: "openai",
						input_modalities: ["text"],
						capabilities: { reasoning: true },
						context_length: 128000,
						pricings: { prompt: [{ value: 1 }], completion: [{ value: 1 }] },
					},
				],
			});
		}

		if (url === MODELS_DEV_URL) {
			return jsonResponse({
				openai: {
					models: {
						"openai/gpt-5.3-chat": {
							max_output_tokens: 12345,
						},
					},
				},
			});
		}

		throw new Error(`unexpected fetch URL: ${url}`);
	}) as typeof fetch;

	const pi = {
		registerProvider(name: string, config: ProviderConfig) {
			providerName = name;
			providerConfig = config;
		},
	} as unknown as ExtensionAPI;

	try {
		await registerZenmuxProvider(pi);
		assert.equal(providerName, "zenmux");
		assert.equal(providerConfig?.name, "ZenMux");
		assert.equal(providerConfig?.api, ZENMUX_ROUTER_API);
		assert.equal(providerConfig?.models?.length, 1);
		assert.equal(providerConfig?.models?.[0]?.api, ZENMUX_ROUTER_API);
		assert.equal(providerConfig?.models?.[0]?.maxTokens, 12345);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("routeModel routes anthropic ids to anthropic endpoint", () => {
	const routed = routeModel(
		makeModel({
			id: "anthropic/claude-sonnet-4.6",
		}),
	);

	assert.equal(routed.api, "anthropic-messages");
	assert.equal(routed.baseUrl, ZENMUX_ANTHROPIC_BASE_URL);
});

test("routeModel routes non-anthropic ids to openai endpoint", () => {
	const routed = routeModel(
		makeModel({
			id: "openai/gpt-5.3-codex",
		}),
	);

	assert.equal(routed.api, "openai-completions");
	assert.equal(routed.baseUrl, ZENMUX_OPENAI_BASE_URL);
});

test("asZenmuxRouterModels forces all model APIs to zenmux-router", () => {
	const models = asZenmuxRouterModels([
		{
			id: "anthropic/claude-opus-4.6",
			name: "Anthropic: Claude Opus 4.6",
			api: "anthropic-messages",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
			contextWindow: 1000000,
			maxTokens: 8192,
		},
		{
			id: "openai/gpt-5.3-chat",
			name: "OpenAI: GPT-5.3 Chat",
			api: "openai-completions",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 16384,
		},
	]);

	assert.equal(models.length, 2);
	assert.equal(models[0]?.api, ZENMUX_ROUTER_API);
	assert.equal(models[1]?.api, ZENMUX_ROUTER_API);
});
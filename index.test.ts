import assert from "node:assert/strict";
import test from "node:test";
import type { Api, Model, RefreshModelsContext } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ProviderConfig, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import registerZenmuxProvider, {
	MODELS_DEV_URL,
	ZENMUX_ANTHROPIC_BASE_URL,
	ZENMUX_ENDPOINT_CATALOG_URL,
	ZENMUX_MODELS_URL,
	ZENMUX_OPENAI_BASE_URL,
	ZENMUX_PROVIDER_ID,
	fetchZenmuxProviderModels,
	refreshZenmuxModels,
	restoreModels,
	routingFor,
} from "./index.js";

function jsonResponse(payload: unknown): Response {
	return new Response(JSON.stringify(payload), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

function requestUrl(input: string | URL | Request): string {
	return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

/** ZenMux catalog with one Anthropic model, one OpenAI model, and one video model. */
const ZENMUX_CATALOG = {
	data: [
		{
			id: "anthropic/claude-opus-5",
			display_name: "Anthropic: Claude Opus 5",
			owned_by: "anthropic",
			input_modalities: ["text", "image", "file"],
			output_modalities: ["text"],
			capabilities: { reasoning: true },
			context_length: 1000000,
			pricings: {
				prompt: [{ value: 5 }],
				completion: [{ value: 25 }],
				input_cache_read: [{ value: 0.5 }],
				input_cache_write_5_min: [{ value: 6.25 }],
				input_cache_write_1_h: [{ value: 10 }],
			},
		},
		{
			id: "openai/gpt-6-sol",
			display_name: "OpenAI: GPT-6 Sol",
			owned_by: "openai",
			input_modalities: ["text", "image"],
			output_modalities: ["text"],
			capabilities: { reasoning: true },
			context_length: 1050000,
			pricings: {
				// Tiers arrive as quoted strings for the newest models.
				prompt: [
					{ value: 2, unit: "perMTokens", conditions: { prompt_tokens: { unit: "kTokens", gte: "0" } } },
					{ value: 4, unit: "perMTokens", conditions: { prompt_tokens: { unit: "kTokens", gte: "272" } } },
				],
				completion: [
					{ value: 8, conditions: { prompt_tokens: { gte: "0" } } },
					{ value: 16, conditions: { prompt_tokens: { gte: "272" } } },
				],
				input_cache_read: [
					{ value: 0.2, conditions: { prompt_tokens: { gte: "0" } } },
					{ value: 0.4, conditions: { prompt_tokens: { gte: "272" } } },
				],
				input_cache_write: [{ value: 0.5 }],
			},
		},
		{
			id: "klingai/kling-3.0",
			display_name: "Kling 3.0",
			owned_by: "klingai",
			input_modalities: ["text"],
			output_modalities: ["video"],
			capabilities: {},
			context_length: 8000,
		},
		{
			id: "openai/gpt-6-codex",
			display_name: "OpenAI: GPT-6 Codex",
			owned_by: "openai",
			input_modalities: ["text"],
			output_modalities: ["text"],
			capabilities: { reasoning: true },
			context_length: 400000,
		},
	],
};

const MODELS_DEV_CATALOG = {
	zenmux: {
		models: {
			"anthropic/claude-opus-5": { limit: { context: 1000000, output: 128000 } },
			"openai/gpt-6-sol": { limit: { context: 1050000, output: 272000 } },
		},
	},
	openai: { models: { "anthropic/claude-opus-5": { limit: { output: 1 } } } },
};

function stubCatalogFetch(): () => void {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = requestUrl(input);
		if (url === ZENMUX_MODELS_URL) return jsonResponse(ZENMUX_CATALOG);
		if (url === MODELS_DEV_URL) return jsonResponse(MODELS_DEV_CATALOG);
		throw new Error(`unexpected fetch URL: ${url}`);
	}) as typeof fetch;
	return () => {
		globalThis.fetch = originalFetch;
	};
}

function makeStoredModel(overrides: Partial<Model<Api>> = {}): Model<Api> {
	return {
		id: "openai/gpt-6-sol",
		name: "OpenAI: GPT-6 Sol",
		api: "zenmux-router",
		provider: ZENMUX_PROVIDER_ID,
		baseUrl: "http://127.0.0.1:1/api/v1",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 2, output: 8, cacheRead: 0.2, cacheWrite: 0.5 },
		contextWindow: 1050000,
		maxTokens: 272000,
		...overrides,
	};
}

function makeRefreshContext(overrides: Partial<RefreshModelsContext> = {}) {
	const published: { persist?: unknown; update?: () => void }[] = [];
	const context = {
		allowNetwork: false,
		signal: new AbortController().signal,
		publish: async (publication: { persist?: unknown; update?: () => void }) => {
			published.push(publication);
			return true;
		},
		...overrides,
	} as RefreshModelsContext;
	return { context, published };
}

test("fetchZenmuxProviderModels maps the chat catalog and drops non-chat models", async () => {
	const restoreFetch = stubCatalogFetch();
	try {
		const models = await fetchZenmuxProviderModels();

		assert.deepEqual(
			models.map((model) => model.id),
			["anthropic/claude-opus-5", "openai/gpt-6-codex", "openai/gpt-6-sol"],
		);

		const anthropic = models.find((model) => model.id === "anthropic/claude-opus-5");
		assert.ok(anthropic);
		assert.equal(anthropic.api, "anthropic-messages");
		assert.equal(anthropic.baseUrl, ZENMUX_ANTHROPIC_BASE_URL);
		assert.deepEqual(anthropic.input, ["text", "image"]);
		assert.equal(anthropic.maxTokens, 128000);
		assert.deepEqual(anthropic.promptCache, { short: 300, long: 3600 });
		assert.deepEqual(anthropic.cost, {
			input: 5,
			output: 25,
			cacheRead: 0.5,
			cacheWrite: 6.25,
		});

		const openai = models.find((model) => model.id === "openai/gpt-6-sol");
		assert.ok(openai);
		assert.equal(openai.api, "openai-completions");
		assert.equal(openai.baseUrl, ZENMUX_OPENAI_BASE_URL);
		assert.equal(openai.maxTokens, 272000);
		// Generic `input_cache_write` pricing is used when the 5 minute tier is absent,
		// and only a short-lived cache is warmable without a 1 hour tier.
		assert.equal(openai.cost.cacheWrite, 0.5);
		assert.deepEqual(openai.promptCache, { short: 300 });
		// One row applies to the whole request, and tiers are expressed in tokens.
		assert.deepEqual(openai.cost.tiers, [
			{
				inputTokensAbove: 272000,
				input: 4,
				output: 16,
				cacheRead: 0.4,
				cacheWrite: 0.5,
			},
		]);

		const withoutPricing = models.find((model) => model.id === "openai/gpt-6-codex");
		assert.ok(withoutPricing);
		assert.equal(withoutPricing.maxTokens, 32768);
		assert.deepEqual(withoutPricing.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
		// A model that prices no cache writes is not eligible for cache warming.
		assert.equal(withoutPricing.promptCache, undefined);
	} finally {
		restoreFetch();
	}
});

test("routingFor sends Anthropic models to the messages endpoint and everything else to chat completions", () => {
	assert.deepEqual(routingFor({ id: "anthropic/claude-sonnet-5", owned_by: "anthropic" }), {
		api: "anthropic-messages",
		baseUrl: ZENMUX_ANTHROPIC_BASE_URL,
	});
	assert.deepEqual(routingFor({ id: "anthropic/claude-sonnet-5", owned_by: "custom" }), {
		api: "anthropic-messages",
		baseUrl: ZENMUX_ANTHROPIC_BASE_URL,
	});
	assert.deepEqual(routingFor({ id: "openai/gpt-6-sol", owned_by: "openai" }), {
		api: "openai-completions",
		baseUrl: ZENMUX_OPENAI_BASE_URL,
	});
});

test("restoreModels re-derives routing for snapshots written by an older version", () => {
	const restored = restoreModels([makeStoredModel(), makeStoredModel({ id: "anthropic/claude-opus-5", name: "Claude" })]);

	assert.equal(restored[0]?.api, "openai-completions");
	assert.equal(restored[0]?.baseUrl, ZENMUX_OPENAI_BASE_URL);
	assert.equal(restored[0]?.maxTokens, 272000);
	assert.equal(restored[1]?.api, "anthropic-messages");
	assert.equal(restored[1]?.baseUrl, ZENMUX_ANTHROPIC_BASE_URL);
});

test("registerZenmuxProvider registers the live catalog and refreshes it through pi", async () => {
	const restoreFetch = stubCatalogFetch();
	let providerName = "";
	let providerConfig: ProviderConfig | undefined;
	const pi = {
		registerProvider(name: string, config: ProviderConfig) {
			providerName = name;
			providerConfig = config;
		},
	} as unknown as ExtensionAPI;

	try {
		await registerZenmuxProvider(pi);

		assert.equal(providerName, ZENMUX_PROVIDER_ID);
		assert.equal(providerConfig?.apiKey, "$ZENMUX_API_KEY");
		assert.equal(providerConfig?.baseUrl, ZENMUX_OPENAI_BASE_URL);
		assert.equal(providerConfig?.api, "openai-completions");
		assert.equal(providerConfig?.models?.length, 3);
		assert.deepEqual(
			providerConfig?.models?.map((model) => model.api),
			["anthropic-messages", "openai-completions", "openai-completions"],
		);
		assert.equal(typeof providerConfig?.refreshModels, "function");
	} finally {
		restoreFetch();
	}

	// Offline startup: the factory catalog is served and persisted for offline runs.
	const offline = makeRefreshContext();
	const offlineModels = await refreshZenmuxModels(offline.context);
	assert.equal(offlineModels.length, 3);
	assert.equal(offline.published.length, 1);
	const persisted = offline.published[0]?.persist as { models: Model<Api>[]; checkedAt: number; etag: string };
	assert.equal(persisted.models.length, offlineModels.length);
	assert.ok(persisted.models.every((model) => model.provider === ZENMUX_PROVIDER_ID));
	assert.equal(persisted.etag, "pi-zenmux/2");
	assert.ok(persisted.checkedAt > 0);

	// A fresh write is skipped while the snapshot is current.
	const repeated = makeRefreshContext({
		stored: {
			models: offlineModels as unknown as Model<Api>[],
			checkedAt: Date.now(),
			etag: "pi-zenmux/2",
		},
	});
	assert.equal((await refreshZenmuxModels(repeated.context)).length, 3);
	assert.equal(repeated.published.length, 0);
});

test("refreshZenmuxModels restores the snapshot when discovery is unavailable", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => {
		throw new Error("offline");
	}) as typeof fetch;

	try {
		await new Promise<void>((resolve) => {
			const pi = {
				registerProvider() {
					resolve();
				},
			} as unknown as ExtensionAPI;
			void registerZenmuxProvider(pi);
		});

		const { context, published } = makeRefreshContext({
			stored: { models: [makeStoredModel()], checkedAt: Date.now(), etag: "pi-zenmux/2" },
		});
		const models = await refreshZenmuxModels(context);
		assert.equal(models.length, 1);
		assert.equal(models[0]?.api, "openai-completions");
		assert.equal(published.length, 0);

		// A snapshot from another scheme is ignored instead of yielding retired api ids.
		const foreign = makeRefreshContext({
			stored: { models: [makeStoredModel()], checkedAt: Date.now(), etag: undefined },
		});
		assert.deepEqual(await refreshZenmuxModels(foreign.context), []);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("refreshZenmuxModels keeps the snapshot when a network refresh fails", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => {
		throw new Error("network down");
	}) as typeof fetch;

	try {
		await new Promise<void>((resolve) => {
			const pi = {
				registerProvider() {
					resolve();
				},
			} as unknown as ExtensionAPI;
			void registerZenmuxProvider(pi);
		});

		const { context, published } = makeRefreshContext({
			allowNetwork: true,
			stored: { models: [makeStoredModel()], checkedAt: Date.now(), etag: "pi-zenmux/2" },
		});
		const models = await refreshZenmuxModels(context);
		assert.equal(models.length, 1);
		assert.equal(published.length, 0);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("fetchZenmuxProviderModels falls back to models.dev pricing when ZenMux omits it", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = requestUrl(input);
		if (url === ZENMUX_MODELS_URL) {
			return jsonResponse({
				data: [
					{
						id: "deepseek/deepseek-v4-flash",
						display_name: "DeepSeek V4 Flash",
						owned_by: "deepseek",
						input_modalities: ["text"],
						output_modalities: ["text"],
						capabilities: { reasoning: true },
						context_length: 1000000,
					},
				],
			});
		}
		return jsonResponse({
			zenmux: {
				models: {
					"deepseek/deepseek-v4-flash": {
						limit: { context: 1000000, output: 384000 },
						cost: { input: 0.14, output: 0.28, cache_read: 0.0028 },
					},
				},
			},
		});
	}) as typeof fetch;

	try {
		const [model] = await fetchZenmuxProviderModels();
		assert.ok(model);
		assert.equal(model.maxTokens, 384000);
		assert.deepEqual(model.cost, { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 });
		// The provider prices no cache writes for this model, so warming stays off.
		assert.equal(model.promptCache, undefined);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("fetchZenmuxProviderModels prefers ZenMux's own output cap over models.dev", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = requestUrl(input);
		if (url === ZENMUX_MODELS_URL) {
			return jsonResponse({
				data: [
					{
						id: "openai/gpt-4o-mini",
						display_name: "OpenAI: GPT-4o mini",
						owned_by: "openai",
						input_modalities: ["text"],
						output_modalities: ["text"],
						capabilities: { reasoning: false },
						context_length: 128000,
					},
					{
						id: "openai/gpt-6-sol",
						display_name: "OpenAI: GPT-6 Sol",
						owned_by: "openai",
						input_modalities: ["text"],
						output_modalities: ["text"],
						capabilities: { reasoning: true },
						context_length: 1050000,
					},
				],
			});
		}
		if (url === ZENMUX_ENDPOINT_CATALOG_URL) {
			return jsonResponse({
				data: [
					{ slug: "openai/gpt-4o-mini", endpoint_slug: "openai/chat-completions", max_completion_tokens: 16384 },
					// A model served by two endpoints is capped by the tighter one.
					{ slug: "openai/gpt-4o-mini", endpoint_slug: "azure/chat-completions", max_completion_tokens: 8192 },
					{ slug: "openai/gpt-6-sol", endpoint_slug: "openai/responses", max_completion_tokens: null },
				],
			});
		}
		return jsonResponse({
			zenmux: {
				models: {
					"openai/gpt-4o-mini": { limit: { output: 32768 } },
					"openai/gpt-6-sol": { limit: { output: 272000 } },
				},
			},
		});
	}) as typeof fetch;

	try {
		const models = await fetchZenmuxProviderModels();
		const mini = models.find((model) => model.id === "openai/gpt-4o-mini");
		const sol = models.find((model) => model.id === "openai/gpt-6-sol");
		assert.equal(mini?.maxTokens, 8192);
		// No endpoint cap published, so the models.dev limit still applies.
		assert.equal(sol?.maxTokens, 272000);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("fetchZenmuxProviderModels fails when ZenMux returns no models", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = requestUrl(input);
		if (url === ZENMUX_MODELS_URL) return jsonResponse({ data: [] });
		return jsonResponse({ zenmux: { models: {} } });
	}) as typeof fetch;

	try {
		await assert.rejects(fetchZenmuxProviderModels(), /empty/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

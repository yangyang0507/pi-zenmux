import assert from "node:assert/strict";
import test from "node:test";
import type { Api, Model } from "@mariozechner/pi-ai";
import {
	FALLBACK_MODELS,
	ZENMUX_ANTHROPIC_BASE_URL,
	ZENMUX_OPENAI_BASE_URL,
	fetchZenmuxModels,
	getBasePrice,
	routeModel,
	toProviderModel,
} from "./index.js";

function makeModel(overrides: Partial<Model<Api>> = {}): Model<Api> {
	return {
		id: "openai/gpt-5.3-chat",
		name: "OpenAI: GPT-5.3 Chat",
		api: "openai-completions",
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

test("getBasePrice prefers baseline tier (gte=0)", () => {
	const value = getBasePrice([
		{ value: 2, conditions: { prompt_tokens: { gte: 100000 } } },
		{ value: 1, conditions: { prompt_tokens: { gte: 0 } } },
	]);
	assert.equal(value, 1);
});

test("toProviderModel maps anthropic and image modalities", () => {
	const model = toProviderModel({
		id: "anthropic/claude-opus-4.6",
		display_name: "Anthropic: Claude Opus 4.6",
		owned_by: "anthropic",
		input_modalities: ["text", "image"],
		capabilities: { reasoning: true },
		context_length: 1000000,
		pricings: {
			prompt: [{ value: 5 }],
			completion: [{ value: 25 }],
			input_cache_read: [{ value: 0.5 }],
			input_cache_write_5_min: [{ value: 6.25 }],
		},
	});

	assert.ok(model);
	assert.equal(model?.api, "anthropic-messages");
	assert.deepEqual(model?.input, ["text", "image"]);
	assert.equal(model?.contextWindow, 1000000);
	assert.deepEqual(model?.cost, {
		input: 5,
		output: 25,
		cacheRead: 0.5,
		cacheWrite: 6.25,
	});
});

test("routeModel routes anthropic ids to anthropic endpoint", () => {
	const routed = routeModel(
		makeModel({
			id: "anthropic/claude-sonnet-4.6",
			api: "openai-completions",
		}),
	);

	assert.equal(routed.api, "anthropic-messages");
	assert.equal(routed.baseUrl, ZENMUX_ANTHROPIC_BASE_URL);
});

test("routeModel routes non-anthropic ids to openai endpoint", () => {
	const routed = routeModel(
		makeModel({
			id: "openai/gpt-5.3-codex",
			api: "openai-completions",
		}),
	);

	assert.equal(routed.api, "openai-completions");
	assert.equal(routed.baseUrl, ZENMUX_OPENAI_BASE_URL);
});

test("fetchZenmuxModels maps API response and deduplicates by id", async () => {
	const models = await fetchZenmuxModels({
		fetcher: async () =>
			new Response(
				JSON.stringify({
					data: [
						{
							id: "anthropic/claude-opus-4.6",
							display_name: "Anthropic: Claude Opus 4.6",
							owned_by: "anthropic",
							input_modalities: ["text", "image"],
							capabilities: { reasoning: true },
							context_length: 1000000,
							pricings: { prompt: [{ value: 5 }], completion: [{ value: 25 }] },
						},
						{
							id: "openai/gpt-5.3-chat",
							display_name: "OpenAI: GPT-5.3 Chat",
							owned_by: "openai",
							input_modalities: ["text", "image"],
							capabilities: { reasoning: true },
							context_length: 128000,
							pricings: { prompt: [{ value: 1.75 }], completion: [{ value: 14 }] },
						},
						{
							id: "openai/gpt-5.3-chat",
							display_name: "OpenAI: GPT-5.3 Chat",
							owned_by: "openai",
							input_modalities: ["text"],
							capabilities: { reasoning: false },
							context_length: 128000,
							pricings: { prompt: [{ value: 1.5 }], completion: [{ value: 12 }] },
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		logger: { log: () => {}, warn: () => {} },
	});

	assert.equal(models.length, 2);
	const deduped = models.find((m) => m.id === "openai/gpt-5.3-chat");
	assert.ok(deduped);
	assert.equal(deduped?.reasoning, false);
	assert.deepEqual(deduped?.input, ["text"]);
});

test("fetchZenmuxModels falls back when fetch fails", async () => {
	const models = await fetchZenmuxModels({
		fetcher: async () => {
			throw new Error("network down");
		},
		logger: { log: () => {}, warn: () => {} },
	});

	assert.deepEqual(models, FALLBACK_MODELS);
});

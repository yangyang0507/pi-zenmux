import assert from "node:assert/strict";
import test from "node:test";
import type { Api, Model } from "@mariozechner/pi-ai";
import {
	ZENMUX_ANTHROPIC_BASE_URL,
	ZENMUX_MODELS_SNAPSHOT,
	ZENMUX_OPENAI_BASE_URL,
	ZENMUX_ROUTER_API,
	asZenmuxRouterModels,
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

test("bundled model snapshot exists and has maxTokens", () => {
	assert.ok(ZENMUX_MODELS_SNAPSHOT.length > 0);

	for (const model of ZENMUX_MODELS_SNAPSHOT) {
		assert.equal(typeof model.id, "string");
		assert.equal(typeof model.name, "string");
		assert.ok(Number.isInteger(model.maxTokens));
		assert.ok(model.maxTokens > 0);
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

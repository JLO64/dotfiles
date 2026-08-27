import { describe, expect, test } from "bun:test";
import { aggregateSummary } from "../index.ts";

type Result = Parameters<typeof aggregateSummary>[0][number];

const theme = { fg: (_color: unknown, text: string) => text };

function result(overrides: Partial<Result> = {}): Result {
	return {
		agent: "example",
		agentSource: "project",
		task: "Test task",
		exitCode: 0,
		messages: [],
		stderr: "",
		model: "openai-codex/gpt-5.6-luna:high",
		cwd: "/repo",
		durationMs: 60_000,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 10_000, turns: 1 },
		...overrides,
	};
}

describe("aggregate subagent footers", () => {
	test("sums chain context while retaining summed duration and turns", () => {
		const summary = aggregateSummary(
			[
				result(),
				result({
					durationMs: 120_000,
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 16_000, turns: 2 },
				}),
			],
			"chain",
			theme,
		);

		expect(summary).toBe("openai-codex/gpt-5.6-luna(High, 26.0k, 3 turns) in  /repo for 󰥔 3 minutes");
	});

	test("sums parallel context while retaining maximum duration and turns", () => {
		const summary = aggregateSummary(
			[
				result(),
				result({
					durationMs: 120_000,
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 16_000, turns: 2 },
				}),
			],
			"parallel",
			theme,
		);

		expect(summary).toBe("openai-codex/gpt-5.6-luna(High, 26.0k, 3 turns) in  /repo for 󰥔 2 minutes");
	});

	test("uses summed context in fallback summaries", () => {
		const results = [
			result(),
			result({
				model: "different-model",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 16_000, turns: 2 },
			}),
		];

		expect(aggregateSummary(results, "chain", theme)).toBe("2 tasks (26.0k, 3 turns, 2 minutes)");
		expect(aggregateSummary(results, "parallel", theme)).toBe("2 tasks (26.0k, 3 turns, 1 minute)");
	});
});

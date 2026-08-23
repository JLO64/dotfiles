import { describe, expect, test } from "bun:test";
import {
	formatContextTokens,
	formatSummaryStats,
	formatTurns,
	humanizeDuration,
	normalizeProfileModel,
	shortenHome,
	taskSummary,
} from "../summary.ts";

describe("subagent result summary helpers", () => {
	test("uses the first task line without the Task: prefix", () => {
		expect(taskSummary("Task: Inspect the renderer\nThen update it.")).toBe("Inspect the renderer");
		expect(taskSummary("  task: preserve this first line\nAnd ignore this line")).toBe("preserve this first line");
	});

	test("separates a profile thinking suffix from the model", () => {
		expect(normalizeProfileModel("openai-codex/gpt-5.6-luna:high")).toEqual({
			model: "openai-codex/gpt-5.6-luna",
			thinking: "High",
		});
	});

	test("formats context and duration for the footer-style summary", () => {
		expect(formatContextTokens(26_000)).toBe("26.0k");
		expect(humanizeDuration(5 * 60_000)).toBe("5 minutes");
		expect(humanizeDuration(1_000)).toBe("1 second");
		expect(humanizeDuration(46_000)).toBe("46 seconds");
		expect(humanizeDuration(66_000)).toBe("1 minute");
		expect(humanizeDuration(2 * 60 * 60_000)).toBe("2 hours");
	});

	test("formats turn counts and summary stats without model-parenthesis spacing", () => {
		expect(formatTurns(0)).toBe("0 turns");
		expect(formatTurns(1)).toBe("1 turn");
		expect(formatTurns(5)).toBe("5 turns");
		const stats = formatSummaryStats("High", 13_600, 5);
		expect(stats).toBe("High, 13.6k, 5 turns");
		expect(`openai-codex/gpt-5.6-luna(${stats})`).toBe("openai-codex/gpt-5.6-luna(High, 13.6k, 5 turns)");
	});

	test("shortens only paths inside HOME", () => {
		expect(shortenHome("/Users/example/git/dotfiles", "/Users/example")).toBe("~/git/dotfiles");
		expect(shortenHome("/opt/project", "/Users/example")).toBe("/opt/project");
	});
});

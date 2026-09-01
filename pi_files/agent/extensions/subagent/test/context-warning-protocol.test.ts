import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CONTEXT_WARNING_PROTOCOL_PREFIX, formatContextWarningProtocol } from "../context-limiter.ts";
import { aggregateSummary, formatFailureReport, parseContextWarningProtocolLine, resultDisplayItems } from "../index.ts";

const warning = {
	v: 1 as const,
	type: "context_warning" as const,
	threshold: 75 as const,
	used: 90_400,
	limit: 120_000,
	message: "Context limit warning: 75% consumed (90.4k/120k). Prioritize essential remaining work.",
};

describe("subagent context warning protocol", () => {
	test("accepts only complete, valid versioned payloads", () => {
		const line = formatContextWarningProtocol(warning);
		assert.deepEqual(parseContextWarningProtocolLine(line), {
			threshold: 75,
			used: 90_400,
			limit: 120_000,
			message: warning.message,
		});
		assert.equal(parseContextWarningProtocolLine(line.slice(0, -1)), undefined);
		assert.equal(parseContextWarningProtocolLine(`${CONTEXT_WARNING_PROTOCOL_PREFIX}{bad json`), undefined);
		assert.equal(parseContextWarningProtocolLine(`${CONTEXT_WARNING_PROTOCOL_PREFIX}${JSON.stringify({ ...warning, used: 1 })}`), undefined);
		assert.equal(parseContextWarningProtocolLine("ordinary stderr"), undefined);
	});

	test("keeps warning activity in arrival order without duplicating it in fallback output", () => {
		const activity = resultDisplayItems({
			activity: [
				{ type: "toolCall", name: "read", args: { path: "a.ts" } },
				{ type: "contextWarning", warning: { threshold: 75, used: 90_400, limit: 120_000, message: warning.message } },
				{ type: "text", text: "Done." },
			],
			messages: [],
			contextWarnings: [],
		} as any);
		assert.deepEqual(activity.map((item) => item.type), ["toolCall", "contextWarning", "text"]);

		const fallback = resultDisplayItems({
			activity: [],
			messages: [],
			contextWarnings: [{ threshold: 75, used: 90_400, limit: 120_000, message: warning.message }],
		} as any);
		assert.deepEqual(fallback.map((item) => item.type), ["contextWarning"]);
	});

	test("retains warnings in failure details while aggregate summaries omit them", () => {
		const result = {
			agent: "example", agentSource: "project" as const, task: "Test", exitCode: 1, messages: [], stderr: "failure\n",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 90_400, turns: 1 },
			contextTokenLimit: 120_000,
			contextWarnings: [{ threshold: 75, used: 90_400, limit: 120_000, message: warning.message }],
			activity: [],
		};
		assert.match(formatFailureReport(result, "failure"), /Context warning diagnostics[\s\S]*75% consumed/);
		assert.doesNotMatch(aggregateSummary([result], "parallel", { fg: (_color, text) => text }), /75% consumed/);
	});
});

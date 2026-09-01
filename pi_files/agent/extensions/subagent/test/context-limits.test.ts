import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	DEFAULT_CONTEXT_TOKEN_LIMIT,
	contextPressureColor,
	formatContextTokenLimit,
	nextContextWarning,
	parseContextTokenLimit,
	parseEnvironmentContextTokenLimit,
	renderContextTokenLimit,
	resolveContextTokenLimit,
} from "../context-limits.ts";

describe("subagent context limits", () => {
	test("uses invocation, then profile, then the default", () => {
		assert.equal(resolveContextTokenLimit(90_000, 80_000), 90_000);
		assert.equal(resolveContextTokenLimit(undefined, 80_000), 80_000);
		assert.equal(resolveContextTokenLimit(undefined, undefined), DEFAULT_CONTEXT_TOKEN_LIMIT);
	});

	test("rejects invalid explicit values", () => {
		for (const value of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, "120000"]) {
			assert.throws(
				() => parseContextTokenLimit(value, "contextTokenLimit invocation value"),
				/expected a positive safe integer/,
			);
		}
	});

	test("parses the transported environment limit as a decimal positive safe integer", () => {
		assert.equal(parseEnvironmentContextTokenLimit("120000", "environment value"), 120_000);
		assert.equal(parseEnvironmentContextTokenLimit(undefined, "environment value"), undefined);
		for (const value of ["", "0", "-1", "1.5", "1e5", " 120000", "120000 ", "9007199254740992"]) {
			assert.throws(
				() => parseEnvironmentContextTokenLimit(value, "environment value"),
				/expected a decimal positive safe integer/,
			);
		}
	});

	test("emits only the strongest newly crossed threshold", () => {
		assert.match(nextContextWarning(60_200, 120_000, 0)?.message ?? "", /Remain concise and focused/);
		assert.match(nextContextWarning(90_400, 120_000, 50)?.message ?? "", /Prioritize essential remaining work/);
		assert.equal(nextContextWarning(90_000, 120_000, 0)?.threshold, 75);
		assert.equal(nextContextWarning(110_000, 120_000, 75)?.threshold, 90);
		const limitReached = nextContextWarning(120_000, 120_000, 90);
		assert.equal(limitReached?.threshold, 100);
		assert.match(limitReached?.message ?? "", /Wrapping up immediately; no new work\./);
		assert.equal(nextContextWarning(130_000, 120_000, 100), undefined);
	});

	test("formats and colors the complete usage fragment with custom-footer boundaries", () => {
		const colors: Array<[string, string]> = [];
		const theme = { fg: (color: "warning" | "error", text: string) => (colors.push([color, text]), `<${color}>${text}</${color}>`) };
		assert.equal(formatContextTokenLimit(26_000, 120_000), "26.0k/120k");
		assert.equal(formatContextTokenLimit(130_000, 120_000), "130.0k/120k");
		assert.equal(contextPressureColor(60_000, 120_000), undefined);
		assert.equal(contextPressureColor(60_001, 120_000), "warning");
		assert.equal(contextPressureColor(96_000, 120_000), "warning");
		assert.equal(contextPressureColor(96_001, 120_000), "error");
		assert.equal(renderContextTokenLimit(60_001, 120_000, theme), "<warning>60.0k/120k</warning>");
		assert.deepEqual(colors, [["warning", "60.0k/120k"]]);
	});
});

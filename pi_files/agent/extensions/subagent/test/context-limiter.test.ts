import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	CONTEXT_WARNING_PROTOCOL_PREFIX,
	createContextLimitHandler,
	formatContextWarningProtocol,
} from "../context-limiter.ts";

describe("subagent context limiter", () => {
	test("uses ctx.getContextUsage and injects only the strongest warning once", () => {
		const fired: string[] = [];
		const handler = createContextLimitHandler(
			120_000,
			(warning) => fired.push(formatContextWarningProtocol(warning)),
			() => {},
		);
		const event = { messages: [{ role: "user", content: "Continue" }] };
		let calls = 0;
		let tokens = 109_000;
		const ctx = {
			getContextUsage() {
				calls++;
				return { tokens };
			},
		};

		const first = handler(event as any, ctx as any);
		assert.equal(calls, 1);
		assert.equal(first?.messages.length, 2);
		assert.match(String((first?.messages[1] as { content: string }).content), /90% consumed/);
		assert.equal(fired.length, 1);
		assert.match(fired[0], new RegExp(`^${CONTEXT_WARNING_PROTOCOL_PREFIX}`));
		assert.equal(handler(event as any, ctx as any), undefined);

		tokens = 120_000;
		const reached = handler(event as any, ctx as any);
		assert.equal(reached?.messages.length, 2);
		assert.match(String((reached?.messages[1] as { content: string }).content), /Wrapping up immediately; no new work/);
		assert.equal(fired.length, 2);
		assert.equal(handler(event as any, ctx as any), undefined);
	});

	test("reports continuation limits and exact occupancy in the first request context", () => {
		const priorResume = process.env.PI_SUBAGENT_RESUME_NOTICE;
		const priorLimit = process.env.PI_SUBAGENT_PREVIOUS_CONTEXT_TOKEN_LIMIT;
		process.env.PI_SUBAGENT_RESUME_NOTICE = "1";
		process.env.PI_SUBAGENT_PREVIOUS_CONTEXT_TOKEN_LIMIT = "90000";
		try {
			const measurements: unknown[] = [];
			const handler = createContextLimitHandler(80_000, () => {}, (measurement) => measurements.push(measurement));
			const result = handler({ messages: [] } as any, { getContextUsage: () => ({ tokens: 60_000 }) } as any);
			assert.match(String((result?.messages[0] as { content: string }).content), /previous context limit was 90000 tokens; the effective limit.*80000 tokens/i);
			assert.match(String((result?.messages[0] as { content: string }).content), /60000 tokens \(75%/);
			assert.equal((measurements[0] as any).tokens, 60_000);
		} finally {
			if (priorResume === undefined) delete process.env.PI_SUBAGENT_RESUME_NOTICE;
			else process.env.PI_SUBAGENT_RESUME_NOTICE = priorResume;
			if (priorLimit === undefined) delete process.env.PI_SUBAGENT_PREVIOUS_CONTEXT_TOKEN_LIMIT;
			else process.env.PI_SUBAGENT_PREVIOUS_CONTEXT_TOKEN_LIMIT = priorLimit;
		}
	});
});

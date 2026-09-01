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
		const handler = createContextLimitHandler(120_000, (warning) => fired.push(formatContextWarningProtocol(warning)));
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
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	formatNestedSubagentActivity,
	formatNestedTaskLabel,
	formatToolCall,
	isNestedSubagentCallAlreadyRendered,
	parseNestedSubagentActivity,
} from "../index.ts";

const identity = (_color: unknown, text: string) => text;

describe("subagent tool display", () => {
	test("shows complete web search queries as quoted text", () => {
		const query = '"quoted" topic ' + "x".repeat(120);
		assert.equal(formatToolCall("web_search", { query }, identity), `web_search ${JSON.stringify(query)}`);
	});

	test("shows complete web fetch URLs without JSON previews", () => {
		const url = `https://example.test/${"a".repeat(120)}?q=full`;
		assert.equal(formatToolCall("web_fetch", { url }, identity), `web_fetch ${url}`);
	});

	test("summarizes nested task lines for single, parallel, and resumed calls", () => {
		const fullTask = "# Task\nInspect the renderer.\n\n## Context\nKeep the full prompt for the agent.";
		const task = { agent: "researcher", task: fullTask, tools: [] };
		assert.equal(formatNestedTaskLabel(task, false), "Inspect the renderer.");
		assert.equal(formatNestedTaskLabel(task, true), "researcher: Inspect the renderer.");
		assert.equal(formatNestedTaskLabel({ ...task, resumed: true }, false), "Inspect the renderer.");
		assert.equal(formatNestedTaskLabel({ ...task, task: "\n\nFallback summary\nAdditional details" }, true), "researcher: Fallback summary");

		const record = formatNestedSubagentActivity("summary-test", [{
			agent: "researcher", task: fullTask, exitCode: 0, messages: [], stderr: "",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
			activity: [],
		} as any], false, true);
		assert.equal(parseNestedSubagentActivity(record)?.tasks[0]?.task, fullTask);
	});

	test("parses nested single and resumed subagent activity with actual tools", () => {
		const activity = parseNestedSubagentActivity(`PI_SUBAGENT_ACTIVITY:${JSON.stringify({
			v: 1,
			callId: "nested-call-1",
			parallel: false,
			tasks: [{
				agent: "researcher",
				task: "Find the answer",
				resumed: true,
				tools: [{ type: "toolCall", id: "call-1", name: "web_search", args: { query: "complete query" }, status: "success" }],
			}],
		})}`);
		assert.equal(activity?.parallel, false);
		assert.equal(activity?.tasks[0]?.agent, "researcher");
		assert.equal(activity?.tasks[0]?.task, "Find the answer");
		assert.equal(activity?.tasks[0]?.resumed, true);
		assert.deepEqual(activity?.tasks[0]?.tools.map((item) => item.type), ["toolCall"]);
	});

	test("parses parallel nested tasks independently and rejects malformed records", () => {
		const activity = parseNestedSubagentActivity(`PI_SUBAGENT_ACTIVITY:${JSON.stringify({
			v: 1,
			callId: "parallel-call-1",
			parallel: true,
			tasks: [
				{ agent: "one", task: "First task", tools: [{ type: "toolCall", id: "1", name: "read", args: { path: "a" }, status: "success" }] },
				{ agent: "two", task: "Second task", tools: [] },
			],
		})}`);
		assert.equal(activity?.parallel, true);
		assert.deepEqual(activity?.tasks.map(({ agent, task }) => ({ agent, task })), [
			{ agent: "one", task: "First task" },
			{ agent: "two", task: "Second task" },
		]);
		assert.equal(parseNestedSubagentActivity("PI_SUBAGENT_ACTIVITY:{bad"), undefined);
	});

	test("rejects malformed tool arguments and malformed recursive activity safely", () => {
		const payload = {
			v: 1,
			callId: "outer-call",
			parallel: false,
			tasks: [{ agent: "worker", task: "Inspect", tools: [{ type: "toolCall", id: "read-1", name: "read", args: null, status: "success" }] }],
		};
		assert.equal(parseNestedSubagentActivity(`PI_SUBAGENT_ACTIVITY:${JSON.stringify(payload)}`), undefined);
		payload.tasks[0].tools = [{
			type: "nestedSubagent", callId: "inner-call", parallel: false,
			tasks: [{ agent: "inner", task: "Inspect deeper", tools: [{ type: "toolCall", id: "read-2", name: "read", args: null, status: "success" }] }],
		}] as any;
		assert.equal(parseNestedSubagentActivity(`PI_SUBAGENT_ACTIVITY:${JSON.stringify(payload)}`), undefined);
		assert.equal(parseNestedSubagentActivity("unrelated stderr"), undefined);
	});

	test("ties duplicate suppression to the originating call and formats captured activity", () => {
		const results = [{
			agent: "worker", task: "Do work", activity: [{
				type: "toolCall", id: "child-read", name: "read", args: { path: "file" }, status: "success",
			}], messages: [], contextWarnings: [],
		}] as any;
		const record = formatNestedSubagentActivity("successful-call", results, false);
		const nested = parseNestedSubagentActivity(record);
		assert.equal(nested?.callId, "successful-call");
		assert.deepEqual(nested?.tasks[0]?.tools.map((tool) => tool.type), ["toolCall"]);

		const displayedItems = [
			{ type: "toolCall", id: "successful-call", name: "subagent", args: {}, status: "success" },
			nested!,
			{ type: "toolCall", id: "failed-call", name: "subagent", args: {}, status: "error" },
		] as any;
		assert.equal(isNestedSubagentCallAlreadyRendered("successful-call", displayedItems), true);
		assert.equal(isNestedSubagentCallAlreadyRendered("failed-call", displayedItems), false);
	});
});

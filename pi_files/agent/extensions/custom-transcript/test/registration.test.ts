import { describe, expect, test } from "bun:test";
import extension from "../index.ts";

describe("custom-transcript registration", () => {
	test("wraps supported built-ins and limits diff normalization to assistant text", () => {
		const tools: string[] = [];
		const transformers: Array<(markdown: string, context: { messageType: string }) => string> = [];
		const handlers: Record<string, Function> = {};
		extension({
			registerTool: (tool: { name: string }) => tools.push(tool.name),
			registerMarkdownTransformer: (transformer: (markdown: string, context: { messageType: string }) => string) =>
				transformers.push(transformer),
			on: (event: string, handler: Function) => {
				handlers[event] = handler;
			},
		} as any);

		expect(tools.sort()).toEqual(["bash", "edit", "find", "grep", "ls", "read", "write"]);
		expect(tools.filter((name) => name === "read")).toHaveLength(1);
		expect(handlers.session_start).toBeDefined();
		expect(handlers.session_shutdown).toBeDefined();
		expect(transformers).toHaveLength(1);
		expect(transformers[0]("```diff\n +a\n```", { messageType: "assistant" })).toBe("```diff\n+a\n```");
		expect(transformers[0]("```diff\n +a\n```", { messageType: "user" })).toBe("```diff\n +a\n```");
	});
});

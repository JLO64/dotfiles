import { describe, expect, test } from "bun:test";
import type { Context, Model } from "@earendil-works/pi-ai";
import { convertRequest, ENDPOINT, MODEL_ID, parseSseData, streamSlotstream } from "./index.ts";

const model: Model<any> = {
	id: MODEL_ID, name: "test", api: "slotstream-language-model", provider: "slotstream", baseUrl: ENDPOINT,
	reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 8192,
};
const context: Context = {
	systemPrompt: "system",
	messages: [{ role: "user", content: [{ type: "text", text: "hello" }, { type: "image", mimeType: "image/png", data: "abc" }], timestamp: 1 }, {
		role: "assistant", content: [{ type: "thinking", thinking: "consider" }, { type: "toolCall", id: "call-1", name: "read", arguments: { path: "x" } }],
		api: "x", provider: "x", model: "x", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "toolUse", timestamp: 2,
	}, { role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{ type: "image", mimeType: "image/png", data: "ignored" }], isError: false, timestamp: 3 }],
	tools: [{ name: "read", description: "Read", parameters: { type: "object", properties: { path: { type: "string" } } } as any }],
};

function bytes(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); } });
}
function response(events: string[], status = 200): Response {
	return new Response(bytes(events), { status, headers: { "content-type": "text/event-stream" } });
}
async function collect(events: string[], options: any = {}) {
	const stream = streamSlotstream(model, context, { ...options, fetch: async () => response(events) });
	const output: any[] = [];
	for await (const event of stream) output.push(event);
	return output;
}
const finish = 'data: {"type":"finish","finishReason":{"unified":"stop","raw":"end"},"usage":{"inputTokens":{"total":9,"noCache":3,"cacheRead":4,"cacheWrite":2},"outputTokens":{"total":5,"text":3,"reasoning":2}}}\n\n';

describe("Slotstream request conversion", () => {
	test("replays system, messages, reasoning, tools, and safe image tool results", () => {
		const request = convertRequest(context, { maxTokens: 12, temperature: 0.2, toolChoice: "auto", reasoning: "medium" });
		expect(request.prompt).toEqual([
			{ role: "system", content: "system" },
			{ role: "user", content: [{ type: "text", text: "hello" }, { type: "file", mediaType: "image/png", data: "abc" }] },
			{ role: "assistant", content: [{ type: "reasoning", text: "consider" }, { type: "tool-call", toolCallId: "call-1", toolName: "read", input: { path: "x" } }] },
			{ role: "tool", content: [{ type: "tool-result", toolCallId: "call-1", toolName: "read", output: { type: "text", value: "[Slotstream cannot accept image tool results; omitted image/png data.]" } }] },
		]);
		expect(request).toMatchObject({ maxOutputTokens: 12, temperature: 0.2, toolChoice: { type: "auto" }, reasoning: "medium" });
		expect(convertRequest(context, { reasoning: "high" }).reasoning).toBe("xhigh");
		expect(convertRequest(context, { reasoning: "minimal" }).reasoning).toBe("none");
	});
});

describe("Slotstream SSE parsing", () => {
	test("handles split chunks, CRLF, comments, and final unblanked data", async () => {
		const parsed: string[] = [];
		for await (const data of parseSseData(bytes([": keepalive\r\n", "data: {\"type\":\"text", "-delta\",\"delta\":\"x\"}\r\n\r\n", "data: [DONE]"]))) parsed.push(data);
		expect(parsed).toEqual(['{"type":"text-delta","delta":"x"}', "[DONE]"]);
	});
});

describe("Slotstream streaming", () => {
	test("emits text and reasoning in pi order and maps usage", async () => {
		const events = await collect([
			'data: {"type":"response-metadata","id":"response-1","modelId":"served","timestamp":"2026-01-01T00:00:00Z"}\n\n',
			'data: {"type":"reasoning-start","id":"r"}\n\ndata: {"type":"reasoning-delta","id":"r","delta":"think"}\n\ndata: {"type":"reasoning-end","id":"r"}\n\n',
			'data: {"type":"text-start","id":"t"}\n\ndata: {"type":"text-delta","id":"t","delta":"answer"}\n\ndata: {"type":"text-end","id":"t"}\n\n', finish, "data: [DONE]\n\n",
		]);
		expect(events.map((event) => event.type)).toEqual(["start", "thinking_start", "thinking_delta", "thinking_end", "text_start", "text_delta", "text_end", "done"]);
		const done: any = events.at(-1);
		expect(done.message).toMatchObject({ responseId: "response-1", responseModel: "served", stopReason: "stop", rawStopReason: "end" });
		expect(done.message.usage).toMatchObject({ input: 3, cacheRead: 4, cacheWrite: 2, output: 5, reasoning: 2, totalTokens: 14, cost: { total: 0 } });
	});

	test("honors request hooks and caller headers", async () => {
		let request: Request | undefined;
		let responseStatus: number | undefined;
		const stream = streamSlotstream(model, context, {
			headers: { "x-test": "yes" },
			onPayload: (payload) => ({ ...(payload as object), temperature: 0.7 }),
			onResponse: (response) => { responseStatus = response.status; },
			fetch: async (input, init) => { request = new Request(input, init); return response([finish]); },
		});
		for await (const _event of stream) { /* consume */ }
		expect(request?.headers.get("ai-language-model-id")).toBe(MODEL_ID);
		expect(request?.headers.get("x-test")).toBe("yes");
		expect(await request?.json()).toMatchObject({ temperature: 0.7, reasoning: "none" });
		expect(responseStatus).toBe(200);
	});

	test("does not duplicate tool blocks when final tool-call follows input streaming", async () => {
		const events = await collect([
			'data: {"type":"tool-input-start","id":"input-1","toolName":"read"}\n\n',
			'data: {"type":"tool-input-delta","id":"input-1","delta":"{\\"path\\":\\"x\\"}"}\n\n',
			'data: {"type":"tool-input-end","id":"input-1"}\n\n',
			'data: {"type":"tool-call","toolCallId":"input-1","toolName":"read","input":"{\\"path\\":\\"x\\"}"}\n\n', finish,
		]);
		const done: any = events.at(-1);
		expect(done.message.content).toEqual([{ type: "toolCall", id: "input-1", name: "read", arguments: { path: "x" } }]);
		expect(events.filter((event) => event.type === "toolcall_start")).toHaveLength(1);
	});

	test("reports HTTP, SSE JSON, server, and invalid tool JSON errors", async () => {
		const http = streamSlotstream(model, context, { fetch: async () => response(["nope"], 500) });
		const httpEvents: any[] = []; for await (const event of http) httpEvents.push(event);
		expect(httpEvents.at(-1).error.errorMessage).toContain("HTTP 500");
		for (const input of ["data: not-json\n\n", 'data: {"type":"error","error":{"message":"bad gateway"}}\n\n', 'data: {"type":"tool-input-start","id":"x","toolName":"read"}\n\ndata: {"type":"tool-input-delta","id":"x","delta":"no"}\n\ndata: {"type":"tool-input-end","id":"x"}\n\n']) {
			const events = await collect([input]);
			expect(events.at(-1)).toMatchObject({ type: "error", reason: "error" });
		}
	});

	test("classifies an aborted request as aborted", async () => {
		const controller = new AbortController(); controller.abort();
		const events = await collect([], { signal: controller.signal, fetch: async () => { throw new DOMException("Aborted", "AbortError"); } });
		expect(events.at(-1)).toMatchObject({ type: "error", reason: "aborted" });
	});
});

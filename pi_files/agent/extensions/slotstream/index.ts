import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	calculateCost,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
	type StopReason,
	type ToolCall,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const PROVIDER_ID = "slotstream";
export const MODEL_ID = "slotstream/qwen3.8-flash-next:4bit";
export const ENDPOINT = "http://127.0.0.1:11434/v3/ai/language-model";

type PromptPart =
	| { type: "text"; text: string }
	| { type: "file"; mediaType: string; data: string }
	| { type: "reasoning"; text: string }
	| { type: "tool-call"; toolCallId: string; toolName: string; input: Record<string, unknown> }
	| { type: "tool-result"; toolCallId: string; toolName: string; output: { type: "text" | "error-text"; value: string } };

export type SlotstreamRequest = {
	prompt: Array<{ role: "system"; content: string } | { role: "user" | "assistant" | "tool"; content: PromptPart[] }>;
	tools?: Array<{ type: "function"; name: string; description?: string; inputSchema?: object }>;
	toolChoice?: { type: "auto" | "none" };
	maxOutputTokens?: number;
	temperature?: number;
	reasoning?: "none" | "low" | "medium" | "xhigh";
	responseFormat?: { type: "text" };
};

function toolResultText(content: Array<{ type: "text" | "image"; text?: string; mimeType?: string }>): string {
	return content
		.map((part) =>
			part.type === "text"
				? part.text ?? ""
				: `[Slotstream cannot accept image tool results; omitted ${part.mimeType ?? "image"} data.]`,
		)
		.join("\n");
}

/** Convert all pi context messages; replaying history enables Slotstream prefix-cache reuse. */
export function convertRequest(context: Context, options?: SimpleStreamOptions): SlotstreamRequest {
	const prompt: SlotstreamRequest["prompt"] = [];
	if (context.systemPrompt) prompt.push({ role: "system", content: context.systemPrompt });

	for (const message of context.messages) {
		if (message.role === "user") {
			const content = typeof message.content === "string"
				? [{ type: "text" as const, text: message.content }]
				: message.content.map((part) =>
					part.type === "text"
						? { type: "text" as const, text: part.text }
						: { type: "file" as const, mediaType: part.mimeType, data: part.data },
				);
			prompt.push({ role: "user", content });
		} else if (message.role === "assistant") {
			const content: PromptPart[] = message.content.map((part) => {
				if (part.type === "text") return { type: "text", text: part.text };
				if (part.type === "thinking") return { type: "reasoning", text: part.thinking };
				return { type: "tool-call", toolCallId: part.id, toolName: part.name, input: part.arguments };
			});
			prompt.push({ role: "assistant", content });
		} else {
			prompt.push({
				role: "tool",
				content: [{
					type: "tool-result",
					toolCallId: message.toolCallId,
					toolName: message.toolName,
					output: { type: message.isError ? "error-text" : "text", value: toolResultText(message.content) },
				}],
			});
		}
	}

	const request: SlotstreamRequest = { prompt, responseFormat: { type: "text" } };
	if (context.tools?.length) {
		request.tools = context.tools.map((tool) => ({
			type: "function",
			name: tool.name,
			description: tool.description,
			inputSchema: tool.parameters as unknown as object,
		}));
	}
	if (options?.toolChoice) request.toolChoice = { type: options.toolChoice };
	if (options?.maxTokens !== undefined) request.maxOutputTokens = options.maxTokens;
	if (options?.temperature !== undefined) request.temperature = options.temperature;
	request.reasoning = options?.reasoning === "low" || options?.reasoning === "medium"
		? options.reasoning
		: options?.reasoning === "high" || options?.reasoning === "xhigh" || options?.reasoning === "max"
			? "xhigh"
			: "none";
	return request;
}

/** Yield complete SSE data fields, including records split across arbitrary byte chunks. */
export async function* parseSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let data: string[] = [];
	const consumeLine = function* (line: string): Generator<string> {
		if (!line) {
			if (data.length) yield data.join("\n");
			data = [];
		} else if (!line.startsWith(":")) {
			const colon = line.indexOf(":");
			if (colon >= 0 && line.slice(0, colon) === "data") {
				data.push(line.slice(colon + 1).replace(/^ /, ""));
			}
		}
	};
	while (true) {
		const { done, value } = await reader.read();
		buffer += decoder.decode(value, { stream: !done });
		let newline: number;
		while ((newline = buffer.indexOf("\n")) >= 0) {
			let line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			if (line.endsWith("\r")) line = line.slice(0, -1);
			yield* consumeLine(line);
		}
		if (done) break;
	}
	if (buffer.endsWith("\r")) buffer = buffer.slice(0, -1);
	if (buffer) yield* consumeLine(buffer);
	if (data.length) yield data.join("\n");
}

function mapStopReason(reason: string): StopReason {
	if (reason === "stop") return "stop";
	if (reason === "length") return "length";
	if (reason === "tool-calls") return "toolUse";
	return "error";
}

function responseHeaders(headers: Headers): Record<string, string> {
	return Object.fromEntries(headers.entries());
}

export function streamSlotstream(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	void (async () => {
		const output: AssistantMessage = {
			role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "pending", timestamp: Date.now(),
		};
		try {
			let payload: unknown = convertRequest(context, options);
			const replaced = await options?.onPayload?.(payload, model);
			if (replaced !== undefined) payload = replaced;
			if (!payload || typeof payload !== "object") throw new Error("Slotstream payload callback returned a non-object");
			const headers = new Headers({
				"content-type": "application/json",
				"ai-gateway-protocol-version": "0.0.1",
				"ai-language-model-specification-version": "4",
				"ai-language-model-streaming": "true",
				"ai-language-model-id": model.id,
			});
			for (const [name, value] of Object.entries(model.headers ?? {})) headers.set(name, value);
			for (const [name, value] of Object.entries(options?.headers ?? {})) value === null ? headers.delete(name) : headers.set(name, value);
			stream.push({ type: "start", partial: output });
			const response = await (options?.fetch ?? fetch)(model.baseUrl || ENDPOINT, {
				method: "POST", headers, body: JSON.stringify(payload), signal: options?.signal,
			});
			await options?.onResponse?.({ status: response.status, headers: responseHeaders(response.headers) }, model);
			if (!response.ok) throw new Error(`Slotstream HTTP ${response.status}: ${await response.text()}`);
			if (!response.body) throw new Error("Slotstream response has no body");

			const blocks = new Map<string, { index: number; json: string; ended: boolean }>();
			let sawFinish = false;
			for await (const data of parseSseData(response.body)) {
				if (data === "[DONE]") continue;
				let event: any;
				try { event = JSON.parse(data); } catch { throw new Error(`Malformed Slotstream SSE JSON: ${data}`); }
				if (!event || typeof event.type !== "string") throw new Error("Malformed Slotstream SSE event");
				const id = event.id as string;
				const start = (type: "text" | "thinking", eventType: "text_start" | "thinking_start") => {
					if (typeof id !== "string") throw new Error(`Slotstream ${event.type} event has no id`);
					output.content.push(type === "text" ? { type, text: "" } : { type, thinking: "" });
					blocks.set(id, { index: output.content.length - 1, json: "", ended: false });
					stream.push({ type: eventType, contentIndex: output.content.length - 1, partial: output });
				};
				const delta = (type: "text" | "thinking", eventType: "text_delta" | "thinking_delta") => {
					const block = blocks.get(id); if (!block || typeof event.delta !== "string") throw new Error(`Malformed Slotstream ${event.type} event`);
					const content = output.content[block.index];
					if (content.type !== type) throw new Error(`Slotstream ${event.type} block type mismatch`);
					if (content.type === "text") content.text += event.delta;
					else content.thinking += event.delta;
					stream.push({ type: eventType, contentIndex: block.index, delta: event.delta, partial: output });
				};
				switch (event.type) {
					case "stream-start": break;
					case "response-metadata":
						if (typeof event.id === "string") output.responseId = event.id;
						if (typeof event.modelId === "string") output.responseModel = event.modelId;
						if (typeof event.timestamp === "string" || typeof event.timestamp === "number") output.timestamp = typeof event.timestamp === "number" ? event.timestamp : Date.parse(event.timestamp) || output.timestamp;
						break;
					case "text-start": start("text", "text_start"); break;
					case "text-delta": delta("text", "text_delta"); break;
					case "reasoning-start": start("thinking", "thinking_start"); break;
					case "reasoning-delta": delta("thinking", "thinking_delta"); break;
					case "text-end": case "reasoning-end": {
						const block = blocks.get(id); if (!block) throw new Error(`Slotstream ${event.type} event has no block`);
						const content = output.content[block.index]; block.ended = true;
						if (content.type === "text") stream.push({ type: "text_end", contentIndex: block.index, content: content.text, partial: output });
						else if (content.type === "thinking") stream.push({ type: "thinking_end", contentIndex: block.index, content: content.thinking, partial: output });
						break;
					}
					case "tool-input-start": {
						if (typeof id !== "string" || typeof event.toolName !== "string") throw new Error("Malformed Slotstream tool-input-start event");
						output.content.push({ type: "toolCall", id, name: event.toolName, arguments: {} });
						blocks.set(id, { index: output.content.length - 1, json: "", ended: false });
						stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output }); break;
					}
					case "tool-input-delta": {
						const block = blocks.get(id); if (!block || typeof event.delta !== "string") throw new Error("Malformed Slotstream tool-input-delta event");
						block.json += event.delta; stream.push({ type: "toolcall_delta", contentIndex: block.index, delta: event.delta, partial: output }); break;
					}
					case "tool-input-end": {
						const block = blocks.get(id); if (!block) throw new Error("Malformed Slotstream tool-input-end event");
						const tool = output.content[block.index] as ToolCall;
						try { tool.arguments = JSON.parse(block.json); } catch { throw new Error(`Invalid Slotstream tool JSON for ${tool.name}`); }
						block.ended = true; stream.push({ type: "toolcall_end", contentIndex: block.index, toolCall: tool, partial: output }); break;
					}
					case "tool-call": {
						if (typeof event.toolCallId !== "string" || typeof event.toolName !== "string") throw new Error("Malformed Slotstream tool-call event");
						let input: Record<string, unknown>;
						try {
							input = typeof event.input === "string" ? JSON.parse(event.input) : event.input;
						} catch {
							throw new Error(`Invalid Slotstream final tool JSON for ${event.toolName}`);
						}
						if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Malformed Slotstream tool-call input");
						const block = blocks.get(event.toolCallId) ?? [...blocks.values()].reverse().find((candidate) => {
							const tool = output.content[candidate.index]; return tool.type === "toolCall" && tool.name === event.toolName && candidate.ended;
						});
						if (!block) {
							output.content.push({ type: "toolCall", id: event.toolCallId, name: event.toolName, arguments: input });
							const index = output.content.length - 1;
							stream.push({ type: "toolcall_start", contentIndex: index, partial: output });
							stream.push({ type: "toolcall_end", contentIndex: index, toolCall: output.content[index] as ToolCall, partial: output });
						} else {
							const tool = output.content[block.index] as ToolCall; tool.id = event.toolCallId; tool.name = event.toolName; tool.arguments = input;
						}
						break;
					}
					case "error": throw new Error(typeof event.error?.message === "string" ? event.error.message : "Slotstream server error");
					case "finish": {
						const reason = event.finishReason?.unified; if (typeof reason !== "string") throw new Error("Malformed Slotstream finish event");
						output.stopReason = mapStopReason(reason); output.rawStopReason = event.finishReason.raw;
						const usage = event.usage; if (!usage) throw new Error("Malformed Slotstream finish usage");
						output.usage.input = usage.inputTokens?.noCache ?? usage.inputTokens?.total ?? 0;
						output.usage.cacheRead = usage.inputTokens?.cacheRead ?? 0; output.usage.cacheWrite = usage.inputTokens?.cacheWrite ?? 0;
						output.usage.output = usage.outputTokens?.total ?? 0; output.usage.reasoning = usage.outputTokens?.reasoning ?? 0;
						output.usage.totalTokens = output.usage.input + output.usage.cacheRead + output.usage.cacheWrite + output.usage.output;
						calculateCost(model, output.usage); sawFinish = true; break;
					}
					default: break;
				}
			}
			if (!sawFinish) throw new Error("Slotstream stream ended without a finish event");
			if (output.stopReason === "error") throw new Error(`Unknown Slotstream finish reason: ${output.rawStopReason ?? "unknown"}`);
			stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output }); stream.end();
		} catch (error) {
			output.stopReason = options?.signal?.aborted || (error instanceof DOMException && error.name === "AbortError") ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : String(error);
			stream.push({ type: "error", reason: output.stopReason, error: output }); stream.end();
		}
	})();
	return stream;
}

export default function (pi: ExtensionAPI) {
	pi.registerProvider(PROVIDER_ID, {
		baseUrl: ENDPOINT,
		apiKey: "slotstream-local-no-key",
		api: "slotstream-language-model",
		models: [{
			id: MODEL_ID, name: "Qwen 3.8 Flash Next 4-bit (Slotstream)", reasoning: true,
			thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: "medium", high: null, xhigh: "xhigh", max: null },
			input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 8192,
		}],
		streamSimple: streamSlotstream,
	});
}

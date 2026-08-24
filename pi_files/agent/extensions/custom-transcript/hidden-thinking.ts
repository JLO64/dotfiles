import type { AssistantContentBlock, AssistantMessageLike } from "./types.ts";

/** Returns a display-only copy without hidden thinking blocks. */
export function withoutThinking<T extends AssistantMessageLike>(message: T): T {
	return {
		...message,
		content: message.content.filter((block: AssistantContentBlock) => block.type !== "thinking"),
	};
}

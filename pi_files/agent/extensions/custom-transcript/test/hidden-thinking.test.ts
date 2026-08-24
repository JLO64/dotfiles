import { describe, expect, test } from "bun:test";
import { withoutThinking } from "../hidden-thinking.ts";

describe("withoutThinking", () => {
	test("returns a display copy while leaving the source message intact", () => {
		const message = {
			content: [
				{ type: "thinking", thinking: "private" },
				{ type: "text", text: "visible" },
			],
		};
		const display = withoutThinking(message);

		expect(display.content).toEqual([{ type: "text", text: "visible" }]);
		expect(message.content).toHaveLength(2);
	});
});

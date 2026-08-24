import { describe, expect, test } from "bun:test";
import { normalizeAssistantDiffFences } from "../diff-highlighting.ts";

describe("normalizeAssistantDiffFences", () => {
	test("removes indentation before diff additions and removals only", () => {
		const input = "```diff\n  +    added()\n\t-removed()\n context\n @@ unchanged\n```";
		expect(normalizeAssistantDiffFences(input)).toBe(
			"```diff\n+    added()\n-removed()\n context\n @@ unchanged\n```",
		);
	});

	test("does not rewrite non-diff Markdown", () => {
		const input = "```ts\n  + not a diff\n```";
		expect(normalizeAssistantDiffFences(input)).toBe(input);
	});
});

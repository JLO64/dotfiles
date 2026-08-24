const DIFF_FENCE = /```diff\n([\s\S]*?)```/g;

/** Display-only normalization for diff fences emitted with indented markers. */
export function normalizeAssistantDiffFences(markdown: string): string {
	return markdown.replace(DIFF_FENCE, (_match, diffContent: string) => {
		const normalized = diffContent
			.split("\n")
			.map((line) => line.replace(/^\s+(?=[+-])/, ""))
			.join("\n");
		return `\`\`\`diff\n${normalized}\`\`\``;
	});
}

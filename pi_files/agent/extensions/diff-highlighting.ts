import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Fixes diff syntax highlighting when models indent diff markers.
 *
 * Some models output ```diff blocks with leading whitespace before the +/-
 * markers (e.g., "   +added line"), which prevents highlight.js's diff
 * grammar from recognizing them. This extension strips that whitespace
 * before the Markdown component renders the block.
 *
 * Context lines (starting with a space) and @@ hunk headers are left
 * untouched since their leading whitespace cannot be safely distinguished
 * from intentional code indentation.
 */

export default function (pi: ExtensionAPI) {
  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;

    const message = event.message;
    let modified = false;

    const newContent = message.content.map((block: Record<string, unknown>) => {
      // Handle both "text" and "thinking" content blocks —
      // both are rendered through the Markdown component.
      const key =
        block.type === "thinking"
          ? "thinking"
          : block.type === "text"
            ? "text"
            : null;
      if (!key || typeof block[key] !== "string") return block;

      const original = block[key] as string;

      const fixed = original.replace(
        /```diff\n([\s\S]*?)```/g,
        (_match: string, diffContent: string) => {
          const lines = diffContent.split("\n");
          const fixedLines = lines.map((line: string) =>
            // Strip leading whitespace before + or - diff markers only.
            // This preserves intentional code indentation after the marker
            // (e.g., "+    def foo()" keeps its 4-space Python indent).
            line.replace(/^\s+(?=[+-])/, ""),
          );
          return "```diff\n" + fixedLines.join("\n") + "```";
        },
      );

      if (fixed !== original) {
        modified = true;
        return { ...block, [key]: fixed };
      }
      return block;
    });

    if (modified) {
      return { message: { ...message, content: newContent } };
    }
  });
}

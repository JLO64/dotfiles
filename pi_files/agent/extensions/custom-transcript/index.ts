import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCollapsedBuiltinTools } from "./collapsed-tool-output.ts";
import { registerPdfAwareCollapsedRead } from "./pdf-aware-read.ts";
import { installTranscriptCompatibility } from "./compatibility.ts";
import { normalizeAssistantDiffFences } from "./diff-highlighting.ts";
import { installFocusShortcut } from "./transcript-focus.ts";
import type { FocusState } from "./types.ts";

export default function (pi: ExtensionAPI) {
	registerCollapsedBuiltinTools(pi);
	registerPdfAwareCollapsedRead(pi);

	pi.registerMarkdownTransformer((markdown, context) =>
		context.messageType === "assistant" ? normalizeAssistantDiffFences(markdown) : markdown,
	);

	let disposeCompatibility: (() => void) | undefined;
	let disposeFocusShortcut: (() => void) | undefined;
	const focus: FocusState = { active: false };

	pi.on("session_start", (_event, ctx) => {
		focus.active = false;
		ctx.ui.setStatus("custom-transcript-focus", undefined);
		if (ctx.mode !== "tui") return;

		disposeCompatibility?.();
		disposeFocusShortcut?.();
		disposeCompatibility = installTranscriptCompatibility(focus);
		ctx.ui.setHiddenThinkingLabel("");
		disposeFocusShortcut = installFocusShortcut(ctx.ui, focus, () => {
			// setStatus requests a render through Pi's public UI adapter.
		});
	});

	pi.on("session_shutdown", () => {
		disposeFocusShortcut?.();
		disposeFocusShortcut = undefined;
		disposeCompatibility?.();
		disposeCompatibility = undefined;
	});
}

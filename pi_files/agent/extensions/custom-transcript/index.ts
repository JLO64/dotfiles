import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCollapsedBuiltinTools } from "./collapsed-tool-output.ts";
import { registerPdfAwareCollapsedRead } from "./pdf-aware-read.ts";
import { installTranscriptCompatibility } from "./compatibility.ts";
import { normalizeAssistantDiffFences } from "./diff-highlighting.ts";
import { advanceTranscriptCycle, getTranscriptMode } from "./transcript-focus.ts";
import type { FocusState } from "./types.ts";

export default function (pi: ExtensionAPI) {
	registerCollapsedBuiltinTools(pi);
	registerPdfAwareCollapsedRead(pi);

	pi.registerMarkdownTransformer((markdown, context) =>
		context.messageType === "assistant" ? normalizeAssistantDiffFences(markdown) : markdown,
	);

	let disposeCompatibility: (() => void) | undefined;
	const focus: FocusState = { active: false };

	pi.on("session_start", (_event, ctx) => {
		focus.active = false;
		ctx.ui.setStatus("custom-transcript-focus", undefined);
		if (ctx.mode !== "tui") return;

		disposeCompatibility?.();
		disposeCompatibility = installTranscriptCompatibility(focus);
		ctx.ui.setHiddenThinkingLabel("");
		const emitMode = () => pi.events.emit("custom-transcript:mode", getTranscriptMode(focus, ctx.ui));
		pi.events.emit("custom-transcript:cycle", () => {
			advanceTranscriptCycle(focus, ctx.ui);
			emitMode();
		});
		emitMode();
	});

	pi.on("session_shutdown", () => {
		pi.events.emit("custom-transcript:cycle", undefined);
		pi.events.emit("custom-transcript:mode", undefined);
		disposeCompatibility?.();
		disposeCompatibility = undefined;
	});
}

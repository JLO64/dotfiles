import { CustomEditor, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
	isKeyRelease,
	isKeyRepeat,
	type EditorTheme,
	type TUI,
} from "@earendil-works/pi-tui";
import type { FocusState } from "./types.ts";

export type TranscriptMode = "COLLAPSED" | "EXPANDED" | "FOCUSED";

type TranscriptUI = Pick<ExtensionUIContext, "getToolsExpanded" | "setStatus" | "setToolsExpanded">;

/** Derive the displayed mode from Pi's actual expansion state. */
export function getTranscriptMode(state: FocusState, ui: Pick<TranscriptUI, "getToolsExpanded">): TranscriptMode {
	if (state.active) return "FOCUSED";
	return ui.getToolsExpanded() ? "EXPANDED" : "COLLAPSED";
}
type EditorKeybindings = ConstructorParameters<typeof CustomEditor>[2];

/** Advance the cycle from Pi's actual expansion state, not a local index. */
export function advanceTranscriptCycle(state: FocusState, ui: TranscriptUI): void {
	const toolsExpanded = ui.getToolsExpanded();

	if (state.active && toolsExpanded) {
		// This combination is outside the cycle; normalize to its first state.
		state.active = false;
		ui.setToolsExpanded(false);
	} else if (state.active) {
		state.active = false;
		ui.setToolsExpanded(false);
	} else if (toolsExpanded) {
		state.active = true;
		ui.setToolsExpanded(false);
	} else {
		state.active = false;
		ui.setToolsExpanded(true);
	}

	ui.setStatus("custom-transcript-focus", state.active ? "focus transcript" : undefined);
}

class TranscriptCycleEditor extends CustomEditor {
	constructor(
		tui: TUI,
		theme: EditorTheme,
		private readonly cycleKeybindings: EditorKeybindings,
		private readonly focusState: FocusState,
		private readonly ui: TranscriptUI,
	) {
		super(tui, theme, cycleKeybindings);
	}

	override handleInput(data: string): void {
		if (this.cycleKeybindings.matches(data, "app.tools.expand")) {
			if (!isKeyRelease(data) && !isKeyRepeat(data)) {
				advanceTranscriptCycle(this.focusState, this.ui);
			}
			return;
		}

		super.handleInput(data);
	}
}

/** Build a main-editor wrapper so selectors and modal views keep their own bindings. */
export function createTranscriptCycleEditor(state: FocusState, ui: TranscriptUI) {
	return (tui: TUI, theme: EditorTheme, keybindings: EditorKeybindings) =>
		new TranscriptCycleEditor(tui, theme, keybindings, state, ui);
}

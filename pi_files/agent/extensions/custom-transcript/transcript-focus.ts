import { matchesKey } from "@earendil-works/pi-tui";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { FocusState } from "./types.ts";

const CTRL_H = "\x08";

/**
 * Ghostty can send multiple indistinguishable enhanced reports for one key
 * action. Suppress matching reports within this short window without timers.
 */
export const CTRL_H_DEBOUNCE_MS = 200;

/**
 * Ctrl+H and Backspace are both \x08 in legacy terminals. Only enhanced
 * keyboard reports are distinguishable, so legacy \x08 is deliberately left
 * alone to avoid consuming ordinary Backspace.
 */
export function isDistinguishableCtrlH(data: string): boolean {
	return data !== CTRL_H && matchesKey(data, "ctrl+h");
}

export function toggleFocus(state: FocusState, ui: Pick<ExtensionUIContext, "setStatus">): void {
	state.active = !state.active;
	ui.setStatus("custom-transcript-focus", state.active ? "focus transcript" : undefined);
}

export function installFocusShortcut(
	ui: Pick<ExtensionUIContext, "onTerminalInput" | "setStatus">,
	state: FocusState,
	onToggle: () => void,
	now: () => number = () => performance.now(),
): () => void {
	let lastToggleAt = -Infinity;

	return ui.onTerminalInput((data) => {
		if (!isDistinguishableCtrlH(data)) return;

		const timestamp = now();
		if (timestamp - lastToggleAt >= CTRL_H_DEBOUNCE_MS) {
			lastToggleAt = timestamp;
			toggleFocus(state, ui);
			onToggle();
		}

		// Consume both the accepted event and suppressed enhanced duplicates.
		return { consume: true };
	});
}

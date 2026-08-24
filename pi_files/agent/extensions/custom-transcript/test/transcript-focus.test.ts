import { describe, expect, test } from "bun:test";
import {
	CTRL_H_DEBOUNCE_MS,
	installFocusShortcut,
	isDistinguishableCtrlH,
	toggleFocus,
} from "../transcript-focus.ts";

const PRESS = "\x1b[104;5:1u";
const REPEAT = "\x1b[104;5:2u";
const RELEASE = "\x1b[104;5:3u";

describe("focus shortcut state", () => {
	test("does not steal legacy Backspace / Ctrl+H input", () => {
		expect(isDistinguishableCtrlH("\x08")).toBe(false);
	});

	test("recognizes distinguishable Ctrl+H press, repeat, and release reports", () => {
		// CSI-u: codepoint 104 (h); modifier 5 (Ctrl, one-indexed); event type
		// 1 = press, 2 = repeat, 3 = release.
		expect(isDistinguishableCtrlH(PRESS)).toBe(true);
		expect(isDistinguishableCtrlH(REPEAT)).toBe(true);
		expect(isDistinguishableCtrlH(RELEASE)).toBe(true);
	});

	test("toggles once and consumes press plus release reports", () => {
		const statuses: Array<string | undefined> = [];
		let handler: ((data: string) => { consume: true } | undefined) | undefined;
		let timestamp = 0;
		const ui = {
			onTerminalInput: (callback: (data: string) => { consume: true } | undefined) => {
				handler = callback;
				return () => {};
			},
			setStatus: (_key: string, value: string | undefined) => statuses.push(value),
		};
		const state = { active: false };
		let toggles = 0;
		installFocusShortcut(ui, state, () => toggles++, () => timestamp);

		expect(handler?.("\x08")).toBeUndefined();
		expect(handler?.(PRESS)).toEqual({ consume: true });
		timestamp += 1;
		expect(handler?.(RELEASE)).toEqual({ consume: true });
		expect(state.active).toBe(true);
		expect(toggles).toBe(1);
		expect(statuses).toEqual(["focus transcript"]);
	});

	test("suppresses rapid repeats and releases, then accepts a later Ctrl+H", () => {
		let handler: ((data: string) => { consume: true } | undefined) | undefined;
		let timestamp = 0;
		const ui = {
			onTerminalInput: (callback: (data: string) => { consume: true } | undefined) => {
				handler = callback;
				return () => {};
			},
			setStatus: () => {},
		};
		const state = { active: false };
		let toggles = 0;
		installFocusShortcut(ui, state, () => toggles++, () => timestamp);

		expect(handler?.(PRESS)).toEqual({ consume: true });
		timestamp += 1;
		expect(handler?.(REPEAT)).toEqual({ consume: true });
		timestamp += 1;
		expect(handler?.(RELEASE)).toEqual({ consume: true });
		expect(toggles).toBe(1);

		timestamp += CTRL_H_DEBOUNCE_MS;
		expect(handler?.(PRESS)).toEqual({ consume: true });
		expect(state.active).toBe(false);
		expect(toggles).toBe(2);
	});

	test("toggles ephemerally and updates the status indicator", () => {
		const statuses: Array<string | undefined> = [];
		const state = { active: false };
		const ui = { setStatus: (_key: string, value: string | undefined) => statuses.push(value) };

		toggleFocus(state, ui);
		expect(state.active).toBe(true);
		toggleFocus(state, ui);
		expect(state.active).toBe(false);
		expect(statuses).toEqual(["focus transcript", undefined]);
	});
});

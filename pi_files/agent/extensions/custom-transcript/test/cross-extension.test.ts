import { describe, expect, test } from "bun:test";
import customTranscript from "../index.ts";
import piVim from "../../pi-vim/index.ts";

type Listener = (data: unknown) => void;

function createEventBus() {
	const listeners = new Map<string, Set<Listener>>();
	return {
		emit(channel: string, data: unknown) {
			listeners.get(channel)?.forEach((listener) => listener(data));
		},
		on(channel: string, listener: Listener) {
			const channelListeners = listeners.get(channel) ?? new Set<Listener>();
			channelListeners.add(listener);
			listeners.set(channel, channelListeners);
			return () => channelListeners.delete(listener);
		},
	};
}

describe("custom-transcript and pi-vim integration", () => {
	test("the active ModalEditor consumes the configured tool action for the three-state cycle", () => {
		const handlers: Record<string, Array<(event: unknown, ctx: any) => void>> = {};
		const events = createEventBus();
		const pi = {
			events,
			on: (event: string, handler: (event: unknown, ctx: any) => void) => {
				(handlers[event] ??= []).push(handler);
			},
			registerTool: () => {},
			registerMarkdownTransformer: () => {},
			getCommands: () => [],
		};
		customTranscript(pi as any);
		piVim(pi as any);

		let expanded = false;
		const statuses: Array<string | undefined> = [];
		const transcriptCtx = {
			mode: "tui",
			ui: {
				setStatus: (_key: string, value: string | undefined) => statuses.push(value),
				getToolsExpanded: () => expanded,
				setToolsExpanded: (value: boolean) => { expanded = value; },
				setHiddenThinkingLabel: () => {},
			},
		};
		let editor: { handleInput: (data: string) => void; render: (width: number) => string[] } | undefined;
		let badge: { render: (width: number) => string[] } | undefined;
		let widgetCleared = false;
		let overlayMounts = 0;
		const vimCtx = {
			cwd: process.cwd(),
			ui: {
				setWorkingVisible: () => {},
				addAutocompleteProvider: () => {},
				theme: {
					fg: (_name: string, text: string) => text,
					inverse: (text: string) => text,
				},
				setWidget: (_key: string, widget: any) => {
					if (!widget) {
						widgetCleared = true;
						return;
					}
					badge = widget(
						{ requestRender: () => {} },
						{
							fg: (_name: string, text: string) => text,
							inverse: (text: string) => text,
						},
					);
				},
				setEditorComponent: (factory: (...args: any[]) => any) => {
					editor = factory(
						{ terminal: { rows: 40 }, requestRender: () => {}, showOverlay: () => { overlayMounts++; } },
						{ borderColor: (text: string) => text, selectList: {} },
						{ matches: (data: string, key: string) => key === "app.tools.expand" && data === "configured-expand" },
					);
				},
			},
		};

		handlers.session_start[0]!({}, transcriptCtx);
		handlers.session_start[1]!({}, vimCtx);
		expect(editor).toBeDefined();
		expect(badge?.render(80)[0]).toBe(`${" ".repeat(65)}╭─COLLAPSED─╮`);
		expect(editor!.render(80)[0]).toBe(`╭${"─".repeat(64)}╯${" ".repeat(13)}│`);

		editor!.handleInput("configured-expand");
		expect(expanded).toBe(true);
		expect(badge?.render(80)[0]).toBe(`${" ".repeat(66)}╭─EXPANDED─╮`);
		expect(editor!.render(80)[0]).toBe(`╭${"─".repeat(65)}╯${" ".repeat(12)}│`);
		editor!.handleInput("configured-expand");
		expect([expanded, statuses.at(-1)]).toEqual([false, "focus transcript"]);
		expect(badge?.render(80)[0]).toBe(`${" ".repeat(67)}╭─FOCUSED─╮`);
		expect(editor!.render(80)[0]).toBe(`╭${"─".repeat(66)}╯${" ".repeat(11)}│`);
		editor!.handleInput("configured-expand");
		expect([expanded, statuses.at(-1)]).toEqual([false, undefined]);
		expect(badge?.render(80)[0]).toBe(`${" ".repeat(65)}╭─COLLAPSED─╮`);

		handlers.session_shutdown[0]!({}, transcriptCtx);
		handlers.session_shutdown[1]!({}, vimCtx);
		expect(widgetCleared).toBe(true);
		expect(overlayMounts).toBe(0);
	});
});

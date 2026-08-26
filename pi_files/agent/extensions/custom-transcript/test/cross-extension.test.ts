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
		let editor: { handleInput: (data: string) => void } | undefined;
		const vimCtx = {
			cwd: process.cwd(),
			ui: {
				setWorkingVisible: () => {},
				addAutocompleteProvider: () => {},
				theme: { fg: (_name: string, text: string) => text },
				setEditorComponent: (factory: (...args: any[]) => any) => {
					editor = factory(
						{ terminal: { rows: 40 }, requestRender: () => {} },
						{ borderColor: (text: string) => text, selectList: {} },
						{ matches: (data: string, key: string) => key === "app.tools.expand" && data === "configured-expand" },
					);
				},
			},
		};

		handlers.session_start[0]!({}, transcriptCtx);
		handlers.session_start[1]!({}, vimCtx);
		expect(editor).toBeDefined();

		editor!.handleInput("configured-expand");
		expect(expanded).toBe(true);
		editor!.handleInput("configured-expand");
		expect([expanded, statuses.at(-1)]).toEqual([false, "focus transcript"]);
		editor!.handleInput("configured-expand");
		expect([expanded, statuses.at(-1)]).toEqual([false, undefined]);

		for (const handler of handlers.session_shutdown ?? []) handler({}, {});
	});
});

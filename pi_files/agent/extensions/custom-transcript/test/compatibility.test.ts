import { describe, expect, test } from "bun:test";
import {
	AssistantMessageComponent,
	InteractiveMode,
	initTheme,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { installTranscriptCompatibility } from "../compatibility.ts";

const WIDTH = 80;
initTheme(undefined, false);

function assistant(text: string): AssistantMessageComponent {
	return new AssistantMessageComponent({ content: [{ type: "text", text }] } as any);
}

function user(text: string): UserMessageComponent {
	return new UserMessageComponent(text);
}

function withFocus(testCase: (state: { active: boolean }) => void): void {
	const state = { active: false };
	const dispose = installTranscriptCompatibility(state);
	try {
		testCase(state);
	} finally {
		dispose();
	}
}

describe("tool-output notice suppression", () => {
	test("suppresses only exact expansion notices and restores showStatus on disposal", () => {
		const prototype = InteractiveMode.prototype as unknown as {
			showStatus: (message: string) => void;
		};
		const originalShowStatus = prototype.showStatus;
		const received: string[] = [];
		prototype.showStatus = (message: string) => received.push(message);

		const disposeFirst = installTranscriptCompatibility({ active: false });
		const disposeSecond = installTranscriptCompatibility({ active: false });
		try {
			prototype.showStatus.call({} as InteractiveMode, "Tool output: expanded");
			prototype.showStatus.call({} as InteractiveMode, "Tool output: collapsed");
			prototype.showStatus.call({} as InteractiveMode, "Tool output: failed");
			prototype.showStatus.call({} as InteractiveMode, "Thinking level: high");
			expect(received).toEqual(["Tool output: failed", "Thinking level: high"]);

			disposeSecond();
			prototype.showStatus.call({} as InteractiveMode, "Tool output: expanded");
			expect(received).toEqual(["Tool output: failed", "Thinking level: high"]);
		} finally {
			disposeFirst();
		}

		expect(prototype.showStatus).not.toBe(originalShowStatus);
		prototype.showStatus.call({} as InteractiveMode, "Tool output: expanded");
		expect(received).toEqual(["Tool output: failed", "Thinking level: high", "Tool output: expanded"]);
		prototype.showStatus = originalShowStatus;
	});
});

describe("focus transcript spacing", () => {
	test("recognizes a transcript root populated before compatibility installation", () => {
		const root = new Container();
		const prior = assistant("prior response");
		const hidden = { invalidate: () => {}, render: () => ["hidden transcript content"] };
		const next = user("next request");
		root.addChild(prior);
		root.addChild(hidden);
		root.addChild(next);

		const state = { active: true };
		const dispose = installTranscriptCompatibility(state);
		try {
			expect(root.render(WIDTH)).toEqual([...prior.render(WIDTH), "", ...next.render(WIDTH)]);
		} finally {
			dispose();
		}
	});

	test("inserts one separator between an assistant message and a user message", () => {
		withFocus((state) => {
			const root = new Container();
			const prior = assistant("prior response");
			const next = user("next request");
			root.addChild(prior);
			root.addChild(next);

			state.active = true;
			expect(root.render(WIDTH)).toEqual([...prior.render(WIDTH), "", ...next.render(WIDTH)]);
		});
	});

	test("does not add spacing below a user message before an assistant response", () => {
		withFocus((state) => {
			const root = new Container();
			const prior = user("prior request");
			const next = assistant("next response");
			root.addChild(prior);
			root.addChild(next);

			state.active = true;
			expect(root.render(WIDTH)).toEqual([...prior.render(WIDTH), ...next.render(WIDTH)]);
		});
	});

	test("inserts one separator before each consecutive user message after the first", () => {
		withFocus((state) => {
			const root = new Container();
			const first = user("first request");
			const second = user("second request");
			root.addChild(first);
			root.addChild(second);

			state.active = true;
			expect(root.render(WIDTH)).toEqual([...first.render(WIDTH), "", ...second.render(WIDTH)]);
		});
	});

	test("does not insert a leading separator before the first visible user message", () => {
		withFocus((state) => {
			const root = new Container();
			const hidden = { invalidate: () => {}, render: () => ["hidden transcript content"] };
			const visible = user("visible request");
			root.addChild(hidden);
			root.addChild(visible);

			state.active = true;
			expect(root.render(WIDTH)).toEqual(visible.render(WIDTH));
		});
	});

	test("restores unfiltered rendering when focus is toggled off and reapplies the seam when on", () => {
		withFocus((state) => {
			const root = new Container();
			const prior = assistant("prior response");
			const hidden = { invalidate: () => {}, render: () => ["hidden transcript content"] };
			const next = user("next request");
			root.addChild(prior);
			root.addChild(hidden);
			root.addChild(next);

			expect(root.render(WIDTH)).toEqual([...prior.render(WIDTH), ...hidden.render(), ...next.render(WIDTH)]);
			state.active = true;
			expect(root.render(WIDTH)).toEqual([...prior.render(WIDTH), "", ...next.render(WIDTH)]);
			state.active = false;
			expect(root.render(WIDTH)).toEqual([...prior.render(WIDTH), ...hidden.render(), ...next.render(WIDTH)]);
			state.active = true;
			expect(root.render(WIDTH)).toEqual([...prior.render(WIDTH), "", ...next.render(WIDTH)]);
		});
	});
});

import { describe, expect, test } from "bun:test";
import { advanceTranscriptCycle } from "../transcript-focus.ts";

function createUi(expanded = false) {
	const statuses: Array<string | undefined> = [];
	return {
		ui: {
			getToolsExpanded: () => expanded,
			setStatus: (_key: string, value: string | undefined) => statuses.push(value),
			setToolsExpanded: (value: boolean) => {
				expanded = value;
			},
		},
		statuses,
		toolsExpanded: () => expanded,
	};
}

describe("transcript cycle", () => {
	test("cycles through collapsed, expanded, and focus states", () => {
		const { ui, statuses, toolsExpanded } = createUi();
		const state = { active: false };

		advanceTranscriptCycle(state, ui);
		expect([state.active, toolsExpanded()]).toEqual([false, true]);
		advanceTranscriptCycle(state, ui);
		expect([state.active, toolsExpanded()]).toEqual([true, false]);
		advanceTranscriptCycle(state, ui);
		expect([state.active, toolsExpanded()]).toEqual([false, false]);
		expect(statuses).toEqual([undefined, "focus transcript", undefined]);
	});

	test("uses the actual tool expansion state", () => {
		const { ui, toolsExpanded } = createUi(true);
		const state = { active: false };

		advanceTranscriptCycle(state, ui);
		expect([state.active, toolsExpanded()]).toEqual([true, false]);
	});

	test("normalizes focus with expanded tools to collapsed without focus", () => {
		const { ui, statuses, toolsExpanded } = createUi(true);
		const state = { active: true };

		advanceTranscriptCycle(state, ui);
		expect([state.active, toolsExpanded()]).toEqual([false, false]);
		expect(statuses).toEqual([undefined]);
	});
});

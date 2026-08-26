import { describe, expect, test } from "bun:test";
import { Box, Text } from "@earendil-works/pi-tui";
import { withCollapsedResult } from "../collapsed-tool-output.ts";

const theme = { fg: (_name: string, value: string) => value };

describe("collapsed edit previews", () => {
	test("hides only the edit preview body and restores it when expanded", () => {
		const state = { preview: "cached diff" };
		const edit = withCollapsedResult({
			name: "edit",
			label: "edit",
			description: "test edit",
			parameters: {} as any,
			execute: async () => ({ content: [] }),
			renderCall: (_args: unknown, _theme: unknown, context: any) => {
				const component = context.lastComponent ?? new Box(0, 0, (text) => text);
				component.clear();
				component.addChild(new Text("edit file.ts", 0, 0));
				component.addChild(new Text(state.preview, 0, 0));
				return component;
			},
		} as any);
		const context = { expanded: false, state, lastComponent: undefined } as any;

		const collapsed = edit.renderCall?.({}, theme as any, context);
		expect(collapsed?.render(80).join("\n").trimEnd()).toBe("edit file.ts");
		expect(state.preview).toBe("cached diff");

		context.expanded = true;
		context.lastComponent = collapsed;
		const expanded = edit.renderCall?.({}, theme as any, context);
		expect(expanded?.render(80).join("\n")).toContain("edit file.ts");
		expect(expanded?.render(80).join("\n")).toContain("cached diff");
	});
});

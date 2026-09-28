import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatSectionHeader, getResultBorderColorizer, getSubagentSpinnerFrame, renderResultBox } from "../index.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

const theme = {
	fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
	bold: (text: string) => `<bold>${text}</bold>`,
	inverse: (text: string) => `<inverse>${text}</inverse>`,
};

describe("subagent result boxes", () => {
	test("renders rounded box geometry at the requested ANSI-aware width", () => {
		const lines = renderResultBox(["ok", "\x1b[31mred\x1b[39m"], 8, (text) => text);
		assert.deepEqual(lines, ["╭──────╮", "│ ok   │", "│ \x1b[31mred\x1b[39m  │", "╰──────╯"]);
		assert.ok(lines.every((line) => visibleWidth(line) === 8));
	});

	test("connects section header pills to the border and preserves row width", () => {
		const header = formatSectionHeader("Tools", { ...theme, bold: (text) => text }, (text) => text);
		assert.equal(header, "\u0000─Tools");
		const lines = renderResultBox([header], 24, (text) => text);
		assert.match(lines[1]!, /^├─/);
		assert.ok(lines.every((line) => visibleWidth(line) === 24));
	});

	test("styles section pill labels with the active status color", () => {
		for (const status of ["running", "success", "failure"] as const) {
			const colorize = getResultBorderColorizer(status, theme);
			const header = formatSectionHeader("Input", theme, colorize);
			assert.match(header, /<bold>.*Input.*<\/bold>/);
			if (status === "success") assert.match(header, /<accent>Input<\/accent>/);
			if (status === "running") assert.match(header, /235;188;186/);
			if (status === "failure") assert.match(header, /235;111;146/);
		}
	});

	test("does not overflow when there is no room for the frame", () => {
		for (const width of [0, 1, 2]) {
			const lines = renderResultBox(["content"], width, (text) => text);
			assert.ok(lines.every((line) => visibleWidth(line) <= width));
		}
	});

	test("selects streaming, insertion accent, and Love failure border colors", () => {
		assert.match(getResultBorderColorizer("running", theme)("│"), /235;188;186/);
		assert.equal(getResultBorderColorizer("success", theme)("│"), "<accent>│</accent>");
		assert.match(getResultBorderColorizer("failure", theme)("│"), /235;111;146/);
	});

	test("cycles the pi-vim braille spinner every 100ms", () => {
		assert.equal(getSubagentSpinnerFrame(0), "⠋");
		assert.equal(getSubagentSpinnerFrame(100), "⠙");
		assert.equal(getSubagentSpinnerFrame(1000), "⠋");
		assert.equal(getSubagentSpinnerFrame(-100), "⠏");
	});
});

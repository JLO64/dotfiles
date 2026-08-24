import { describe, expect, test } from "bun:test";
import { createPdfAwareReadToolDefinition } from "../pdf-aware-read.ts";

const theme = {
	fg: (_name: string, value: string) => value,
	bold: (value: string) => value,
};

const context = {
	args: { path: "document.txt" },
	cwd: process.cwd(),
	isError: false,
	showImages: true,
};

describe("PDF-aware read rendering", () => {
	test("keeps Pi's read call header and collapses only the result", () => {
		const read = createPdfAwareReadToolDefinition(process.cwd());
		const call = read.renderCall?.({ path: "document.txt" }, theme as any, {
			cwd: process.cwd(),
			expanded: false,
		} as any);
		expect(call?.render(120).join("\n")).toContain("read ");
		expect(call?.render(120).join("\n")).toContain("document.txt");

		const result = { content: [{ type: "text" as const, text: "complete standard read result" }] };
		const collapsed = read.renderResult?.(result, { expanded: false } as any, theme as any, context as any);
		expect(collapsed?.children).toHaveLength(0);

		const expanded = read.renderResult?.(result, { expanded: true } as any, theme as any, context as any);
		expect(expanded?.render(120).join("\n")).toContain("complete standard read result");
	});
});

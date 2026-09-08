import { describe, expect, test } from "bun:test";
import {
  getMarkdownHighlightSpans,
  type MarkdownHighlightStyle,
} from "../markdown-highlighting.ts";
import { ModalEditor } from "../index.ts";

function highlightedText(lines: string[], style: MarkdownHighlightStyle): string[] {
  const spans = getMarkdownHighlightSpans(lines);
  return spans.flatMap((lineSpans, line) =>
    lineSpans
      .filter((span) => span.style === style)
      .map((span) => lines[line]!.slice(span.start, span.end)),
  );
}

describe("Markdown input highlighting", () => {
  test("uses the application theme when rendering the editor", () => {
    const tui = { terminal: { rows: 40 }, requestRender: () => {} };
    const editorTheme = { borderColor: (text: string) => text, selectList: {} };
    const appTheme = {
      fg: (color: string, text: string) => `\x1b[31m${text}\x1b[39m`,
      bold: (text: string) => text,
      italic: (text: string) => text,
      strikethrough: (text: string) => text,
    };
    const editor = new ModalEditor(
      tui as any,
      editorTheme as any,
      { matches: () => false } as any,
      null,
      null,
      null,
      undefined,
      undefined,
      appTheme,
    );
    editor.setText("Read @README.md and `code`");

    const rendered = editor.render(80).join("\n");
    expect(rendered).toContain("\x1b[31m@\x1b[39m");
    expect(rendered).toContain("\x1b[31m`\x1b[39m");
  });

  test("recognizes common block syntax", () => {
    const lines = [
      "## Heading",
      "> quoted text",
      "- list item",
      "---",
    ];

    expect(highlightedText(lines, "heading")).toEqual(["## Heading"]);
    expect(highlightedText(lines, "quoteBorder")).toEqual([">"]);
    expect(highlightedText(lines, "quote")).toEqual([" quoted text"]);
    expect(highlightedText(lines, "listBullet")).toEqual(["-"]);
    expect(highlightedText(lines, "hr")).toEqual(["---"]);
  });

  test("recognizes inline Markdown", () => {
    const lines = ["Use `code`, **bold**, *italic*, ~~old~~, and [docs](https://pi.dev)."];

    expect(highlightedText(lines, "code")).toEqual(["`code`"]);
    expect(highlightedText(lines, "bold")).toEqual(["**bold**"]);
    expect(highlightedText(lines, "italic")).toEqual(["*italic*"]);
    expect(highlightedText(lines, "strikethrough")).toEqual(["~~old~~"]);
    expect(highlightedText(lines, "link")).toEqual(["docs"]);
    expect(highlightedText(lines, "linkUrl")).toEqual(["https://pi.dev"]);
  });

  test("tracks fenced code blocks across lines", () => {
    const lines = ["```ts", "const value = @not-a-reference;", "```", "plain"];

    expect(highlightedText(lines, "codeBlockBorder")).toEqual(["```ts", "```"]);
    expect(highlightedText(lines, "codeBlock")).toEqual(["const value = @not-a-reference;"]);
    expect(highlightedText(lines, "code")).toEqual([]);
  });

  test("colors file references like inline code", () => {
    const lines = [
      "Read @README.md and @src/editor.ts.",
      "Also @./local-file and @\"docs/path with spaces.md\"",
    ];

    expect(highlightedText(lines, "code")).toEqual([
      "@README.md",
      "@src/editor.ts",
      "@./local-file",
      "@\"docs/path with spaces.md\"",
    ]);
  });

  test("ignores escaped references and emails while accepting any @ token", () => {
    const lines = [String.raw`Ignore \@README.md and me@example.com, but color @someone.`];
    expect(highlightedText(lines, "code")).toEqual(["@someone"]);
  });

  test("colors subagent references like inline code without matching headings", () => {
    const lines = [
      "Ask #online-researcher and #local-researcher.",
      String.raw`Ignore \#reviewer.`,
      "# Markdown heading",
    ];

    expect(highlightedText(lines, "code")).toEqual([
      "#online-researcher",
      "#local-researcher",
    ]);
    expect(highlightedText(lines, "heading")).toEqual(["# Markdown heading"]);
  });
});

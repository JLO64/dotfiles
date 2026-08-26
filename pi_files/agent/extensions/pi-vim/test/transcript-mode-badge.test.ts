import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ModalEditor } from "../index.ts";
import { getRaisedTabLayout, TranscriptModeBadge } from "../transcript-mode-badge.ts";

const theme = {
  fg: (_color: "accent", text: string) => `\x1b[38;5;6m${text}\x1b[39m`,
  inverse: (text: string) => `\x1b[7m${text}\x1b[27m`,
};

const stripAnsi = (text: string) => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");

describe("transcript mode badge", () => {
  test("right-aligns each compact pill with un-inverted caps and an inverted body", () => {
    const cyan = (text: string) => `\x1b[38;5;6m${text}\x1b[39m`;
    const badge = new TranscriptModeBadge(theme, "COLLAPSED", undefined, () => cyan);

    for (const mode of ["COLLAPSED", "EXPANDED", "FOCUSED"] as const) {
      badge.setMode(mode);
      const line = badge.render(24)[0]!;
      expect(visibleWidth(line)).toBe(24);
      expect(stripAnsi(line)).toBe(`${" ".repeat(24 - `╭─${mode}─╮`.length)}╭─${mode}─╮`);
      expect(line).toBe(
        `${" ".repeat(24 - `╭─${mode}─╮`.length)}\x1b[38;5;6m╭─\x1b[39m\x1b[38;5;6m\x1b[39m\x1b[7m\x1b[38;5;6m${mode}\x1b[39m\x1b[27m\x1b[38;5;6m\x1b[39m\x1b[38;5;6m─╮\x1b[39m`,
      );
    }
  });

  test("synchronizes with the active editor border color in every mode and while streaming", () => {
    const colors = {
      INSERT: "\x1b[38;5;2m",
      NORMAL: "\x1b[38;5;7m",
      VISUAL: "\x1b[38;5;5m",
      SHELL: "\x1b[38;2;62;143;176m",
      STREAMING: "\x1b[38;2;234;154;151m",
    } as const;
    const colorizer = (color: string) => (text: string) => `${color}${text}\x1b[39m`;
    const editor = new ModalEditor(
      { terminal: { rows: 40 }, requestRender: () => {} } as any,
      { borderColor: (text: string) => text, selectList: {} } as any,
      { matches: () => false } as any,
      null,
      {
        insert: colorizer(colors.INSERT),
        normal: colorizer(colors.NORMAL),
        visual: colorizer(colors.VISUAL),
      },
      null,
      undefined,
      () => "COLLAPSED",
    );
    editor.focused = true;
    const badge = new TranscriptModeBadge(theme, "COLLAPSED", undefined, () => editor.getBorderColorizer());
    const assertColor = (color: string) => {
      const line = badge.render(24)[0]!;
      expect(line).toContain(`${color}\x1b[39m`);
      expect(line).toContain(`\x1b[7m${color}COLLAPSED\x1b[39m\x1b[27m`);
      expect(line).toContain(`${color}\x1b[39m`);
    };

    editor.handleInput("\x1b");
    assertColor(colors.NORMAL);
    editor.handleInput("i");
    assertColor(colors.INSERT);
    editor.handleInput("\x1b");
    editor.handleInput("v");
    assertColor(colors.VISUAL);
    editor.setText("!git status");
    assertColor(colors.SHELL);
    editor.lock();
    assertColor(colors.STREAMING);
    editor.unlock();
  });

  test("hides the widget safely when the connected geometry cannot fit and rerenders on mode changes", () => {
    let renders = 0;
    const badge = new TranscriptModeBadge(theme, "COLLAPSED", () => { renders++; });

    for (const width of [0, 1, 3, 8, 16]) {
      expect(badge.render(width)).toEqual([]);
    }
    expect(getRaisedTabLayout(17, "COLLAPSED")).toEqual({ tabLeft: 2, tabWidth: 15 });

    badge.setMode("FOCUSED");
    expect(renders).toBe(1);
    expect(stripAnsi(badge.render(20)[0]!)).toBe(`${" ".repeat(7)}╭─FOCUSED─╮`);
  });
});

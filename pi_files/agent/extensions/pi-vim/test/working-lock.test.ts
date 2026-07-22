import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ModalEditor } from "../index.ts";

const ACCENT = "\x1b[38;5;200m";
const RESET = "\x1b[39m";
const accentColorize = (s: string) => `${ACCENT}${s}${RESET}`;
const PILL_GLYPHS = "\u{e0b6}████████\u{e0b4}";
const PILL_WIDTH = visibleWidth(PILL_GLYPHS);
const EXPECTED_FRAME_INTERVAL_MS = 1000 / 30;

function makeEditor(): ModalEditor {
  const tui = {
    terminal: { rows: 40 },
    requestRender: () => {},
  };
  const theme = {
    borderColor: (text: string) => text,
    selectList: {},
  };
  const keybindings = { matches: () => false };
  const editor = new ModalEditor(
    tui as any,
    theme as any,
    keybindings as any,
  );
  editor.setAccentColorizer(accentColorize);
  editor.focused = true;
  return editor;
}

function countLeadingSpaces(row: string): number {
  let count = 0;
  for (const ch of row) {
    if (ch === " ") count++;
    else break;
  }
  return count;
}

function extractVisiblePill(row: string): string {
  // Remove ANSI color codes and trailing spaces.
  return row
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\s+$/g, "");
}

describe("input lock", () => {
  test("starts locked and swallows printable input", () => {
    const editor = makeEditor();
    editor.setText("before lock");
    editor.lock();

    expect(editor.isLocked()).toBe(true);

    editor.handleInput("a");
    editor.handleInput("i");
    editor.handleInput("\n");

    expect(editor.getText()).toBe("before lock");
  });

  test("lets Esc through to abort", () => {
    const editor = makeEditor();
    editor.lock();

    const original = CustomEditor.prototype.handleInput;
    let passed: string | null = null;
    CustomEditor.prototype.handleInput = function (data: string): void {
      passed = data;
    };

    try {
      editor.handleInput("\x1b");
    } finally {
      CustomEditor.prototype.handleInput = original;
    }

    expect(passed).toBe("\x1b");
  });

  test("unlocks and prefills the editor", () => {
    const editor = makeEditor();
    editor.setText("old");
    editor.lock();
    editor.unlock("new prefilled text");

    expect(editor.isLocked()).toBe(false);
    expect(editor.getText()).toBe("new prefilled text");
  });

  test("unlock without prefill leaves existing text in place", () => {
    const editor = makeEditor();
    editor.setText("kept");
    editor.lock();
    editor.unlock();

    expect(editor.getText()).toBe("kept");
  });
});

describe("working scanner rendering", () => {
  test("renders exactly two rows", () => {
    const editor = makeEditor();
    editor.lock();

    const rendered = editor.render(50);
    expect(rendered.length).toBe(2);
    expect(visibleWidth(rendered[0]!)).toBe(50);
    expect(rendered[1]).toBe(" ".repeat(50));
  });

  test("renders the exact accent-colored pill", () => {
    const editor = makeEditor();
    editor.lock();

    const [row, blank] = editor.render(50);
    expect(row).toContain(PILL_GLYPHS);
    expect(row).toContain(ACCENT);
    expect(row).toContain(RESET);
    expect(visibleWidth(row)).toBe(50);
    expect(blank).toBe(" ".repeat(50));
  });

  test("locked view has no borders, labels, or text", () => {
    const editor = makeEditor();
    editor.lock();

    const rendered = editor.render(50).join("\n");
    expect(rendered).not.toContain("Working");
    expect(rendered).not.toContain("abort");
    expect(rendered).not.toContain("WORKING");
    expect(rendered).not.toContain("│");
    expect(rendered).not.toContain("╭");
    expect(rendered).not.toContain("╰");
    expect(rendered).not.toContain("─");
  });

  test("adapts the pill to terminal width", () => {
    const editor = makeEditor();
    editor.lock();

    for (const width of [0, 1, 2, 3, 4, 5, 8, 30, 80]) {
      const rendered = editor.render(width);
      expect(rendered.length).toBe(2);
      expect(visibleWidth(rendered[0]!)).toBeLessThanOrEqual(width);
      expect(visibleWidth(rendered[1]!)).toBeLessThanOrEqual(width);
    }
  });

  test("narrow widths render the longest safe pill prefix", () => {
    const editor = makeEditor();
    editor.lock();

    for (let width = 0; width < PILL_WIDTH; width++) {
      const [row, blank] = editor.render(width);
      const visible = extractVisiblePill(row);
      let expectedPrefix = "";
      let expectedWidth = 0;
      for (const char of PILL_GLYPHS) {
        const w = visibleWidth(char);
        if (expectedWidth + w > width) break;
        expectedPrefix += char;
        expectedWidth += w;
      }
      expect(visible).toBe(expectedPrefix);
      expect(visibleWidth(row)).toBe(width);
      expect(blank).toBe(width > 0 ? " ".repeat(width) : "");
    }
  });

  test("pill position is leftmost at the start of the traversal", () => {
    const editor = makeEditor();
    let now = 0;
    editor.setNowFn(() => now);
    editor.lock();

    const row = editor.render(40)[0]!;
    expect(countLeadingSpaces(row)).toBe(0);
  });

  test("blank second row has no text or ANSI across widths", () => {
    const editor = makeEditor();
    editor.lock();

    for (const width of [0, 1, 5, 10, 50, 80]) {
      const [, blank] = editor.render(width);
      expect(blank.replace(/\s/g, "")).toBe("");
      expect(blank).toBe(width > 0 ? " ".repeat(width) : "");
    }
  });

  test("pill travels one-way left-to-right over 2400ms", () => {
    const editor = makeEditor();
    let now = 0;
    editor.setNowFn(() => now);
    editor.lock();

    const width = 40;
    const maxPos = width - PILL_WIDTH;
    const positions = [0, 600, 1200, 1800, 2000].map((t) => {
      now = t;
      const row = editor.render(width)[0]!;
      return countLeadingSpaces(row);
    });

    expect(positions[0]).toBe(0);
    expect(positions[1]).toBe(Math.round(0.25 * maxPos));
    expect(positions[2]).toBe(Math.round(0.5 * maxPos));
    expect(positions[3]).toBe(Math.round(0.75 * maxPos));
    expect(positions[4]).toBe(Math.round((2000 / 2400) * maxPos));
    expect(new Set(positions).size).toBe(positions.length);
  });

  test("pill restarts at the left after 2400ms", () => {
    const editor = makeEditor();
    let now = 0;
    editor.setNowFn(() => now);
    editor.lock();

    now = 0;
    const first = editor.render(40)[0]!;
    now = 2400;
    const wrapped = editor.render(40)[0]!;

    expect(countLeadingSpaces(first)).toBe(0);
    expect(countLeadingSpaces(wrapped)).toBe(0);
  });
});

describe("timer lifecycle", () => {
  let originalSetInterval: typeof global.setInterval;
  let originalClearInterval: typeof global.clearInterval;
  let timers: Set<ReturnType<typeof setInterval>>;
  let lastDelay: number | null = null;
  let lastCallback: (() => void) | null = null;

  beforeEach(() => {
    timers = new Set();
    lastDelay = null;
    lastCallback = null;
    originalSetInterval = global.setInterval;
    originalClearInterval = global.clearInterval;

    global.setInterval = ((...args: any[]) => {
      lastCallback = args[0] as (() => void) | null;
      lastDelay = args[1] as number | null;
      const id = Symbol("timer") as unknown as ReturnType<typeof setInterval>;
      timers.add(id);
      return id;
    }) as typeof global.setInterval;

    global.clearInterval = ((id: any) => {
      timers.delete(id);
    }) as typeof global.clearInterval;
  });

  afterEach(() => {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  });

  test("lock and unlock start and stop the timer", () => {
    const editor = makeEditor();
    editor.lock();
    expect(timers.size).toBe(1);
    expect(lastDelay).toBe(EXPECTED_FRAME_INTERVAL_MS);
    expect(typeof lastCallback).toBe("function");

    editor.unlock();
    expect(timers.size).toBe(0);
  });

  test("multiple locks are idempotent", () => {
    const editor = makeEditor();
    editor.lock();
    editor.lock();
    expect(timers.size).toBe(1);

    editor.unlock();
    expect(timers.size).toBe(0);
  });
});

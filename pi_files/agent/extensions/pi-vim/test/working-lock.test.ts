import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ModalEditor } from "../index.ts";

const STREAMING_RGB = "\x1b[38;2;235;111;146m";
const RESET = "\x1b[39m";
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
  editor.focused = true;
  return editor;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function extractInnerContent(row: string): string {
  const stripped = stripAnsi(row);
  if (stripped.length < 2) return stripped;
  return stripped.slice(1, -1);
}

function countLeadingSpaces(row: string): number {
  const content = extractInnerContent(row);
  let count = 0;
  for (const ch of content) {
    if (ch === " ") count++;
    else break;
  }
  return count;
}

function extractVisiblePill(row: string): string {
  const stripped = stripAnsi(row);
  if (stripped.length < 2) return "";
  return stripped.slice(1, -1).replace(/\s+$/g, "");
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

describe("streaming frame rendering", () => {
  test("renders exactly three framed rows", () => {
    const editor = makeEditor();
    editor.lock();

    const rendered = editor.render(50);
    expect(rendered.length).toBe(3);
    expect(visibleWidth(rendered[0]!)).toBe(50);
    expect(visibleWidth(rendered[1]!)).toBe(50);
    expect(visibleWidth(rendered[2]!)).toBe(50);

    const [top, content, bottom] = rendered;
    expect(stripAnsi(top!)).toBe(`╭${"─".repeat(48)}╮`);
    expect(stripAnsi(content!)).toMatch(/^│.{48}│$/);
    expect(stripAnsi(bottom!)).toMatch(/^╰.*STREAMING.*╯$/);
  });

  test("applies the streaming truecolor to the frame, pill, and label", () => {
    const editor = makeEditor();
    editor.lock();

    const [top, content, bottom] = editor.render(50);
    expect(top).toContain(STREAMING_RGB);
    expect(content).toContain(STREAMING_RGB);
    expect(bottom).toContain(STREAMING_RGB);
    expect(content).toContain(PILL_GLYPHS);
    expect(bottom).toContain("STREAMING");
  });

  test("uses the exact #eb6f92 truecolor by default", () => {
    const editor = makeEditor();
    editor.lock();

    const rendered = editor.render(50).join("\n");
    expect(rendered).toContain(STREAMING_RGB);
    // The sequence must be a 24-bit truecolor foreground.
    expect(STREAMING_RGB).toBe("\x1b[38;2;235;111;146m");
  });

  test("shows STREAMING in the bottom-right border label", () => {
    const editor = makeEditor();
    editor.lock();

    const bottom = editor.render(50)[2]!;
    const stripped = stripAnsi(bottom);
    expect(stripped).toMatch(/^╰/);
    expect(stripped).toContain("STREAMING");
    expect(stripped).toMatch(/STREAMING\s*─╯$/);
  });

  test("adapts the frame and pill to terminal width", () => {
    const editor = makeEditor();
    editor.lock();

    for (const width of [0, 1, 2, 3, 4, 5, 8, 30, 80]) {
      const rendered = editor.render(width);
      expect(rendered.length).toBe(3);
      for (const row of rendered) {
        expect(visibleWidth(row)).toBeLessThanOrEqual(width);
      }
    }
  });

  test("tiny widths are width-safe and keep three rows", () => {
    const editor = makeEditor();
    editor.lock();

    for (let width = 0; width <= 8; width++) {
      const rendered = editor.render(width);
      expect(rendered.length).toBe(3);
      for (const row of rendered) {
        expect(visibleWidth(row)).toBeLessThanOrEqual(width);
      }
    }
  });

  test("narrow widths render the longest safe pill prefix inside the frame", () => {
    const editor = makeEditor();
    editor.lock();

    for (let width = 0; width < PILL_WIDTH + 2; width++) {
      const rendered = editor.render(width);
      expect(rendered.length).toBe(3);

      const innerWidth = Math.max(0, width - 2);
      let expectedPrefix = "";
      let expectedWidth = 0;
      for (const char of PILL_GLYPHS) {
        const w = visibleWidth(char);
        if (expectedWidth + w > innerWidth) break;
        expectedPrefix += char;
        expectedWidth += w;
      }

      const visible = extractVisiblePill(rendered[1]!);
      expect(visible).toBe(expectedPrefix);
    }
  });

  test("pill starts at the left edge of the inner content row", () => {
    const editor = makeEditor();
    let now = 0;
    editor.setNowFn(() => now);
    editor.lock();

    const content = editor.render(40)[1]!;
    expect(countLeadingSpaces(content)).toBe(0);
  });

  test("pill travels one-way left-to-right across the inner width over 2400ms", () => {
    const editor = makeEditor();
    let now = 0;
    editor.setNowFn(() => now);
    editor.lock();

    const width = 40;
    const innerWidth = width - 2;
    const maxPos = Math.max(0, innerWidth - PILL_WIDTH);
    const positions = [0, 600, 1200, 1800, 2000].map((t) => {
      now = t;
      const content = editor.render(width)[1]!;
      return countLeadingSpaces(content);
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
    const first = editor.render(40)[1]!;
    now = 2400;
    const wrapped = editor.render(40)[1]!;

    expect(countLeadingSpaces(first)).toBe(0);
    expect(countLeadingSpaces(wrapped)).toBe(0);
  });
});

describe("editor state preservation", () => {
  test("preserves text and mode while locked", () => {
    const editor = makeEditor();
    editor.setText("kept text");
    editor.handleInput("\x1b");
    expect(editor.getMode()).toBe("normal");

    editor.lock();
    expect(editor.isLocked()).toBe(true);
    expect(editor.getText()).toBe("kept text");
    expect(editor.getMode()).toBe("normal");

    const rendered = editor.render(50);
    expect(rendered.length).toBe(3);

    editor.unlock();
    expect(editor.isLocked()).toBe(false);
    expect(editor.getText()).toBe("kept text");
    expect(editor.getMode()).toBe("normal");
  });

  test("does not mutate text with swallowed input while locked", () => {
    const editor = makeEditor();
    editor.setText("initial");
    editor.lock();

    editor.handleInput("x");
    editor.handleInput("i");
    editor.handleInput("\n");

    expect(editor.getText()).toBe("initial");
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

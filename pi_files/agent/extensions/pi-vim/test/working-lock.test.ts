import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ModalEditor } from "../index.ts";

const ACCENT = "\x1b[38;5;200m";
const RESET = "\x1b[39m";
const accentColorize = (s: string) => `${ACCENT}${s}${RESET}`;

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
  editor.setWorkingLabels("Working…", "Press Esc to abort");
  editor.focused = true;
  return editor;
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
  test("renders a locked frame with scanner and working text", () => {
    const editor = makeEditor();
    editor.lock();

    const rendered = editor.render(50).join("\n");
    expect(rendered).toContain("█");
    expect(rendered).toContain(ACCENT);
    expect(rendered).toContain("Working…");
    expect(rendered).toContain("Press Esc to abort");
    expect(rendered).toContain("WORKING");
  });

  test("uses the configured accent colorizer for scanner and borders", () => {
    const editor = makeEditor();
    editor.lock();

    const rendered = editor.render(50).join("\n");
    const accentMatches = rendered.match(new RegExp(ACCENT.replace(/\[/g, "\\["), "g"));
    expect(accentMatches?.length).toBeGreaterThanOrEqual(4);
  });

  test("adapts the scanner bar to terminal width", () => {
    const editor = makeEditor();
    editor.lock();

    for (const width of [4, 5, 8, 30, 80]) {
      const rendered = editor.render(width);
      for (const line of rendered) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  test("scanner position changes with elapsed time", () => {
    const editor = makeEditor();
    let now = 0;
    editor.setNowFn(() => now);
    editor.lock();

    now = 0;
    const first = editor.render(40).join("\n");
    now = 300;
    const second = editor.render(40).join("\n");

    expect(first).not.toBe(second);
  });
});

describe("timer lifecycle", () => {
  let originalSetInterval: typeof global.setInterval;
  let originalClearInterval: typeof global.clearInterval;
  let timers: Set<ReturnType<typeof setInterval>>;

  beforeEach(() => {
    timers = new Set();
    originalSetInterval = global.setInterval;
    originalClearInterval = global.clearInterval;

    global.setInterval = ((...args: any[]) => {
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

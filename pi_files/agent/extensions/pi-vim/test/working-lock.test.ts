import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ModalEditor } from "../index.ts";

const MATRIX_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*+-=<>?/\\|[]{}()";
const EXPECTED_FRAME_INTERVAL_MS = 100;

function makeEditor(
  keybindings?: { matches: (data: string, key: string) => boolean },
  transcriptMode?: () => "COLLAPSED" | "EXPANDED" | "FOCUSED",
): ModalEditor {
  const tui = {
    terminal: { rows: 40 },
    requestRender: () => {},
  };
  const theme = {
    borderColor: (text: string) => text,
    selectList: {},
  };
  const kb = keybindings ?? { matches: () => false };
  const editor = new ModalEditor(
    tui as any,
    theme as any,
    kb as any,
    null,
    null,
    null,
    undefined,
    transcriptMode,
  );
  editor.focused = true;
  return editor;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function getStreamingRgb(row: string): [number, number, number] {
  const match = row.match(/\x1b\[38;2;(\d+);(\d+);(\d+)m/);
  if (!match) throw new Error("Streaming row has no truecolor foreground");
  return [Number(match[1]), Number(match[2]), Number(match[3])];
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

  test("lets app.tools.expand through to super while locked", () => {
    const keybindings = {
      matches: (data: string, key: string) =>
        key === "app.tools.expand" && data === "expand-trigger",
    };
    const editor = makeEditor(keybindings);
    editor.setText("before lock");
    editor.lock();

    const original = CustomEditor.prototype.handleInput;
    let passed: string | null = null;
    CustomEditor.prototype.handleInput = function (data: string): void {
      passed = data;
    };

    try {
      editor.handleInput("expand-trigger");
    } finally {
      CustomEditor.prototype.handleInput = original;
    }

    expect(passed).toBe("expand-trigger");
    expect(editor.getText()).toBe("before lock");
  });

  test("swallows arbitrary input while locked even with app.tools.expand binding", () => {
    const keybindings = {
      matches: (data: string, key: string) =>
        key === "app.tools.expand" && data === "expand-trigger",
    };
    const editor = makeEditor(keybindings);
    editor.setText("before lock");
    editor.lock();

    editor.handleInput("a");
    editor.handleInput("i");
    editor.handleInput("\n");
    editor.handleInput("other-data");

    expect(editor.getText()).toBe("before lock");
  });

  test("swallows another app action while locked", () => {
    const keybindings = {
      matches: (data: string, key: string) =>
        key === "app.other.action" && data === "other-action",
    };
    const editor = makeEditor(keybindings);
    editor.lock();

    const original = CustomEditor.prototype.handleInput;
    let passed: string | null = null;
    CustomEditor.prototype.handleInput = function (data: string): void {
      passed = data;
    };

    try {
      editor.handleInput("other-action");
    } finally {
      CustomEditor.prototype.handleInput = original;
    }

    expect(passed).toBeNull();
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
  test("renders a three-row textbox with one Matrix content row and a right-aligned label", () => {
    const editor = makeEditor();
    editor.lock();

    const rendered = editor.render(50);
    expect(rendered).toHaveLength(3);
    for (const row of rendered) expect(visibleWidth(row)).toBe(50);
    expect(stripAnsi(rendered[0]!)).toBe(`╭${"─".repeat(48)}╮`);
    const content = stripAnsi(rendered[1]!);
    expect(content).toMatch(/^│.*│$/);
    expect([...content.slice(1, -1)].every((char) => MATRIX_CHARACTERS.includes(char))).toBe(true);
    expect(stripAnsi(rendered[2]!)).toMatch(/^╰.* STREAMING ─╯$/);
  });

  test("uses fixed #f3baf0 for every textbox element in every frame", () => {
    const editor = makeEditor();
    let now = 0;
    editor.setNowFn(() => now);
    editor.lock();

    for (let frame = 0; frame < 1_000; frame++) {
      now = frame * EXPECTED_FRAME_INTERVAL_MS;
      const rendered = editor.render(50);
      const frameColors = rendered.flatMap((row) =>
        [...row.matchAll(/\x1b\[38;2;\d+;\d+;\d+m/g)].map((match) => match[0]),
      );
      expect(new Set(frameColors)).toEqual(new Set(["\x1b[38;2;243;186;240m"]));
      expect(getStreamingRgb(rendered[0]!)).toEqual([243, 186, 240]);
    }
  });

  test("changes Matrix characters every 100ms while retaining its fixed color", () => {
    const editor = makeEditor();
    let now = 0;
    editor.setNowFn(() => now);
    editor.lock();

    const first = editor.render(50);
    now = 99;
    expect(editor.render(50)).toEqual(first);
    now = 100;
    const next = editor.render(50);
    expect(next).not.toEqual(first);
    expect(getStreamingRgb(next[0]!)).toEqual(getStreamingRgb(first[0]!));
    expect(stripAnsi(next[1]!)).not.toEqual(stripAnsi(first[1]!));
    const characters = stripAnsi(next[1]!).slice(1, -1);
    expect([...characters].every((char) => MATRIX_CHARACTERS.includes(char))).toBe(true);
  });

  test("handles narrow widths safely and hides the label when it cannot fit", () => {
    const editor = makeEditor();
    editor.lock();

    for (let width = 0; width <= 14; width++) {
      const rendered = editor.render(width);
      expect(rendered).toHaveLength(width <= 1 ? 1 : 3);
      for (const row of rendered) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
    }
    expect(stripAnsi(editor.render(14)[2]!)).not.toContain("STREAMING");
    expect(stripAnsi(editor.render(15)[2]!)).toBe("╰─ STREAMING ─╯");
  });
});

describe("modal editor rounded border rendering", () => {
  test("uses rounded box edges while preserving INSERT, NORMAL, VISUAL, and SHELL labels", () => {
    const editor = makeEditor();
    const cases: Array<{ label: string; prepare: () => void }> = [
      { label: "INSERT", prepare: () => editor.setText("text") },
      { label: "NORMAL", prepare: () => editor.handleInput("\x1b") },
      { label: "VISUAL", prepare: () => editor.handleInput("v") },
      { label: "SHELL", prepare: () => editor.setText("!echo block") },
    ];

    for (const { label, prepare } of cases) {
      prepare();
      for (const width of [4, 9, 50]) {
        const rendered = editor.render(width).map(stripAnsi);
        expect(rendered[0]).toBe(`╭${"─".repeat(width - 2)}╮`);
        expect(rendered.at(-1)).toMatch(/^╰.*╯$/);
        for (const row of rendered.slice(1, -1)) expect(row).toMatch(/^│.*│$/);
        if (width === 50) expect(rendered.at(-1)).toContain(label);
      }
    }
  });
});

describe("modal editor hidden-line border indicators", () => {
  const manyLines = Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n");

  test("centers top and bottom indicators without changing the frame or mode label", () => {
    const editor = makeEditor();
    editor.setText(manyLines);

    const top = stripAnsi(editor.render(50)[0]!);
    expect(top).toContain("↑ 8 more");
    expect(top.indexOf("↑ 8 more")).toBe(Math.floor((50 - "↑ 8 more".length) / 2));
    expect(top).toMatch(/^╭.*╮$/);

    const internals = editor as unknown as { state: { cursorLine: number; cursorCol: number } };
    internals.state.cursorLine = 0;
    internals.state.cursorCol = 0;
    const bottom = stripAnsi(editor.render(50).at(-1)!);
    expect(bottom).toContain("↓ 8 more");
    expect(bottom.indexOf("↓ 8 more")).toBe(Math.floor((50 - "↓ 8 more".length) / 2));
    expect(bottom).toContain("INSERT");
    expect(bottom).toMatch(/^╰.*╯$/);
  });

  test("omits indicators when there is no overflow or a transcript tab occupies the center", () => {
    const editor = makeEditor(undefined, () => "COLLAPSED");
    expect(stripAnsi(editor.render(50)[0]!)).not.toContain("more");

    editor.setText(manyLines);
    const narrowTop = stripAnsi(editor.render(18)[0]!);
    expect(narrowTop).not.toContain("more");
    const tabWidth = "╭─COLLAPSED─╮".length;
    expect(narrowTop).toBe(`╭${"─".repeat(18 - tabWidth - 1)}╯${" ".repeat(tabWidth - 2)}│`);
  });
});

describe("raised transcript-tab editor geometry", () => {
  test("joins transcript labels to normal editor top edges across resizes", () => {
    let mode: "COLLAPSED" | "EXPANDED" | "FOCUSED" = "COLLAPSED";
    const editor = makeEditor(undefined, () => mode);

    for (const [label, width] of [["COLLAPSED", 50], ["EXPANDED", 51], ["FOCUSED", 52]] as const) {
      mode = label;
      const tabWidth = `╭─${label}─╮`.length;
      const expectedTop = `╭${"─".repeat(width - tabWidth - 1)}╯${" ".repeat(tabWidth - 2)}│`;
      expect(stripAnsi(editor.render(width)[0]!)).toBe(expectedTop);
      editor.lock();
      expect(editor.render(width)).toHaveLength(3);
      editor.unlock();
    }
  });

  test("falls back to an unbroken rounded top edge when a raised tab cannot fit", () => {
    const editor = makeEditor(undefined, () => "COLLAPSED");
    for (const width of [4, 8, 16]) {
      expect(stripAnsi(editor.render(width)[0]!)).toBe(`╭${"─".repeat(width - 2)}╮`);
    }
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

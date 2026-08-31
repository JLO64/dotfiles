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

function rgbToHsv([r, g, b]: [number, number, number]): [number, number, number] {
  const [red, green, blue] = [r, g, b].map((channel) => channel / 255);
  const value = Math.max(red, green, blue);
  const chroma = value - Math.min(red, green, blue);
  const hue = chroma === 0 ? 0 : 60 * (((blue === value ? (red - green) / chroma + 4
    : green === value ? (blue - red) / chroma + 2 : (green - blue) / chroma) + 6) % 6);
  return [hue, chroma === 0 ? 0 : chroma / value * 100, value * 100];
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

  test("uses one synchronized full-brightness hue from 230°–320° for every textbox element", () => {
    const editor = makeEditor();
    let now = 0;
    editor.setNowFn(() => now);
    editor.lock();

    const colors = new Set<string>();
    const hues: number[] = [];
    for (let frame = 0; frame < 1_000; frame++) {
      now = frame * EXPECTED_FRAME_INTERVAL_MS;
      const rendered = editor.render(50);
      const frameColors = rendered.flatMap((row) =>
        [...row.matchAll(/\x1b\[38;2;\d+;\d+;\d+m/g)].map((match) => match[0]),
      );
      expect(new Set(frameColors).size).toBe(1);
      colors.add(frameColors[0]!);

      const [hue, saturation, value] = rgbToHsv(getStreamingRgb(rendered[0]!));
      hues.push(hue);
      expect(value).toBe(100);
      expect(saturation).toBeCloseTo(64 / 231 * 100, 0);
      expect(hue).toBeGreaterThanOrEqual(229.5);
      expect(hue).toBeLessThanOrEqual(320.5);
    }
    expect(Math.min(...hues)).toBeLessThanOrEqual(230.5);
    expect(Math.max(...hues)).toBeGreaterThanOrEqual(319.5);
    expect(colors.size).toBeGreaterThan(1);
  });

  test("changes its shared shade and Matrix characters every 100ms", () => {
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
    expect(getStreamingRgb(next[0]!)).not.toEqual(getStreamingRgb(first[0]!));
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

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ModalEditor } from "../index.ts";
import {
  clearFooterLayout,
  getFooterCellState,
  publishFooterLayout,
  setFooterWidthMeasurer,
} from "../footer-layout.ts";

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

describe("streaming lock rendering", () => {
  test("hides the entire editor frame and emits no Matrix glyphs or streaming label", () => {
    const editor = makeEditor();
    editor.setText("preserved input");
    editor.lock();

    expect(editor.render(50)).toEqual([]);
    expect(editor.getText()).toBe("preserved input");
  });

  test("restores the joined editor frame after streaming ends", () => {
    const editor = makeEditor();
    editor.setText("preserved input");
    publishFooterLayout(50, { widths: [8, 20, 8], totalWidth: 40 });
    editor.lock();
    expect(editor.render(50)).toEqual([]);

    editor.unlock();

    const rendered = editor.render(50).map(stripAnsi);
    expect(rendered[0]).toBe(`╭${"─".repeat(48)}╮`);
    expect(rendered.at(-1)?.[0]).toBe("├");
    expect(editor.getText()).toBe("preserved input");
  });

  test("does not allocate a lock animation timer", () => {
    const editor = makeEditor();
    const original = globalThis.setInterval;
    let timers = 0;
    globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
      timers++;
      return original(...args);
    }) as typeof setInterval;
    try {
      editor.lock();
      editor.render(50);
      editor.unlock();
      expect(timers).toBe(0);
    } finally {
      globalThis.setInterval = original;
    }
  });
});

describe("footer-connected editor frame", () => {
  beforeEach(() => clearFooterLayout());
  afterEach(() => clearFooterLayout());

  test("publishes the live VIM mode, including streaming, into the first cell", () => {
    const editor = makeEditor(undefined, () => "FOCUSED");
    const mode = () => stripAnsi(getFooterCellState().mode);
    editor.render(40);
    expect(mode()).toContain("▏ Insert");
    editor.handleInput("\x1b");
    editor.render(40);
    expect(mode()).toContain("█ Normal");
    editor.handleInput("v");
    editor.render(40);
    expect(mode()).toContain("▦ Visual");
    editor.handleInput("\x1b");
    editor.handleInput("s");
    editor.render(40);
    expect(mode()).toContain("/ Flash()");
    editor.handleInput("m");
    editor.handleInput("n");
    editor.render(40);
    expect(mode()).toContain("/ Flash(mn)");
    editor.lock();
    editor.render(40);
    expect(mode()).toContain("Streaming");
    expect(getFooterCellState().transcript).toBe("◎ Focused");
    editor.unlock();
  });

  const layoutFor = (width: number, totalWidth: number) => {
    const contentWidth = Math.max(0, totalWidth - 4);
    const modeWidth = Math.min(5, contentWidth);
    const detailsWidth = Math.min(14, contentWidth - modeWidth);
    return { widths: [modeWidth, detailsWidth, contentWidth - modeWidth - detailsWidth], totalWidth };
  };

  test("measures footer geometry before the editor's first render", () => {
    const editor = makeEditor();
    editor.setText("text");
    let measurements = 0;
    setFooterWidthMeasurer((width) => {
      measurements++;
      publishFooterLayout(width, layoutFor(width, 24));
    });

    const divider = stripAnsi(editor.render(40).at(-1)!);
    expect(measurements).toBe(1);
    expect(divider[23]).toBe("┬");
    expect(divider.at(-1)).toBe("╯");
  });

  test("uses freshly measured cell geometry at the same terminal width", () => {
    const editor = makeEditor();
    editor.setText("text");
    let boxWidth = 24;
    setFooterWidthMeasurer((width) => publishFooterLayout(width, layoutFor(width, boxWidth)));
    expect(stripAnsi(editor.render(40).at(-1)!)[23]).toBe("┬");
    boxWidth = 32;
    const updatedDivider = stripAnsi(editor.render(40).at(-1)!);
    expect(updatedDivider[31]).toBe("┬");
    expect(updatedDivider.at(-1)).toBe("╯");
    expect(updatedDivider[23]).not.toBe("┬");
  });

  test("keeps all three cell joins, responsive widths, and no raised transcript pill", () => {
    const editor = makeEditor(undefined, () => "COLLAPSED");
    editor.setText("text");
    for (const width of [8, 14, 40, 80]) {
      publishFooterLayout(width, layoutFor(width, Math.min(width, Math.max(5, width - 12))));
      const rendered = editor.render(width).map(stripAnsi);
      const divider = rendered.at(-1)!;
      expect(visibleWidth(divider)).toBe(width);
      expect(divider[0]).toBe("├");
      expect((divider.match(/┬/g) ?? []).length + (divider.includes("┤") ? 1 : 0)).toBe(3);
      expect(rendered[0]).toBe(`╭${"─".repeat(width - 2)}╮`);
      expect(rendered.at(-1)).not.toContain("INSERT");
    }
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

  test("omits indicators without overflow and keeps a full-width top edge with transcript modes", () => {
    const editor = makeEditor(undefined, () => "COLLAPSED");
    expect(stripAnsi(editor.render(50)[0]!)).not.toContain("more");

    editor.setText(manyLines);
    const narrowTop = stripAnsi(editor.render(18)[0]!);
    expect(narrowTop).toContain("more");
    expect(narrowTop).toMatch(/^╭.*╮$/);
  });
});

describe("transcript mode editor geometry", () => {
  test("keeps the top edge full width across transcript mode changes", () => {
    let mode: "COLLAPSED" | "EXPANDED" | "FOCUSED" = "COLLAPSED";
    const editor = makeEditor(undefined, () => mode);

    for (const [label, width] of [["COLLAPSED", 50], ["EXPANDED", 51], ["FOCUSED", 52]] as const) {
      mode = label;
      expect(stripAnsi(editor.render(width)[0]!)).toBe(`╭${"─".repeat(width - 2)}╮`);
      editor.lock();
      expect(editor.render(width)).toEqual([]);
      editor.unlock();
    }
  });

  test("keeps an unbroken rounded top edge at narrow widths", () => {
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

    expect(editor.render(50)).toEqual([]);

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

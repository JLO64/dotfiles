import { afterEach, describe, expect, test } from "bun:test";
import registerFooter from "../footer.ts";
import { clearFooterLayout, setFooterCellState } from "../footer-layout.ts";

const stripAnsi = (text: string) => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  clearFooterLayout();
});

function createFooter(contextPercent: number) {
  const handlers: Record<string, (...args: any[]) => any> = {};
  const themeCalls: string[] = [];
  let widgetFactory: ((tui: any, theme: any) => any) | undefined;
  const pi = {
    on: (event: string, handler: (...args: any[]) => any) => { handlers[event] = handler; },
    getThinkingLevel: () => "off",
  };
  const ctx = {
    mode: "tui",
    model: { provider: "test", id: "test/model" },
    sessionManager: {
      getCwd: () => process.cwd(),
      getBranch: () => [],
    },
    getContextUsage: () => ({ percent: contextPercent, tokens: 1000 }),
    ui: {
      setWidget: (_name: string, factory: any) => { widgetFactory = factory; },
      setFooter: () => {},
    },
  };
  registerFooter(pi as any);
  handlers.session_start({}, ctx);
  const widget = widgetFactory!({ requestRender: () => {} }, {
    fg: (name: string, text: string) => {
      themeCalls.push(name);
      const code = name === "error" ? 31 : name === "warning" ? 33 : name === "dim" ? 2 : 0;
      return code ? `\x1b[${code}m${text}\x1b[39m` : text;
    },
  });
  dispose = () => {
    widget.dispose();
    handlers.session_shutdown?.({}, ctx);
  };
  return { widget, themeCalls };
}

describe("footer detail colors", () => {
  test("accent details use the current border color across mode changes", () => {
    const { widget, themeCalls } = createFooter(90);
    const borderOne = (text: string) => `\x1b[38;5;2m${text}\x1b[39m`;
    setFooterCellState({ mode: "Insert", transcript: "Collapsed", borderColorize: borderOne });
    const first = widget.render(180).join("\n");
    const firstPlain = stripAnsi(first);

    for (const part of ["test/model", " ", " ", "", "󰥔 "]) {
      expect(first).toContain(`\x1b[38;5;2m${part}\x1b[39m`);
    }
    expect(firstPlain).toContain("Insert");
    expect(firstPlain).toContain("Collapsed");
    expect(first).toContain("\x1b[31m1.0k\x1b[39m");
    expect(first).toContain("\x1b[2m in \x1b[39m");

    const borderTwo = (text: string) => `\x1b[38;5;5m${text}\x1b[39m`;
    setFooterCellState({ mode: "Visual", transcript: "Expanded", borderColorize: borderTwo });
    const second = widget.render(180).join("\n");
    expect(second).toContain("\x1b[38;5;5mtest/model\x1b[39m");
    expect(second).not.toContain("\x1b[38;5;2mtest/model\x1b[39m");
    expect(stripAnsi(second)).toContain("Visual");
    expect(stripAnsi(second)).toContain("Expanded");
    expect(themeCalls).toContain("dim");
    expect(themeCalls).toContain("error");
    expect(themeCalls).not.toContain("accent");
  });

  test("keeps warning threshold styling separate from border accents", () => {
    const { widget } = createFooter(60);
    setFooterCellState({ mode: "Normal", transcript: "Focused", borderColorize: (text) => `\x1b[38;5;5m${text}\x1b[39m` });
    const output = widget.render(180).join("\n");
    expect(output).toContain("\x1b[33m1.0k\x1b[39m");
    expect(output).toContain("\x1b[38;5;5mtest/model\x1b[39m");
  });
});

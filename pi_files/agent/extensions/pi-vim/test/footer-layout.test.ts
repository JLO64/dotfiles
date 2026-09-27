import { afterEach, describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  clearFooterLayout,
  getFooterLayout,
  getStreamingIcon,
  STREAMING_ICONS,
  measureFooterCells,
  publishFooterLayout,
  renderFooterCellRow,
  renderFooterDivider,
  renderFooterTopBorder,
  setFooterCellState,
  setFooterRenderNotifier,
  setFooterWidthMeasurer,
} from "../footer-layout.ts";

afterEach(() => clearFooterLayout());

const stripAnsi = (text: string) => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
const color = (code: string) => (text: string) => `\x1b[${code}m${text}\x1b[39m`;

describe("connected footer layout", () => {
  test("measures content-sized cells and renders joined boxes with mode colors", () => {
    setFooterCellState({ mode: "\x1b[1mInsert\x1b[22m", transcript: "Collapsed", borderColorize: color("38;5;2") });
    const layout = measureFooterCells("MODEL details", 80);
    const [row, bottom] = renderFooterCellRow(["\x1b[1mInsert\x1b[22m", "MODEL details", "\x1b[1mCollapsed\x1b[22m"], layout, color("38;5;2"));
    const divider = renderFooterDivider(80, layout, color("38;5;2"));

    expect(stripAnsi(row)).toBe("│ Insert │MODEL details│ Collapsed │");
    expect(stripAnsi(bottom)).toBe("╰────────┴─────────────┴───────────╯");
    expect(visibleWidth(divider)).toBe(80);
    expect(stripAnsi(divider).slice(0, layout.totalWidth)).toContain("├");
    expect(stripAnsi(divider).match(/┬/g)).toHaveLength(3);
    expect(stripAnsi(divider).endsWith("─╯")).toBe(true);
    expect(divider).toContain("\x1b[38;5;2m");
    expect(bottom).toContain("\x1b[38;5;2m");
    expect(row).toContain("\x1b[1mInsert\x1b[22m");
    expect(row).toContain("\x1b[1mCollapsed\x1b[22m");
  });

  test("renders a standalone connected top edge for streaming cells", () => {
    const layout = { widths: [1, 1, 1] as [number, number, number], totalWidth: 7 };
    expect(stripAnsi(renderFooterTopBorder(7, layout, (text) => text))).toBe("╭─┬─┬─╮");
  });

  test("uses a right terminal junction when all boxes reach the edge", () => {
    const layout = { widths: [1, 1, 1] as [number, number, number], totalWidth: 7 };
    const divider = stripAnsi(renderFooterDivider(7, layout, (text) => text));
    expect(divider).toBe("├─┬─┬─┤");
    expect(divider.at(6)).toBe("┤");
  });

  test("clips ANSI content and remains within narrow/resized terminal widths", () => {
    setFooterCellState({ mode: "\x1b[1mVisual 12_\x1b[22m", transcript: "Expanded", borderColorize: color("38;5;5") });
    for (const width of [5, 8, 17, 80]) {
      const layout = measureFooterCells("\x1b[32mLong details body\x1b[39m", width);
      expect(layout.totalWidth).toBeLessThanOrEqual(width);
      const [row, bottom] = renderFooterCellRow(["\x1b[1mVisual 12_\x1b[22m", "\x1b[32mLong details body\x1b[39m", "\x1b[1mExpanded\x1b[22m"], layout, color("38;5;5"));
      expect(visibleWidth(row)).toBe(layout.totalWidth);
      expect(visibleWidth(bottom)).toBe(layout.totalWidth);
      expect(visibleWidth(renderFooterDivider(width, layout, color("38;5;5")))).toBe(width);
    }
  });

  test("synchronously measures first-render geometry and publishes resize changes", () => {
    let notified = 0;
    setFooterRenderNotifier(() => notified++);
    setFooterCellState({ mode: "Normal", transcript: "Focused", borderColorize: (text) => text });
    setFooterWidthMeasurer((width) => publishFooterLayout(width, measureFooterCells("details", width)));

    const first = getFooterLayout(32);
    expect(first).not.toBeNull();
    expect(first?.totalWidth).toBeLessThanOrEqual(32);
    expect(notified).toBe(0);
    expect(getFooterLayout(12)?.totalWidth).toBeLessThanOrEqual(12);
  });

  test("cycles the complete streaming braille sequence and keeps every frame one cell wide", () => {
    expect(Array.from({ length: STREAMING_ICONS.length }, (_, frame) => getStreamingIcon(frame))).toEqual([
      "⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏",
    ]);
    expect(getStreamingIcon(STREAMING_ICONS.length)).toBe(STREAMING_ICONS[0]);
    for (const icon of STREAMING_ICONS) expect(visibleWidth(icon)).toBe(1);
    for (const width of [5, 8, 17, 80]) {
      const mode = `${getStreamingIcon(0)} Streaming`;
      const layout = measureFooterCells("details", width);
      const [row] = renderFooterCellRow([mode, "details", "◎ Focused"], layout, (text) => text);
      expect(visibleWidth(row)).toBe(layout.totalWidth);
      expect(layout.totalWidth).toBeLessThanOrEqual(width);
    }
  });

  test("tracks transcript changes in shared cell content", () => {
    setFooterCellState({ mode: "Insert", transcript: "Collapsed", borderColorize: (text) => text });
    const layout = measureFooterCells("details", 40);
    expect(stripAnsi(renderFooterCellRow(["Insert", "details", "Collapsed"], layout, (text) => text)[0])).toContain(" Collapsed ");
    setFooterCellState({ mode: "Insert", transcript: "Focused", borderColorize: (text) => text });
    const focusedLayout = measureFooterCells("details", 40);
    expect(stripAnsi(renderFooterCellRow(["Insert", "details", "Focused"], focusedLayout, (text) => text)[0])).toContain(" Focused ");
  });
});

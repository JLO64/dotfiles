import { afterEach, describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildFooterDetailsStages, formatCompactDuration, formatContextUsage } from "../footer-details.ts";
import {
  clearFooterLayout,
  fitFooterDetails,
  getFooterCellContent,
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
  test("formats elapsed durations compactly and context usage against the model window", () => {
    expect(formatCompactDuration(176)).toBe("2h56m");
    expect(formatCompactDuration(65)).toBe("1h05m");
    expect(formatCompactDuration(1500)).toBe("1d1h");
    expect(formatContextUsage(13900, 260000)).toBe("13.9k/260k");
    expect(formatContextUsage(13900)).toBe("13.9k");
    expect(formatContextUsage(null, 260000)).toBeUndefined();
    expect(formatContextUsage(13900, 0)).toBe("13.9k");
  });

  test("styles structural stat commas without styling commas in field values", () => {
    const base = {
      model: "model", modelWithoutProvider: "model", stats: ["thinking, custom", "13.9k/260.0k"],
      path: "/work/project", cwd: "/work/project", hostname: "host", time: "9:30pm",
      icons: { model: "", directory: "", git: "", time: "" },
      connectors: { in: " in ", on: "on", at: "at" },
    };
    const plain = buildFooterDetailsStages(base);
    const styled = buildFooterDetailsStages({ ...base, commaSeparator: "\x1b[2m, \x1b[22m" });

    expect(styled[0]).toContain("thinking, custom\x1b[2m, \x1b[22m13.9k/260.0k");
    expect(styled[0]).not.toContain("thinking\x1b[2m,");
    expect(visibleWidth(styled[0]!)).toBe(visibleWidth(plain[0]!));
    expect(styled.slice(0, 6).every((stage) => stage!.includes("\x1b[2m, \x1b[22m"))).toBe(true);
  });
  test("keeps the baseline when it fits and measures ANSI-visible width", () => {
    const baseline = "\x1b[31mBASE\x1b[39m";
    expect(fitFooterDetails(baseline, 4, ["reduced"])).toBe(baseline);
    expect(fitFooterDetails(baseline, 3, ["\x1b[32mOK\x1b[39m"])).toBe("\x1b[32mOK\x1b[39m");
  });

  test("applies each reduction in order and stops at the first fitting candidate", () => {
    const reductions = ["11111", "2222", "333", "44", "5"];
    for (let step = 0; step < reductions.length; step++) {
      expect(fitFooterDetails("baseline is long", reductions[step]!.length, reductions)).toBe(reductions[step]);
    }
  });

  test("builds the exact cumulative Details reduction sequence structurally", () => {
    const stages = buildFooterDetailsStages({
      model: "provider/model",
      modelWithoutProvider: "model",
      stats: [],
      reasoningEffort: "Off",
      contextUsage: { used: "13.9k", withMaximum: "13.9k/260k" },
      cost: "$0.00",
      path: "/work/project/subdir",
      cwd: "/work/project/subdir",
      hostname: "host",
      time: "9:30pm",
      duration: "(…)",
      git: { branch: "feature/integration", suffix: "(2)↑1" },
      icons: { model: "M ", directory: "D ", git: "G", time: "T " },
      connectors: { in: " in ", on: "on", at: "at" },
    });

    expect(stages).toHaveLength(13);
    expect(stages[0]).toContain("provider/model");
    expect(stages[0]).toContain("(host)");
    expect(stages[0]).toContain("9:30pm(…)");
    expect(stages[1]).not.toContain("(host)");
    expect(stages[1]).toContain("provider/model");
    expect(stages[2]).not.toContain("provider/model");
    expect(stages[2]).toContain("9:30pm(…)");
    expect(stages[3]).toContain("9:30pm");
    expect(stages[3]).not.toContain("(…)");
    expect(stages[4]).toContain("9:30pm");
    expect(stages[4]).toContain("subdir");
    expect(stages[4]).not.toContain("/work/project/");
    expect(stages[4]).toContain("$0.00");
    expect(stages[4]).toContain("M ");
    expect(stages[5]).not.toContain("9:30pm");
    expect(stages[5]).toContain("subdir");
    expect(stages[5]).toContain("$0.00");
    expect(stages[6]).not.toContain("$0.00");
    expect(stages[6]).toContain("260k");
    expect(stages[6]).toContain("M ");
    expect(stages[7]).not.toContain("260k");
    expect(stages[7]).toContain("M ");
    expect(stages[8]).not.toContain("M ");
    expect(stages[8]).toContain("feature/integration");
    expect(stages[9]).toContain("feature/integration");
    expect(stages[9]).not.toContain(" on ");
    expect(stages[9]).not.toContain(" in ");
    expect(stages[10]).toContain("feature/integration");
    expect(stages[10]).not.toContain("(2)↑1");
    expect(stages[10]).toContain("13.9k");
    expect(stages[10]).not.toContain("260k");
    expect(stages[10]).toContain("Off");
    expect(stages[11]).toContain("13.9k");
    expect(stages[11]).not.toContain("Off");
    expect(stages[11]).toContain("(13.9k)");
    expect(stages[12]).not.toContain("13.9k");
    expect(stages[12]).not.toContain("(");
    expect(stages[12]).not.toContain(")");

    expect(fitFooterDetails(stages[0]!, visibleWidth(stages[4]!), stages.slice(1))).toBe(stages[4]);
    expect(fitFooterDetails(stages[0]!, visibleWidth(stages[5]!), stages.slice(1))).toBe(stages[5]);
    expect(fitFooterDetails(stages[0]!, visibleWidth(stages[7]!), stages.slice(1))).toBe(stages[7]);
    expect(fitFooterDetails(stages[0]!, visibleWidth(stages[8]!), stages.slice(1))).toBe(stages[8]);
  });

  test("hides context maximum and reasoning effort structurally without stray punctuation", () => {
    const input = {
      model: "model", modelWithoutProvider: "model", stats: [], reasoningEffort: "high",
      contextUsage: { used: "13.9k", withMaximum: "13.9k/260k" },
      path: "/work/project", cwd: "/work/project",
      icons: { model: "", directory: "", git: "", time: "" },
      connectors: { in: " in ", on: "on", at: "at" },
    };
    const stages = buildFooterDetailsStages(input);
    expect(stages[0]).toContain("(high, 13.9k/260k)");
    expect(stages[7]).toContain("(high, 13.9k)");
    expect(stages[11]).not.toContain("high");
    expect(stages[11]).toContain("13.9k");
    expect(stages[11]).not.toContain("()");
    expect(stages[12]).not.toContain("13.9k");
    expect(stages[12]).not.toContain("()");

    const withoutContext = buildFooterDetailsStages({ ...input, contextUsage: undefined });
    expect(withoutContext[0]).toContain("(high)");
    expect(withoutContext[7]).toContain("(high)");
    expect(withoutContext[11]).not.toContain("()");
    const withoutEffort = buildFooterDetailsStages({ ...input, reasoningEffort: undefined });
    expect(withoutEffort[0]).toContain("(13.9k/260k)");
    expect(withoutEffort[11]).not.toContain("()");
  });

  test("removes only the final stats group and preserves parentheses in field values", () => {
    const stages = buildFooterDetailsStages({
      model: "provider/model(name)", modelWithoutProvider: "model(name)", stats: ["stat"],
      path: "/work/dir(name)", cwd: "/work/dir(name)",
      git: { branch: "feature/(parentheses)", suffix: "(2)" },
      icons: { model: "", directory: "", git: "", time: "" },
      connectors: { in: " in ", on: "on", at: "at" },
    });

    expect(stages).toHaveLength(13);
    expect(stages[11]).toBe("model(name)(stat) dir(name) feature/(parentheses)");
    expect(stages[12]).toBe("model(name) dir(name) feature/(parentheses)");
    expect(stages[12]).not.toBe(stages[11]);
    expect(stages[12]).toContain("model(name)");
    expect(stages[12]).toContain("dir(name)");
    expect(stages[12]).toContain("feature/(parentheses)");
    expect(stages[12]).not.toContain("(stat)");
    expect(fitFooterDetails(stages[0]!, visibleWidth(stages[11]!), stages.slice(1))).toBe(stages[11]);
    expect(fitFooterDetails(stages[0]!, visibleWidth(stages[12]!), stages.slice(1))).toBe(stages[12]);

    const withoutStats = buildFooterDetailsStages({
      model: "model", modelWithoutProvider: "model", stats: [], path: "/work/project", cwd: "/work/project",
      icons: { model: "", directory: "", git: "", time: "" },
      connectors: { in: " in ", on: "on", at: "at" },
    });
    expect(withoutStats[12]).toBe(withoutStats[11]);
    expect(withoutStats[12]).not.toContain("()");
  });

  test("colors full and basename directory paths without changing visible widths", () => {
    const input = {
      model: "model", modelWithoutProvider: "model", stats: [], path: "/work/project/subdir", cwd: "/work/project/subdir",
      hostname: "host", time: "9:30pm", icons: { model: "M ", directory: "D ", git: "G", time: "T " },
      connectors: { in: " in ", on: "on", at: "at" }, colorizeDirectory: color("38;5;4"),
    };
    const colored = buildFooterDetailsStages(input);
    const plain = buildFooterDetailsStages({ ...input, colorizeDirectory: (text) => text });

    expect(colored[0]).toContain("\x1b[38;5;4m/work/project/subdir\x1b[39m");
    expect(colored[4]).toContain("\x1b[38;5;4msubdir\x1b[39m");
    expect(visibleWidth(colored[0]!)).toBe(visibleWidth(plain[0]!));
    expect(visibleWidth(colored[4]!)).toBe(visibleWidth(plain[4]!));
  });

  test("keeps one space after the clock icon and readable time when icons are hidden", () => {
    const stages = buildFooterDetailsStages({
      model: "model", modelWithoutProvider: "model", stats: [], path: "/work/project", cwd: "/work/project",
      hostname: "host", time: "9:30pm", icons: { model: "M ", directory: "D ", git: "G", time: "T " },
      connectors: { in: " in ", on: "on", at: "at" },
    });
    expect(stages[1]).toContain("at T 9:30pm");
    expect(stages[1]).not.toContain("T  9:30pm");
    expect(stages[3]).toContain("at T 9:30pm");
    expect(stages[3]).not.toContain("(…) ");
    expect(stages[4]).toContain("9:30pm");
    expect(stages[5]).not.toContain("9:30pm");

    const withoutIcons = buildFooterDetailsStages({
      model: "model", modelWithoutProvider: "model", stats: [], path: "/work/project", cwd: "/work/project",
      hostname: "host", time: "9:30pm", icons: { model: "", directory: "", git: "", time: "" },
      connectors: { in: " in ", on: "on", at: "at" },
    });
    expect(withoutIcons[0]).toContain("at 9:30pm");
  });

  test("preserves connector words and icon-like text inside field values", () => {
    const stages = buildFooterDetailsStages({
      model: "provider/in-model",
      modelWithoutProvider: "in-model",
      stats: ["on at in D"],
      path: "/work/in-at-on",
      cwd: "/work/in-at-on",
      hostname: "host-on",
      time: "at-9pm",
      git: { branch: "feature/on-at-in", suffix: "" },
      icons: { model: "M ", directory: "D ", git: "G", time: "T " },
      connectors: { in: " in ", on: "on", at: "at" },
    });
    expect(stages[9]).toContain("on at in D");
    expect(stages[9]).toContain("in-at-on");
    expect(stages[9]).toContain("feature/on-at-in");
    expect(stages[0]).toContain("host-on");
    expect(stages[1]).toContain("at-9pm");
  });

  test("uses ANSI-visible widths to stop at the first fitting actual formatting stage", () => {
    const stages = buildFooterDetailsStages({
      model: "\x1b[31mprovider/model\x1b[39m",
      modelWithoutProvider: "\x1b[31mmodel\x1b[39m",
      stats: [],
      reasoningEffort: "high",
      contextUsage: { used: "13.9k", withMaximum: "13.9k/260k" },
      path: "/a/long-directory",
      cwd: "/a/long-directory",
      hostname: "host",
      time: "9pm",
      icons: { model: "", directory: "", git: "", time: "" },
      connectors: { in: " in ", on: "on", at: "at" },
    });
    expect(visibleWidth(stages[0]!)).toBeLessThan(stages[0]!.length);
    const targetWidth = visibleWidth(stages[1]!);
    expect(fitFooterDetails(stages[0]!, targetWidth, stages.slice(1))).toBe(stages[1]);
    expect(fitFooterDetails(stages[0]!, visibleWidth(stages[3]!), stages.slice(1))).toBe(stages[3]);
    const beforeFinalWidth = visibleWidth(stages[11]!);
    expect(fitFooterDetails(stages[0]!, beforeFinalWidth, stages.slice(1))).toBe(stages[11]);
    const finalWidth = visibleWidth(stages[12]!);
    expect(fitFooterDetails(stages[0]!, finalWidth, stages.slice(1))).toBe(stages[12]);
  });

  test("handles absent provider and git reductions as unchanged candidates", () => {
    const stages = buildFooterDetailsStages({
      model: "model", modelWithoutProvider: "model", stats: [], path: "/work/project", cwd: "/work/project",
      hostname: "host", time: "9pm", icons: { model: "", directory: "", git: "", time: "" },
      connectors: { in: " in ", on: "on", at: "at" },
    });
    expect(stages[0]).not.toBe(stages[1]);
    expect(stages[1]).toBe(stages[2]);
    expect(stages[3]).toBe(stages[2]);
    expect(stages[4]).not.toBe(stages[2]);
    expect(stages[4]).toContain("9pm");
    expect(stages[5]).not.toContain("9pm");
    expect(stages[6]).toBe(stages[7]);
    expect(stages[9]).toBe(stages[10]);
    expect(buildFooterDetailsStages({
      model: "model", modelWithoutProvider: "model", stats: [], path: "/work/project", cwd: "/work/project",
      hostname: "host", time: "9pm", git: { branch: "main", suffix: "(1)" },
      icons: { model: "", directory: "", git: "", time: "" }, connectors: { in: " in ", on: "on", at: "at" },
    })[9]).toContain("main");
  });

  test("handles absent hostname, duration, and clock without dangling time formatting", () => {
    const stages = buildFooterDetailsStages({
      model: "provider/model", modelWithoutProvider: "model", stats: [], path: "/work/project", cwd: "/work/project",
      icons: { model: "M ", directory: "D ", git: "G", time: "T " },
      connectors: { in: " in ", on: "on", at: "at" },
    });
    expect(stages[0]).not.toContain("()");
    expect(stages[0]).not.toContain("at T");
    expect(stages[0]).not.toContain("(undefined)");
    expect(stages[3]).toBe(stages[2]);
    expect(stages[4]).not.toBe(stages[3]);
    expect(stages[4]).toContain("project");
    expect(stages[5]).toBe(stages[4]);
  });

  test("retains the final reduction when details still exceed the cell and does not add ellipsis", () => {
    const final = "branch-only-long";
    const result = fitFooterDetails("baseline-too-long", 3, [final]);
    expect(result).toBe(final);
    expect(result).not.toContain("…");
    expect(result).not.toContain("...");
  });

  test("fills the footer width and centers details while preserving label sizing", () => {
    setFooterCellState({ mode: "\x1b[1mInsert\x1b[22m", transcript: "Collapsed", borderColorize: color("38;5;2") });
    const layout = measureFooterCells("MODEL details", 80);
    const [row, bottom] = renderFooterCellRow(["\x1b[1mInsert\x1b[22m", "MODEL details", "\x1b[1mCollapsed\x1b[22m"], layout, color("38;5;2"));
    const divider = renderFooterDivider(80, layout, color("38;5;2"));

    expect(layout.widths).toEqual([8, 57, 11]);
    expect(layout.totalWidth).toBe(80);
    expect(stripAnsi(row).slice(0, 10)).toBe("│ Insert │");
    expect(stripAnsi(row).slice(67)).toBe("│ Collapsed │");
    expect(stripAnsi(row).slice(10, 67)).toBe(`${" ".repeat(22)}MODEL details${" ".repeat(22)}`);
    expect(visibleWidth(bottom)).toBe(80);
    expect(visibleWidth(divider)).toBe(80);
    expect(stripAnsi(divider).slice(0, layout.totalWidth)).toContain("├");
    expect(stripAnsi(divider).match(/┬/g)).toHaveLength(2);
    expect(stripAnsi(divider).endsWith("┤")).toBe(true);
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

  test("uses icon-only side cells through width 100 and full labels from 101", () => {
    setFooterCellState({
      mode: "▏ Insert",
      modeIconOnly: "▏",
      transcript: " Collapsed",
      transcriptIconOnly: "",
      borderColorize: (text) => text,
    });
    for (const width of [99, 100, 101]) {
      const [mode, transcript] = getFooterCellContent(width);
      const layout = measureFooterCells("details", width);
      const [row] = renderFooterCellRow([mode, "details", transcript], layout, (text) => text);
      const compact = width <= 100;

      expect(mode).toBe(compact ? "▏" : "▏ Insert");
      expect(transcript).toBe(compact ? "" : " Collapsed");
      expect(layout.widths[0]).toBe(visibleWidth(mode) + 2);
      expect(layout.widths[2]).toBe(visibleWidth(transcript) + 2);
      expect(layout.widths[1]).toBe(width - 4 - layout.widths[0] - layout.widths[2]);
      expect(visibleWidth(row)).toBe(width);
      expect(stripAnsi(row)).toContain(compact ? "│ ▏ │" : "│ ▏ Insert │");
      expect(stripAnsi(row)).toContain(compact ? "│  │" : "│  Collapsed │");
    }
  });

  test("uses icon-only side cells during streaming while retaining spinner icon", () => {
    setFooterCellState({
      mode: "⠋ Streaming",
      modeIconOnly: "⠋",
      transcript: "◎ Focused",
      transcriptIconOnly: "◎",
      borderColorize: (text) => text,
    });
    const [mode, transcript] = getFooterCellContent(100);
    const streamingMode = mode.replace("⠋", getStreamingIcon(1));
    const layout = measureFooterCells("details", 100);
    const [row] = renderFooterCellRow([streamingMode, "details", transcript], layout, (text) => text);

    expect(streamingMode).toBe("⠙");
    expect(transcript).toBe("◎");
    expect(visibleWidth(row)).toBe(100);
    expect(stripAnsi(row)).toContain("│ ⠙ │");
    expect(stripAnsi(row)).toContain("│ ◎ │");
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

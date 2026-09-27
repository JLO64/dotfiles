import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export const STREAMING_FRAME_INTERVAL_MS = 100;
export const STREAMING_ICONS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export function getStreamingIcon(frame: number): string {
  return STREAMING_ICONS[((Math.floor(frame) % STREAMING_ICONS.length) + STREAMING_ICONS.length) % STREAMING_ICONS.length]!;
}

export type FooterCellLayout = {
  widths: [number, number, number];
  totalWidth: number;
};

export type FooterCellState = {
  mode: string;
  transcript: string;
  borderColorize: (text: string) => string;
};

const layouts = new Map<number, FooterCellLayout>();
let requestRender: (() => void) | undefined;
let measureFooter: ((terminalWidth: number) => void) | undefined;
let measuringFooter = false;
let cellState: FooterCellState = {
  mode: "INSERT",
  transcript: "COLLAPSED",
  borderColorize: (text) => text,
};

export function setFooterCellState(state: FooterCellState): void {
  cellState = state;
}

export function getFooterCellState(): FooterCellState {
  return cellState;
}

export function measureFooterCells(details: string, terminalWidth: number): FooterCellLayout {
  const { mode, transcript } = cellState;
  const available = Math.max(0, terminalWidth - 4);
  const desired: [number, number, number] = [
    Math.max(visibleWidth(mode) + 2, 1),
    Math.max(visibleWidth(details), 1),
    Math.max(visibleWidth(transcript) + 2, 1),
  ];
  const widths: [number, number, number] = [0, 0, 0];
  let remaining = available;
  // Preserve the semantic labels first, then give any remaining room to details.
  for (const index of [0, 2, 1] as const) {
    widths[index] = Math.min(desired[index], remaining);
    remaining -= widths[index];
  }
  return { widths, totalWidth: widths.reduce((sum, width) => sum + width, 0) + 4 };
}

export function renderFooterCellRow(
  cells: [string, string, string],
  layout: FooterCellLayout,
  colorize: (text: string) => string,
): [string, string] {
  const pad = (text: string, width: number, label = false) => {
    const padded = label && width >= visibleWidth(text) + 2 ? ` ${text} ` : text;
    const clipped = truncateCell(padded, width);
    return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
  };
  const row = colorize("│") + pad(cells[0], layout.widths[0], true) + colorize("│") +
    pad(cells[1], layout.widths[1]) + colorize("│") + pad(cells[2], layout.widths[2], true) + colorize("│");
  const bottom = colorize(`╰${"─".repeat(layout.widths[0])}┴${"─".repeat(layout.widths[1])}┴${"─".repeat(layout.widths[2])}╯`);
  return [row, bottom];
}

function truncateCell(text: string, width: number): string {
  return truncateToWidth(text, width, "");
}

export function renderFooterTopBorder(
  width: number,
  layout: FooterCellLayout,
  colorize: (text: string) => string,
): string {
  const rowWidth = Math.min(width, layout.totalWidth);
  if (rowWidth <= 0) return "";
  const chars = Array<string>(rowWidth).fill("─");
  chars[0] = "╭";
  const joins = [layout.widths[0] + 1, layout.widths[0] + layout.widths[1] + 2];
  for (const join of joins) {
    if (join < rowWidth - 1) chars[join] = "┬";
  }
  if (rowWidth > 1) chars[rowWidth - 1] = "╮";
  return colorize(chars.join(""));
}

export function renderFooterDivider(
  width: number,
  layout: FooterCellLayout,
  colorize: (text: string) => string,
): string {
  const rowWidth = Math.min(width, layout.totalWidth);
  const joins = [layout.widths[0] + 1, layout.widths[0] + layout.widths[1] + 2, rowWidth - 1];
  const chars = Array<string>(width).fill("─");
  if (width <= 0) return "";
  chars[0] = "├";
  for (let i = 0; i < joins.length; i++) {
    const join = Math.max(1, Math.min(rowWidth - 1, joins[i]!));
    chars[join] = i === 2 && rowWidth === width ? "┤" : "┬";
  }
  chars[width - 1] = rowWidth < width ? "╯" : "┤";
  return colorize(chars.join(""));
}

/** Store ANSI-aware cell widths for the editor divider at each terminal width. */
export function publishFooterLayout(terminalWidth: number, layout: FooterCellLayout): void {
  if (terminalWidth <= 0) return;
  const normalized: FooterCellLayout = {
    widths: layout.widths.map((width) => Math.max(0, Math.min(terminalWidth, width))) as [number, number, number],
    totalWidth: Math.max(0, Math.min(terminalWidth, layout.totalWidth)),
  };
  const previous = layouts.get(terminalWidth);
  if (previous?.totalWidth === normalized.totalWidth && previous.widths.every((width, i) => width === normalized.widths[i])) return;
  layouts.set(terminalWidth, normalized);
  if (!measuringFooter) requestRender?.();
}

export function getFooterLayout(terminalWidth: number): FooterCellLayout | null {
  if (measureFooter) {
    measuringFooter = true;
    try {
      measureFooter(terminalWidth);
    } finally {
      measuringFooter = false;
    }
  }
  return layouts.get(terminalWidth) ?? null;
}

export function setFooterWidthMeasurer(measure: ((terminalWidth: number) => void) | undefined): void {
  measureFooter = measure;
}

export function setFooterRenderNotifier(notify: (() => void) | undefined): void {
  requestRender = notify;
}

export function clearFooterLayout(): void {
  const notify = requestRender;
  layouts.clear();
  requestRender = undefined;
  measureFooter = undefined;
  measuringFooter = false;
  cellState = { mode: "INSERT", transcript: "COLLAPSED", borderColorize: (text) => text };
  notify?.();
}

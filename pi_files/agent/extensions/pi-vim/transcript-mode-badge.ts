import { visibleWidth } from "@earendil-works/pi-tui";

export type TranscriptMode = "COLLAPSED" | "EXPANDED" | "FOCUSED";

type BadgeTheme = {
  inverse(text: string): string;
};

export type RaisedTabLayout = {
  tabLeft: number;
  tabWidth: number;
};

/** Returns the shared geometry for the widget tab and editor's connected top edge. */
export function getRaisedTabLayout(width: number, mode: TranscriptMode): RaisedTabLayout | null {
  // `╭─` + `LABEL` + `─╮`; retain two columns for the editor's left edge/junction.
  const tabWidth = visibleWidth(`╭─${mode}─╮`);
  if (width < tabWidth + 2) return null;
  return { tabLeft: width - tabWidth, tabWidth };
}

/** A non-interactive, right-aligned raised tab rendered immediately above the editor. */
export class TranscriptModeBadge {
  private mode: TranscriptMode;

  constructor(
    private readonly theme: BadgeTheme,
    mode: TranscriptMode,
    private readonly requestRender?: () => void,
    private readonly borderColorize: () => (text: string) => string = () => (text) => text,
  ) {
    this.mode = mode;
  }

  setMode(mode: TranscriptMode): void {
    this.mode = mode;
    this.requestRender?.();
  }

  render(width: number): string[] {
    const layout = getRaisedTabLayout(width, this.mode);
    if (!layout) return [];

    // Read the active editor colorizer at render time so mode/lock changes
    // recolor this widget even when the transcript label itself is unchanged.
    const colorize = this.borderColorize();
    const body = this.theme.inverse(colorize(this.mode));
    return [
      `${" ".repeat(layout.tabLeft)}${colorize("╭─")}${colorize("")}${body}${colorize("")}${colorize("─╮")}`,
    ];
  }

  invalidate(): void {}
}

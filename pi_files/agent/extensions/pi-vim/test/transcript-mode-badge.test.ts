import { describe, expect, test } from "bun:test";
import type { TranscriptMode } from "../transcript-mode-badge.ts";
import { setFooterCellState, measureFooterCells, renderFooterCellRow } from "../footer-layout.ts";

describe("transcript status footer cell", () => {
  test("renders current transcript modes as the third connected cell", () => {
    const modes: TranscriptMode[] = ["COLLAPSED", "EXPANDED", "FOCUSED"];
    const icons = { COLLAPSED: "", EXPANDED: "", FOCUSED: "◎" } as const;
    for (const mode of modes) {
      const label = `${icons[mode]} ${mode.charAt(0) + mode.slice(1).toLowerCase()}`;
      setFooterCellState({ mode: "▏ Insert", transcript: label, borderColorize: (text) => text });
      const layout = measureFooterCells("details", 48);
      const [row] = renderFooterCellRow(["▏ Insert", "details", label], layout, (text) => text);
      expect(row).toContain(`│ ${label} │`);
    }
  });
});

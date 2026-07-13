import { visibleWidth } from "@earendil-works/pi-tui";

export interface TextChunk {
  text: string;
  startIndex: number;
  endIndex: number;
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const cjkBreakRegex = /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\p{Script_Extensions=Bopomofo}]/u;
const pasteMarkerRegex = /^\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]$/;

function isPasteMarker(segment: string): boolean {
  return segment.length >= 10 && pasteMarkerRegex.test(segment);
}

/**
 * Mirror Pi's editor line wrapping without importing its private module path.
 * Keeping source indices lets Flash labels line up with wrapped editor rows.
 */
export function wordWrapLine(line: string, maxWidth: number): TextChunk[] {
  if (!line || maxWidth <= 0) {
    return [{ text: "", startIndex: 0, endIndex: 0 }];
  }
  if (visibleWidth(line) <= maxWidth) {
    return [{ text: line, startIndex: 0, endIndex: line.length }];
  }

  const chunks: TextChunk[] = [];
  const segments = [...graphemeSegmenter.segment(line)];
  let currentWidth = 0;
  let chunkStart = 0;
  let wrapOpportunityIndex = -1;
  let wrapOpportunityWidth = 0;

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    const grapheme = segment.segment;
    const graphemeWidth = visibleWidth(grapheme);
    const charIndex = segment.index;
    const whitespace = !isPasteMarker(grapheme) && /\s/.test(grapheme);

    if (currentWidth + graphemeWidth > maxWidth) {
      if (
        wrapOpportunityIndex >= 0 &&
        currentWidth - wrapOpportunityWidth + graphemeWidth <= maxWidth
      ) {
        chunks.push({
          text: line.slice(chunkStart, wrapOpportunityIndex),
          startIndex: chunkStart,
          endIndex: wrapOpportunityIndex,
        });
        chunkStart = wrapOpportunityIndex;
        currentWidth -= wrapOpportunityWidth;
      } else if (chunkStart < charIndex) {
        chunks.push({
          text: line.slice(chunkStart, charIndex),
          startIndex: chunkStart,
          endIndex: charIndex,
        });
        chunkStart = charIndex;
        currentWidth = 0;
      }
      wrapOpportunityIndex = -1;
    }

    // Terminal cells cannot split a grapheme. Keep an oversized grapheme in
    // one chunk rather than recursively wrapping it.
    if (graphemeWidth > maxWidth) {
      if (chunkStart < charIndex) {
        chunks.push({
          text: line.slice(chunkStart, charIndex),
          startIndex: chunkStart,
          endIndex: charIndex,
        });
      }
      chunks.push({ text: grapheme, startIndex: charIndex, endIndex: charIndex + grapheme.length });
      chunkStart = charIndex + grapheme.length;
      currentWidth = 0;
      wrapOpportunityIndex = -1;
      continue;
    }

    currentWidth += graphemeWidth;
    const next = segments[index + 1];
    if (whitespace && next && (isPasteMarker(next.segment) || !/\s/.test(next.segment))) {
      wrapOpportunityIndex = next.index;
      wrapOpportunityWidth = currentWidth;
    } else if (!whitespace && next && !/\s/.test(next.segment)) {
      if (cjkBreakRegex.test(grapheme) || cjkBreakRegex.test(next.segment)) {
        wrapOpportunityIndex = next.index;
        wrapOpportunityWidth = currentWidth;
      }
    }
  }

  if (chunkStart < line.length || chunks.length === 0) {
    chunks.push({ text: line.slice(chunkStart), startIndex: chunkStart, endIndex: line.length });
  }
  return chunks;
}

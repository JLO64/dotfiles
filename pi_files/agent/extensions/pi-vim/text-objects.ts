/**
 * Text-object range calculation for delimiter pairs and quotes.
 *
 * Supports inside (`i`) and around (`a`) variants for `()`, `{}`, `[]`, `<>`,
 * double quotes and single quotes.  Asymmetric pairs are balanced, multiline,
 * and nesting-aware; quotes are line-local and backslash-escape-aware.
 */

export type TextObjectKind = "i" | "a";

export const TEXT_OBJECT_DELIMITERS = new Set<string>([
  "(", ")",
  "{", "}",
  "[", "]",
  "<", ">",
  '"',
  "'",
]);

const ASYMMETRIC_PAIRS: Record<string, { open: string; close: string }> = {
  "(": { open: "(", close: ")" },
  ")": { open: "(", close: ")" },
  "{": { open: "{", close: "}" },
  "}": { open: "{", close: "}" },
  "[": { open: "[", close: "]" },
  "]": { open: "[", close: "]" },
  "<": { open: "<", close: ">" },
  ">": { open: "<", close: ">" },
};

function getAbsoluteIndex(
  lines: readonly string[],
  line: number,
  col: number,
): number {
  let idx = 0;
  for (let i = 0; i < line; i++) {
    idx += (lines[i] ?? "").length + 1;
  }
  return idx + col;
}

export interface DelimiterRange {
  /** Absolute start of the selected object (inclusive). */
  startAbs: number;
  /** Absolute end of the selected object (exclusive). */
  endAbs: number;
}

/**
 * Find the range for a delimiter text object.
 * Returns `null` when no balanced enclosing pair exists.
 */
export function findDelimiterRange(
  lines: readonly string[],
  cursorLine: number,
  cursorCol: number,
  key: string,
  kind: TextObjectKind,
): DelimiterRange | null {
  if (key === '"' || key === "'") {
    return findQuoteRange(lines, cursorLine, cursorCol, key, kind);
  }

  const pair = ASYMMETRIC_PAIRS[key];
  if (!pair) return null;

  return findAsymmetricRange(
    lines,
    cursorLine,
    cursorCol,
    pair.open,
    pair.close,
    kind,
  );
}

function findAsymmetricRange(
  lines: readonly string[],
  cursorLine: number,
  cursorCol: number,
  open: string,
  close: string,
  kind: TextObjectKind,
): DelimiterRange | null {
  const text = lines.join("\n");
  const cursorAbs = getAbsoluteIndex(lines, cursorLine, cursorCol);

  // Parse all balanced pairs with a stack, then pick the innermost pair that
  // encloses the cursor.  This handles nesting and avoids matching delimiters
  // separated by unrelated pairs (e.g. the cursor sitting between `()` `()`).
  const pairs: Array<{ open: number; close: number }> = [];
  const stack: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === open) {
      stack.push(i);
    } else if (ch === close) {
      const openAbs = stack.pop();
      if (openAbs !== undefined) {
        pairs.push({ open: openAbs, close: i });
      }
    }
  }

  let best: { open: number; close: number } | null = null;
  for (const pair of pairs) {
    if (pair.open <= cursorAbs && cursorAbs <= pair.close) {
      if (!best || pair.close - pair.open < best.close - best.open) {
        best = pair;
      }
    }
  }
  if (!best) return null;

  return makeRange(best.open, best.close, kind);
}

function findQuoteRange(
  lines: readonly string[],
  cursorLine: number,
  cursorCol: number,
  quote: string,
  kind: TextObjectKind,
): DelimiterRange | null {
  const line = lines[cursorLine] ?? "";
  if (line.length === 0) return null;

  const pairs: Array<{ open: number; close: number }> = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) {
      const open = i;
      let j = i + 1;
      while (j < line.length) {
        const ch2 = line[j];
        if (ch2 === "\\") {
          j += 2;
          continue;
        }
        if (ch2 === quote) {
          pairs.push({ open, close: j });
          break;
        }
        j++;
      }
      i = j + 1;
    } else {
      i++;
    }
  }

  for (const pair of pairs) {
    if (pair.open <= cursorCol && cursorCol <= pair.close) {
      const lineStartAbs = getAbsoluteIndex(lines, cursorLine, 0);
      return makeRange(lineStartAbs + pair.open, lineStartAbs + pair.close, kind);
    }
  }

  return null;
}

function makeRange(
  openAbs: number,
  closeAbs: number,
  kind: TextObjectKind,
): DelimiterRange {
  if (kind === "i") {
    return { startAbs: openAbs + 1, endAbs: closeAbs };
  }
  return { startAbs: openAbs, endAbs: closeAbs + 1 };
}

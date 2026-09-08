export type MarkdownHighlightStyle =
  | "heading"
  | "link"
  | "linkUrl"
  | "code"
  | "codeBlock"
  | "codeBlockBorder"
  | "quote"
  | "quoteBorder"
  | "hr"
  | "listBullet"
  | "bold"
  | "italic"
  | "strikethrough";

export interface MarkdownHighlightSpan {
  start: number;
  end: number;
  style: MarkdownHighlightStyle;
}

interface MutableLineStyles {
  styles: Array<MarkdownHighlightStyle | undefined>;
  priorities: number[];
}

function mark(
  target: MutableLineStyles,
  start: number,
  end: number,
  style: MarkdownHighlightStyle,
  priority: number,
): void {
  const safeStart = Math.max(0, start);
  const safeEnd = Math.min(target.styles.length, end);
  for (let index = safeStart; index < safeEnd; index++) {
    if (priority >= (target.priorities[index] ?? -1)) {
      target.styles[index] = style;
      target.priorities[index] = priority;
    }
  }
}

function markMatches(
  line: string,
  regex: RegExp,
  target: MutableLineStyles,
  style: MarkdownHighlightStyle,
  priority: number,
  group = 0,
): void {
  for (const match of line.matchAll(regex)) {
    const matched = match[group];
    if (!matched || match.index === undefined) continue;
    const offset = group === 0 ? 0 : match[0].indexOf(matched);
    if (offset < 0) continue;
    const start = match.index + offset;
    mark(target, start, start + matched.length, style, priority);
  }
}

function isEscaped(line: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor--) slashes++;
  return slashes % 2 === 1;
}

function markFileReferences(line: string, target: MutableLineStyles): void {
  const reference = /@(?:"[^"\n]+"|'[^'\n]+'|[A-Za-z0-9_~./:#-]+)/g;
  for (const match of line.matchAll(reference)) {
    if (match.index === undefined || isEscaped(line, match.index)) continue;
    const previous = match.index > 0 ? line[match.index - 1]! : "";
    // Avoid email addresses and identifiers while allowing punctuation before a reference.
    if (previous && /[\p{L}\p{N}_@]/u.test(previous)) continue;

    let end = match.index + match[0].length;
    while (end > match.index + 1 && /[.,;!?)]/.test(line[end - 1]!)) end--;
    if (end > match.index + 1) mark(target, match.index, end, "code", 70);
  }
}

function spansFromStyles(styles: Array<MarkdownHighlightStyle | undefined>): MarkdownHighlightSpan[] {
  const spans: MarkdownHighlightSpan[] = [];
  let start = 0;
  while (start < styles.length) {
    const style = styles[start];
    if (!style) {
      start++;
      continue;
    }
    let end = start + 1;
    while (end < styles.length && styles[end] === style) end++;
    spans.push({ start, end, style });
    start = end;
  }
  return spans;
}

/**
 * Highlight a practical, deliberately non-validating subset of Markdown.
 * Offsets are UTF-16 string indices so they line up with Pi's editor state.
 */
export function getMarkdownHighlightSpans(lines: readonly string[]): MarkdownHighlightSpan[][] {
  const result: MarkdownHighlightSpan[][] = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;

  for (const line of lines) {
    const target: MutableLineStyles = {
      styles: new Array(line.length),
      priorities: new Array(line.length).fill(-1),
    };
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);

    if (fence) {
      const closing = fenceMatch
        && fenceMatch[1]![0] === fence.marker
        && fenceMatch[1]!.length >= fence.length;
      mark(target, 0, line.length, closing ? "codeBlockBorder" : "codeBlock", 100);
      if (closing) fence = null;
      result.push(spansFromStyles(target.styles));
      continue;
    }

    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      mark(target, 0, line.length, "codeBlockBorder", 100);
      fence = { marker: marker[0] as "`" | "~", length: marker.length };
      result.push(spansFromStyles(target.styles));
      continue;
    }

    if (/^\s{0,3}(?:\*\s*){3,}$/.test(line)
      || /^\s{0,3}(?:-\s*){3,}$/.test(line)
      || /^\s{0,3}(?:_\s*){3,}$/.test(line)) {
      mark(target, 0, line.length, "hr", 30);
    }

    const heading = line.match(/^\s{0,3}#{1,6}(?:\s+|$)/);
    if (heading) mark(target, 0, line.length, "heading", 20);

    const quote = line.match(/^\s{0,3}(>+)(?:\s?)/);
    if (quote) {
      const markerStart = line.indexOf(">");
      mark(target, markerStart, markerStart + quote[1]!.length, "quoteBorder", 35);
      mark(target, markerStart + quote[1]!.length, line.length, "quote", 25);
    }

    const list = line.match(/^\s{0,3}(?:[-+*]|\d+[.)])(?=\s)/);
    if (list) {
      const markerStart = list[0].search(/\S/);
      mark(target, markerStart, list[0].trimEnd().length, "listBullet", 35);
    }

    markMatches(line, /\[([^\]\n]+)\]\(([^)\n]+)\)/g, target, "link", 45, 1);
    markMatches(line, /\[[^\]\n]+\]\(([^)\n]+)\)/g, target, "linkUrl", 46, 1);
    markMatches(line, /!?(?:\[[^\]\n]*\])\[[^\]\n]+\]/g, target, "link", 45);
    markMatches(line, /<https?:\/\/[^>\s]+>/g, target, "linkUrl", 46);

    markMatches(line, /~~(?=\S)(?:.*?\S)~~/g, target, "strikethrough", 50);
    markMatches(line, /\*\*(?=\S)(?:.*?\S)\*\*|__(?=\S)(?:.*?\S)__/g, target, "bold", 60);
    markMatches(line, /(?<!\*)\*(?=\S)(?:.*?\S)\*(?!\*)|(?<!_)_(?=\S)(?:.*?\S)_(?!_)/g, target, "italic", 52);

    markFileReferences(line, target);
    markMatches(line, /(`+)([^`\n]|(?!\1)`)*?\1/g, target, "code", 80);

    result.push(spansFromStyles(target.styles));
  }

  return result;
}

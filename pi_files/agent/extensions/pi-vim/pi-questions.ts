/**
 * Pure parser and stripper for the `pi-questions` fenced block used to prefill
 * the editor.
 *
 * Extracts the body of a single standalone block tagged `pi-questions`, but
 * only when the body contains at least three valid numbered entries in the
 * exact shape: number line, ` Q:` line, ` A:` line. Rejects malformed/empty
 * fences, unrelated fenced blocks, empty questions, malformed entries,
 * non-sequential numbering, and fewer than three entries.
 *
 * CRLF is normalized and surrounding blank lines are trimmed, but internal
 * indentation is preserved.
 */

const OPEN_FENCE = /^\s*```\s*pi-questions\s*$/;
const CLOSE_FENCE = /^\s*```\s*$/;
const NUMBER_LINE = /^\s*(\d+)\.\s*$/;
const Q_LINE = /^\s*Q:\s*(\S.*)$/;
const A_LINE = /^\s*A:\s*$/;

interface PiQuestionsBlock {
  body: string;
  startLine: number;
  endLine: number;
}

function isValidEntry(lines: string[], start: number): number | null {
  if (start >= lines.length) return null;
  const numMatch = lines[start]!.match(NUMBER_LINE);
  if (!numMatch) return null;

  if (start + 1 >= lines.length) return null;
  const qMatch = lines[start + 1]!.match(Q_LINE);
  if (!qMatch) return null;

  if (start + 2 >= lines.length) return null;
  const aMatch = lines[start + 2]!.match(A_LINE);
  if (!aMatch) return null;

  return 3;
}

function stripSurroundingBlankLines(text: string): string {
  const lines = text.split("\n");
  let start = 0;
  while (start < lines.length && lines[start]!.trim() === "") {
    start++;
  }
  let end = lines.length;
  while (end > start && lines[end - 1]!.trim() === "") {
    end--;
  }
  return lines.slice(start, end).join("\n");
}

function findPiQuestionsBlock(text: string): PiQuestionsBlock | null {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  let last: PiQuestionsBlock | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (!OPEN_FENCE.test(lines[i]!)) continue;

    let end = i + 1;
    while (end < lines.length && !CLOSE_FENCE.test(lines[end]!)) {
      end++;
    }

    // Malformed: no closing fence — ignore this opener and keep scanning.
    if (end >= lines.length) continue;

    const rawBody = lines.slice(i + 1, end).join("\n");
    const body = stripSurroundingBlankLines(rawBody);

    if (body.length === 0) {
      i = end;
      continue;
    }

    const bodyLines = body.split("\n");
    let index = 0;
    let expectedNumber = 1;
    let validCount = 0;

    while (index < bodyLines.length) {
      const consumed = isValidEntry(bodyLines, index);
      if (consumed === null) break;

      const num = Number(bodyLines[index]!.match(NUMBER_LINE)![1]);
      if (num !== expectedNumber) break;

      expectedNumber++;
      validCount++;
      index += consumed;
    }

    if (validCount >= 3 && index === bodyLines.length) {
      last = { body, startLine: i, endLine: end };
    }

    // Continue scanning so the last valid block wins when multiple exist.
    i = end;
  }

  return last;
}

export function extractPiQuestions(text: string): string | null {
  return findPiQuestionsBlock(text)?.body ?? null;
}

/**
 * Remove the last valid `pi-questions` fenced block from the assistant text,
 * including any immediately surrounding blank lines, while preserving the rest
 * of the response cleanly.
 */
export function stripPiQuestionsBlock(text: string): string | null {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const block = findPiQuestionsBlock(text);
  if (!block) return null;

  let startLine = block.startLine;
  let endLine = block.endLine;

  // Remove any blank lines immediately before the block.
  while (startLine > 0 && lines[startLine - 1]!.trim() === "") {
    startLine--;
  }

  // Remove any blank lines immediately after the block.
  while (endLine < lines.length - 1 && lines[endLine + 1]!.trim() === "") {
    endLine++;
  }

  const before = lines.slice(0, startLine).join("\n");
  const after = lines.slice(endLine + 1).join("\n");

  let result = before;
  if (before.length > 0 && after.length > 0) {
    result += "\n\n" + after;
  } else if (after.length > 0) {
    result = after;
  }

  // Avoid leaving excessive trailing blank lines.
  return result.replace(/\n+$/, "");
}

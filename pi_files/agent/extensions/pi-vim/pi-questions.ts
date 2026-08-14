/**
 * Pure parser and stripper for the `pi-questions` fenced block used to prefill
 * the editor.
 *
 * Extracts the body of a single standalone block tagged `pi-questions`, but
 * only when the body contains at least three valid sequential numbered entries.
 * Entries may use either `number. Q:` or the legacy number and `Q:` lines,
 * with indented continuation lines and optional pre-populated `A:` content.
 * Rejects malformed/empty fences, unrelated fenced blocks, empty questions,
 * malformed entries, non-sequential numbering, and fewer than three entries.
 *
 * CRLF is normalized and surrounding blank lines are trimmed, but internal
 * indentation is preserved.
 */

const OPEN_FENCE = /^\s*```\s*pi-questions\s*$/;
const CLOSE_FENCE = /^\s*```\s*$/;
const NUMBER_LINE = /^\s*(\d+)\.\s*$/;
const Q_LINE = /^\s*Q:\s*(.*)$/;
const NUMBER_Q_LINE = /^\s*(\d+)\.\s*Q:\s*(.*)$/;
const A_LINE = /^\s*A:\s*(.*)$/;

interface PiQuestionsBlock {
  body: string;
  startLine: number;
  endLine: number;
}

interface EntryHeader {
  number: number;
  question: string;
  next: number;
}

function entryHeader(lines: string[], start: number): EntryHeader | null {
  if (start >= lines.length) return null;

  const compactMatch = lines[start]!.match(NUMBER_Q_LINE);
  if (compactMatch) {
    return {
      number: Number(compactMatch[1]),
      question: compactMatch[2]!,
      next: start + 1,
    };
  }

  const numberMatch = lines[start]!.match(NUMBER_LINE);
  const questionMatch = numberMatch && lines[start + 1]?.match(Q_LINE);
  if (!numberMatch || !questionMatch) return null;

  return {
    number: Number(numberMatch[1]),
    question: questionMatch[1]!,
    next: start + 2,
  };
}

function isContinuationLine(line: string): boolean {
  return line.trim() === "" || /^\s+\S/.test(line);
}

function isValidEntry(
  lines: string[],
  start: number,
): { consumed: number; number: number } | null {
  const header = entryHeader(lines, start);
  if (!header) return null;

  let index = header.next;
  let hasQuestionContent = header.question.trim().length > 0;

  while (index < lines.length && !A_LINE.test(lines[index]!)) {
    if (entryHeader(lines, index) || !isContinuationLine(lines[index]!)) return null;
    hasQuestionContent ||= lines[index]!.trim().length > 0;
    index++;
  }

  if (!hasQuestionContent || index >= lines.length) return null;

  index++; // Consume the A: line, whose content may be empty.
  while (index < lines.length) {
    if (entryHeader(lines, index)) break;
    if (!isContinuationLine(lines[index]!)) return null;
    index++;
  }

  return { consumed: index - start, number: header.number };
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
      const entry = isValidEntry(bodyLines, index);
      if (entry === null || entry.number !== expectedNumber) break;

      expectedNumber++;
      validCount++;
      index += entry.consumed;
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

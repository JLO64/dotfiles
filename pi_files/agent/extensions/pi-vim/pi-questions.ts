/**
 * Pure parser for the `pi-questions` fenced block used to prefill the editor.
 *
 * Extracts the body of a single standalone block tagged `pi-questions`, ignoring
 * malformed/empty fences and unrelated fenced blocks. CRLF is normalized and
 * surrounding blank lines are trimmed, but internal indentation is preserved.
 */

const OPEN_FENCE = /^\s*```\s*pi-questions\s*$/;
const CLOSE_FENCE = /^\s*```\s*$/;

export function extractPiQuestions(text: string): string | null {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  let lastBody: string | null = null;

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

    if (body.length > 0) {
      lastBody = body;
    }

    // Continue scanning so the last valid block wins when multiple exist.
    i = end;
  }

  return lastBody;
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

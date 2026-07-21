import { describe, expect, test } from "bun:test";
import { extractPiQuestions, stripPiQuestionsBlock } from "../pi-questions.ts";

function block(body: string): string {
  return `\`\`\`pi-questions\n${body}\n\`\`\``;
}

const VALID_THREE = `1.
 Q: What is the target repository?
 A:
2.
 Q: Which files are in scope?
 A:
3.
 Q: What is the acceptance criteria?
 A:`;

const VALID_FOUR = `${VALID_THREE}\n4.\n Q: Extra?\n A:`;

const VALID_TWO = `1.
 Q: What?
 A:
2.
 Q: When?
 A:`;

const VALID_ONE = `1.
 Q: What?
 A:`;

describe("extractPiQuestions", () => {
  test("returns null when no pi-questions block is present", () => {
    expect(extractPiQuestions("Just some text.")).toBeNull();
    expect(extractPiQuestions("```typescript\nconst x = 1;\n```")).toBeNull();
  });

  test("extracts a valid block with three questions", () => {
    expect(extractPiQuestions(block(VALID_THREE))).toBe(VALID_THREE);
  });

  test("extracts a valid block with more than three questions", () => {
    expect(extractPiQuestions(block(VALID_FOUR))).toBe(VALID_FOUR);
  });

  test("rejects fewer than three valid entries", () => {
    expect(extractPiQuestions(block(VALID_TWO))).toBeNull();
    expect(extractPiQuestions(block(VALID_ONE))).toBeNull();
  });

  test("rejects empty questions", () => {
    const emptyQ = `1.
 Q:
 A:
2.
 Q: B
 A:
3.
 Q: C
 A:`;
    expect(extractPiQuestions(block(emptyQ))).toBeNull();
  });

  test("rejects malformed entries", () => {
    const missingA = `1.
 Q: What?
 A:
2.
 Q: When?
 no A line
3.
 Q: Where?
 A:`;
    expect(extractPiQuestions(block(missingA))).toBeNull();

    const missingQ = `1.
 Q: What?
 A:
2.
 not Q
 A:
3.
 Q: Where?
 A:`;
    expect(extractPiQuestions(block(missingQ))).toBeNull();
  });

  test("rejects non-sequential numbering", () => {
    const startsAtTwo = `2.
 Q: What?
 A:
3.
 Q: When?
 A:
4.
 Q: Where?
 A:`;
    expect(extractPiQuestions(block(startsAtTwo))).toBeNull();

    const duplicate = `1.
 Q: What?
 A:
2.
 Q: When?
 A:
2.
 Q: Where?
 A:`;
    expect(extractPiQuestions(block(duplicate))).toBeNull();
  });

  test("rejects extra non-entry lines in the body", () => {
    const extraLine = `${VALID_THREE}\nThis is not a valid entry.`;
    expect(extractPiQuestions(block(extraLine))).toBeNull();
  });

  test("tolerates CRLF line endings", () => {
    const input = `Questions:\r\n\`\`\`pi-questions\r\n${VALID_THREE.replace(
      /\n/g,
      "\r\n",
    )}\r\n\`\`\`\r\n`;
    expect(extractPiQuestions(input)).toBe(VALID_THREE);
  });

  test("ignores surrounding blank lines and whitespace", () => {
    const input = `

      \t\n
      \`\`\`pi-questions


${VALID_THREE}


      \`\`\`


    `;
    expect(extractPiQuestions(input)).toBe(VALID_THREE);
  });

  test("ignores unrelated fenced blocks", () => {
    const input = `
\`\`\`typescript
const x = 1;
\`\`\`

\`\`\`pi-questions
${VALID_THREE}
\`\`\`

\`\`\`json
{"ignored": true}
\`\`\`
`;
    expect(extractPiQuestions(input)).toBe(VALID_THREE);
  });

  test("ignores malformed fences without a closing fence", () => {
    expect(extractPiQuestions("```pi-questions\nno close")).toBeNull();
  });

  test("ignores empty pi-questions blocks", () => {
    expect(extractPiQuestions("```pi-questions\n```")).toBeNull();
    expect(extractPiQuestions("```pi-questions\n   \n```")).toBeNull();
  });

  test("returns the last valid block when multiple are present", () => {
    const input = `
\`\`\`pi-questions
${VALID_THREE}
\`\`\`

\`\`\`pi-questions
${VALID_FOUR}
\`\`\`
`;
    expect(extractPiQuestions(input)).toBe(VALID_FOUR);
  });

  test("preserves body indentation and line breaks verbatim", () => {
    const body = `1.
   Q: Top question
   A:
2.
   Q: Middle question
   A:
3.
   Q: Bottom question
   A:`;
    expect(extractPiQuestions(block(body))).toBe(body);
  });
});

describe("stripPiQuestionsBlock", () => {
  test("returns null when no valid block is present", () => {
    expect(stripPiQuestionsBlock("Just prose.")).toBeNull();
    expect(stripPiQuestionsBlock(block(VALID_TWO))).toBeNull();
  });

  test("removes a trailing block and leaves surrounding prose", () => {
    const input = `Before\n\n${block(VALID_THREE)}`;
    expect(stripPiQuestionsBlock(input)).toBe("Before");
  });

  test("removes a block between prose sections", () => {
    const input = `Before\n\n${block(VALID_THREE)}\n\nAfter`;
    expect(stripPiQuestionsBlock(input)).toBe("Before\n\nAfter");
  });

  test("removes a leading block and leaves the following prose", () => {
    const input = `${block(VALID_THREE)}\n\nAfter`;
    expect(stripPiQuestionsBlock(input)).toBe("After");
  });

  test("collapses multiple surrounding blank lines", () => {
    const input = `Before\n\n\n${block(VALID_THREE)}\n\n\nAfter`;
    expect(stripPiQuestionsBlock(input)).toBe("Before\n\nAfter");
  });

  test("does not modify the text when the block is invalid", () => {
    const input = `Before\n\n${block(VALID_TWO)}\n\nAfter`;
    expect(stripPiQuestionsBlock(input)).toBeNull();
  });

  test("leaves no excessive trailing blank lines", () => {
    const input = `Before\n\n${block(VALID_THREE)}\n\n`;
    expect(stripPiQuestionsBlock(input)).toBe("Before");
  });
});

import { describe, expect, test } from "bun:test";
import { extractPiQuestions } from "../pi-questions.ts";

describe("extractPiQuestions", () => {
  test("returns null when no pi-questions block is present", () => {
    expect(extractPiQuestions("Just some text.")).toBeNull();
    expect(extractPiQuestions("```typescript\nconst x = 1;\n```")).toBeNull();
  });

  test("extracts a simple pi-questions block", () => {
    const input = "Here are my questions:\n\n```pi-questions\n1. What?\n2. When?\n```\n";
    expect(extractPiQuestions(input)).toBe("1. What?\n2. When?");
  });

  test("tolerates CRLF line endings", () => {
    const input = "Questions:\r\n```pi-questions\r\n1. A\r\n2. B\r\n```\r\n";
    expect(extractPiQuestions(input)).toBe("1. A\n2. B");
  });

  test("ignores surrounding blank lines and whitespace", () => {
    const input = `

      \t\n
      \`\`\`pi-questions


      1. First
      2. Second


      \`\`\`


    `;
    expect(extractPiQuestions(input)).toBe("      1. First\n      2. Second");
  });

  test("ignores unrelated fenced blocks", () => {
    const input = `
\`\`\`typescript
const x = 1;
\`\`\`

\`\`\`pi-questions
1. Only this
2. Should be extracted
\`\`\`

\`\`\`json
{"ignored": true}
\`\`\`
`;
    expect(extractPiQuestions(input)).toBe("1. Only this\n2. Should be extracted");
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
1. First
\`\`\`

\`\`\`pi-questions
1. Second
2. Third
\`\`\`
`;
    expect(extractPiQuestions(input)).toBe("1. Second\n2. Third");
  });

  test("preserves internal indentation and blank lines", () => {
    const input = `
\`\`\`pi-questions
1. Top

    a. nested
    b. nested

2. Bottom
\`\`\`
`;
    expect(extractPiQuestions(input)).toBe(
      "1. Top\n\n    a. nested\n    b. nested\n\n2. Bottom",
    );
  });
});

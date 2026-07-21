import { describe, expect, test } from "bun:test";
import extension from "../index.ts";

const VALID_BLOCK = `\`\`\`pi-questions
1.
 Q: What is the target repository?
 A:
2.
 Q: Which files are in scope?
 A:
3.
 Q: What is the acceptance criteria?
 A:
\`\`\``;

const BLOCK_BODY = `1.
 Q: What is the target repository?
 A:
2.
 Q: Which files are in scope?
 A:
3.
 Q: What is the acceptance criteria?
 A:`;

function setupExtension() {
  const handlers: Record<string, (...args: any[]) => any> = {};
  let editor: any = null;

  const mockCtx = {
    ui: {
      theme: {
        fg: (_name: string, text: string) => text,
      },
      setWorkingVisible: () => {},
      setEditorComponent: (factory: (...args: any[]) => any) => {
        editor = factory(
          { terminal: { rows: 40 }, requestRender: () => {} },
          { borderColor: (text: string) => text, selectList: {} },
          { matches: () => false },
        );
      },
    },
  };

  const mockPi = {
    on: (event: string, handler: (...args: any[]) => any) => {
      handlers[event] = handler;
    },
  };

  extension(mockPi as any);
  handlers["session_start"](
    { type: "session_start", reason: "startup" },
    mockCtx,
  );

  return { handlers, editor, cleanup: () => handlers["session_shutdown"]?.() };
}

describe("session registration", () => {
  test("hides the built-in working loader before installing the editor on session_start", () => {
    const handlers: Record<string, (...args: any[]) => void> = {};
    const events: string[] = [];

    const mockCtx = {
      ui: {
        theme: {
          fg: (_name: string, text: string) => text,
        },
        setWorkingVisible: (visible: boolean) => {
          events.push(`working:${visible}`);
        },
        setEditorComponent: () => {
          events.push("editor");
        },
      },
    };

    const mockPi = {
      on: (event: string, handler: (...args: any[]) => void) => {
        handlers[event] = handler;
      },
    };

    extension(mockPi as any);

    expect(handlers["session_start"]).toBeDefined();

    handlers["session_start"](
      { type: "session_start", reason: "startup" },
      mockCtx,
    );

    expect(events).toEqual(["working:false", "editor"]);

    // Clean up the file watcher and other session resources.
    handlers["session_shutdown"]?.();
  });
});

describe("message_end", () => {
  test("strips a valid pi-questions block from string content and caches the body", () => {
    const { handlers, editor, cleanup } = setupExtension();

    const message = {
      role: "assistant",
      stopReason: "stop",
      content: `Before\n\n${VALID_BLOCK}\n\nAfter`,
    };

    const result = handlers["message_end"]({ message });

    expect(result).toBeDefined();
    expect(result.message.role).toBe("assistant");
    expect(result.message.content).toBe("Before\n\nAfter");

    handlers["agent_settled"]();
    expect(editor.getText()).toBe(BLOCK_BODY);

    cleanup();
  });

  test("strips a valid block from array-of-content-blocks shape", () => {
    const { handlers, editor, cleanup } = setupExtension();

    const message = {
      role: "assistant",
      stopReason: "stop",
      content: [
        { type: "text", text: `Before\n\n${VALID_BLOCK}\n\nAfter` },
      ],
    };

    const result = handlers["message_end"]({ message });

    expect(result).toBeDefined();
    expect(result.message.role).toBe("assistant");
    expect(result.message.content).toEqual([
      { type: "text", text: "Before\n\nAfter" },
    ]);

    handlers["agent_settled"]();
    expect(editor.getText()).toBe(BLOCK_BODY);

    cleanup();
  });

  test("preserves non-text blocks when stripping", () => {
    const { handlers, cleanup } = setupExtension();

    const message = {
      role: "assistant",
      stopReason: "stop",
      content: [
        { type: "text", text: `Before\n\n${VALID_BLOCK}\n\nAfter` },
        { type: "tool_use", id: "tool-1", name: "example" },
      ],
    };

    const result = handlers["message_end"]({ message });

    expect(result).toBeDefined();
    expect(result.message.content).toEqual([
      { type: "text", text: "Before\n\nAfter" },
      { type: "tool_use", id: "tool-1", name: "example" },
    ]);

    cleanup();
  });

  test("does not modify the message when no valid block is present", () => {
    const { handlers, cleanup } = setupExtension();

    const message = {
      role: "assistant",
      stopReason: "stop",
      content: "Just prose.",
    };

    const result = handlers["message_end"]({ message });

    expect(result).toBeUndefined();

    cleanup();
  });

  test("does not modify non-assistant messages", () => {
    const { handlers, cleanup } = setupExtension();

    const message = {
      role: "user",
      stopReason: "stop",
      content: `Before\n\n${VALID_BLOCK}\n\nAfter`,
    };

    const result = handlers["message_end"]({ message });

    expect(result).toBeUndefined();

    cleanup();
  });

  test("does not finalize messages that did not stop", () => {
    const { handlers, cleanup } = setupExtension();

    const message = {
      role: "assistant",
      stopReason: "length",
      content: `Before\n\n${VALID_BLOCK}\n\nAfter`,
    };

    const result = handlers["message_end"]({ message });

    expect(result).toBeUndefined();

    cleanup();
  });

  test("strips only the text block containing the questions and preserves the others", () => {
    const { handlers, editor, cleanup } = setupExtension();

    const message = {
      role: "assistant",
      stopReason: "stop",
      content: [
        { type: "text", text: "First part.\n\nAfter first." },
        { type: "text", text: `Before\n\n${VALID_BLOCK}\n\nAfter` },
        { type: "text", text: "Final part." },
      ],
    };

    const result = handlers["message_end"]({ message });

    expect(result).toBeDefined();
    expect(result.message.content).toEqual([
      { type: "text", text: "First part.\n\nAfter first." },
      { type: "text", text: "Before\n\nAfter" },
      { type: "text", text: "Final part." },
    ]);

    handlers["agent_settled"]();
    expect(editor.getText()).toBe(BLOCK_BODY);

    cleanup();
  });

  test("ignores a valid-looking pi-questions fence inside a thinking block", () => {
    const { handlers, editor, cleanup } = setupExtension();

    const message = {
      role: "assistant",
      stopReason: "stop",
      content: [
        { type: "text", text: `Before\n\n${VALID_BLOCK}\n\nAfter` },
        { type: "thinking", thinking: VALID_BLOCK },
      ],
    };

    const result = handlers["message_end"]({ message });

    expect(result).toBeDefined();
    expect(result.message.content).toEqual([
      { type: "text", text: "Before\n\nAfter" },
      { type: "thinking", thinking: VALID_BLOCK },
    ]);

    handlers["agent_settled"]();
    expect(editor.getText()).toBe(BLOCK_BODY);

    cleanup();
  });

  test("does not modify content when a valid-looking fence spans multiple text blocks", () => {
    const { handlers, cleanup } = setupExtension();

    const message = {
      role: "assistant",
      stopReason: "stop",
      content: [
        { type: "text", text: "Before\n\n```pi-questions\n1." },
        {
          type: "text",
          text: ` Q: What?\n A:\n2.\n Q: Which?\n A:\n3.\n Q: Why?\n A:\n\`\`\`\n\nAfter`,
        },
      ],
    };

    const result = handlers["message_end"]({ message });

    expect(result).toBeUndefined();

    cleanup();
  });

  test("supports raw string content entries alongside typed blocks", () => {
    const { handlers, editor, cleanup } = setupExtension();

    const message = {
      role: "assistant",
      stopReason: "stop",
      content: [
        { type: "text", text: "First." },
        `Before\n\n${VALID_BLOCK}\n\nAfter`,
        { type: "text", text: "Last." },
      ],
    };

    const result = handlers["message_end"]({ message });

    expect(result).toBeDefined();
    expect(result.message.content).toEqual([
      { type: "text", text: "First." },
      "Before\n\nAfter",
      { type: "text", text: "Last." },
    ]);

    handlers["agent_settled"]();
    expect(editor.getText()).toBe(BLOCK_BODY);

    cleanup();
  });
});

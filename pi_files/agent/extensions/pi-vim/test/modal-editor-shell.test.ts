import { afterEach, describe, expect, test } from "bun:test";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { ModalEditor } from "../index.ts";
import { ZshHistoryService } from "../zsh-history.ts";

const SHELL_RGB = "\x1b[38;2;156;207;216m";
const GHOST_STYLE = "\x1b[2;38;5;245m";

const services: ZshHistoryService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
});

function makeEditor(entries: string[] = []): ModalEditor {
  const service = new ZshHistoryService({ historyFile: "/missing" });
  service.replaceFileEntries(entries);
  services.push(service);

  const tui = {
    terminal: { rows: 40 },
    requestRender: () => {},
  };
  const theme = {
    borderColor: (text: string) => text,
    selectList: {},
  };
  const keybindings = { matches: () => false };
  const editor = new ModalEditor(
    tui as any,
    theme as any,
    keybindings as any,
    null,
    null,
    service,
  );
  editor.focused = true;
  return editor;
}

describe("pi-vim shell UI", () => {
  test("uses the exact shell color and SHELL label for ! and !!", () => {
    const editor = makeEditor();

    for (const text of ["!git status", "!!git status"]) {
      editor.setText(text);
      const rendered = editor.render(50).join("\n");
      expect(rendered).toContain(`${SHELL_RGB}╭`);
      expect(rendered).toContain("SHELL");
      expect(rendered).not.toContain("INSERT");
    }
  });

  test("keeps shell UI in normal and visual modes while hiding the ghost", () => {
    const editor = makeEditor(["git status --short"]);
    editor.setText("!git sta");
    editor.handleInput("\x1b");

    expect(editor.getMode()).toBe("normal");
    expect(editor.getGhostSuffix()).toBeNull();
    expect(editor.render(50).join("\n")).toContain("SHELL");

    editor.handleInput("v");
    expect(editor.getMode()).toBe("visual");
    expect(editor.render(50).join("\n")).toContain("SHELL");
  });

  test("gives the active Flash label precedence over SHELL", () => {
    const editor = makeEditor();
    editor.setText("!git status");
    editor.handleInput("\x1b");
    editor.handleInput("s");
    const rendered = editor.render(50).join("\n");

    expect(rendered).toContain("FLASH /");
    expect(rendered).not.toContain("SHELL");
    expect(rendered).toContain(`${SHELL_RGB}╭`);
  });

  test("does not activate shell UI for leading whitespace", () => {
    const editor = makeEditor(["git status"]);
    editor.setText(" !git sta");
    const rendered = editor.render(50).join("\n");

    expect(editor.getGhostSuffix()).toBeNull();
    expect(rendered).toContain("INSERT");
    expect(rendered).not.toContain("SHELL");
    expect(rendered).not.toContain(SHELL_RGB);
  });
});

describe("pi-vim shell ghost suggestions", () => {
  test("renders only the dim suffix without changing the buffer", () => {
    const editor = makeEditor(["git status --short"]);
    editor.setText("! git sta");

    expect(editor.getGhostSuffix()).toBe("tus --short");
    const rendered = editor.render(50).join("\n");
    expect(rendered).toContain(`${GHOST_STYLE}tus --short`);
    expect(editor.getText()).toBe("! git sta");
  });

  test("Tab atomically accepts the suffix and leaves the cursor at the end", () => {
    const editor = makeEditor(["npm run test"]);
    editor.setText("!!npm run te");

    editor.handleInput("\t");

    expect(editor.getText()).toBe("!!npm run test");
    expect(editor.getCursor()).toEqual({ line: 0, col: 14 });
    expect(editor.getGhostSuffix()).toBeNull();
  });

  test("hides the ghost after cursor movement or a newline", () => {
    const editor = makeEditor(["git status --short"]);
    editor.setText("!git sta");
    editor.handleInput("\x1b[D");
    expect(editor.getGhostSuffix()).toBeNull();

    editor.setText("!git sta\n");
    expect(editor.getGhostSuffix()).toBeNull();
  });

  test("delegates Tab unchanged when no ghost is eligible", () => {
    const editor = makeEditor();
    editor.setText("!git sta");
    const original = CustomEditor.prototype.handleInput;
    let delegated: string | null = null;
    CustomEditor.prototype.handleInput = function (data: string): void {
      delegated = data;
    };

    try {
      editor.handleInput("\t");
    } finally {
      CustomEditor.prototype.handleInput = original;
    }

    expect(delegated).toBe("\t");
    expect(editor.getText()).toBe("!git sta");
  });

  test("does not override an active autocomplete menu", () => {
    const editor = makeEditor(["git status --short"]);
    editor.setText("!git sta");
    (editor as any).autocompleteState = "regular";
    const original = CustomEditor.prototype.handleInput;
    let delegated = false;
    CustomEditor.prototype.handleInput = function (): void {
      delegated = true;
    };

    try {
      expect(editor.getGhostSuffix()).toBeNull();
      expect(editor.render(50).join("\n")).not.toContain(GHOST_STYLE);
      editor.handleInput("\t");
    } finally {
      CustomEditor.prototype.handleInput = original;
    }

    expect(delegated).toBe(true);
    expect(editor.getText()).toBe("!git sta");
  });
});

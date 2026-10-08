import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { ModalEditor } from "../index.ts";
import { isInteractivePromptHistoryInput, isSafePromptHistoryEntry, PromptHistoryService } from "../prompt-history.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeHistory(contents?: string): Promise<PromptHistoryService> {
  const directory = await mkdtemp(join(tmpdir(), "pi-vim-prompt-history-"));
  temporaryDirectories.push(directory);
  const history = new PromptHistoryService(directory, directory);
  if (contents !== undefined) {
    await writeFile(history.historyFile, contents);
    try {
      const entries: unknown = JSON.parse(contents);
      if (Array.isArray(entries)) {
        for (const entry of entries.filter((value): value is string => typeof value === "string").reverse()) {
          await history.add(entry);
        }
      }
    } catch {
      // Keep malformed legacy data in place for the invalid-storage test.
    }
  }
  await history.start();
  return history;
}

function makeEditor(history: PromptHistoryService): ModalEditor {
  const tui = { terminal: { rows: 40 }, requestRender: () => {} };
  const theme = { borderColor: (text: string) => text, selectList: {} };
  const bindings: Record<string, string> = {
    "\x1b[A": "tui.editor.cursorUp",
    "\x1b[B": "tui.editor.cursorDown",
    "\x1b[C": "tui.editor.cursorRight",
    "\x1b[D": "tui.editor.cursorLeft",
    "\x1b[5~": "tui.editor.historyPrevious",
    "\x1b[6~": "tui.editor.historyNext",
  };
  const keybindings = { matches: (data: string, key: string) => bindings[data] === key };
  const editor = new ModalEditor(tui as any, theme as any, keybindings as any, null, null, undefined,
    undefined, undefined, undefined, undefined, history);
  editor.focused = true;
  editor.render(50);
  return editor;
}

describe("persistent prompt history", () => {
  test("captures only interactive TUI input sources, including streaming input", () => {
    expect(isInteractivePromptHistoryInput("interactive", "tui")).toBe(true);
    expect(isInteractivePromptHistoryInput("extension", "tui")).toBe(false);
    expect(isInteractivePromptHistoryInput("rpc", "rpc")).toBe(false);
    expect(isInteractivePromptHistoryInput("interactive", "rpc")).toBe(false);
    expect(isInteractivePromptHistoryInput("interactive", "json")).toBe(false);
    expect(isInteractivePromptHistoryInput("interactive", "print")).toBe(false);
  });

  test("recalls newest first, browses older prompts, and restores the exact draft", async () => {
    const history = await makeHistory();
    await history.add("older prompt");
    await history.add("newest prompt");
    const editor = makeEditor(history);
    editor.setText("draft\ncontinues");
    // Capture and restore a cursor in the draft, not merely its text.
    editor.handleInput("\x1b[A");
    expect(editor.getCursor().line).toBe(0);
    editor.handleInput("\x01");
    editor.handleInput("\x1b[A");
    expect(editor.getText()).toBe("newest prompt");
    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
    editor.handleInput("\x1b[A");
    expect(editor.getText()).toBe("older prompt");
    editor.handleInput("\x1b[B");
    expect(editor.getText()).toBe("newest prompt");
    editor.handleInput("\x1b[B");
    expect(editor.getText()).toBe("draft\ncontinues");
    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
  });

  test("recalls history from normal mode and returns to the draft", async () => {
    const history = await makeHistory(JSON.stringify(["prior prompt"]));
    const editor = makeEditor(history);
    editor.setText("current draft");
    editor.handleInput("\x1b");

    editor.handleInput("\x1b[A");

    expect(editor.getMode()).toBe("normal");
    expect(editor.getText()).toBe("prior prompt");
    editor.handleInput("\x1b[B");
    expect(editor.getText()).toBe("current draft");
  });

  test("cursor-only movement preserves the draft in insert and normal mode", async () => {
    for (const mode of ["insert", "normal"] as const) {
      const history = await makeHistory(JSON.stringify(["prior prompt"]));
      const editor = makeEditor(history);
      editor.setText("first line\nsecond line");
      editor.handleInput("\x1b[A");
      editor.handleInput("\x01");
      if (mode === "normal") editor.handleInput("\x1b");

      editor.handleInput("\x1b[A");
      expect(editor.getText()).toBe("prior prompt");
      if (mode === "insert") editor.handleInput("\x1b[C");
      else editor.handleInput("l");
      editor.handleInput("\x1b[B");

      expect(editor.getText()).toBe("first line\nsecond line");
      expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
    }
  });

  test("queues a first history key until fresh-session storage is ready", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-vim-prompt-history-fresh-"));
    temporaryDirectories.push(directory);
    const seeded = new PromptHistoryService(directory, directory);
    await seeded.add("fresh session prompt");
    const history = new PromptHistoryService(directory, directory);
    const loading = history.start();
    const editor = makeEditor(history);

    editor.handleInput("\x1b[A");
    expect(editor.getText()).toBe("");
    await loading;
    await Promise.resolve();

    expect(editor.getText()).toBe("fresh session prompt");
  });

  test("retains normal Up/Down movement within multiline prompts", async () => {
    const history = await makeHistory(JSON.stringify(["past prompt"]));
    const editor = makeEditor(history);
    editor.setText("first line\nsecond line");
    editor.render(50);
    editor.handleInput("\x1b[A");
    expect(editor.getCursor().line).toBe(0);
    expect(editor.getText()).toBe("first line\nsecond line");
    editor.handleInput("\x1b[B");
    expect(editor.getCursor().line).toBe(1);
    expect(editor.getText()).toBe("first line\nsecond line");
  });

  test("loads prompts from prior sessions and writes private storage", async () => {
    const history = await makeHistory(JSON.stringify(["prior session prompt"]));
    await history.add("current prompt");
    const restored = new PromptHistoryService(dirname(history.historyFile), dirname(history.historyFile));
    await restored.start();
    expect(restored.getEntries()).toEqual(["current prompt", "prior session prompt"]);
    expect(restored.getEntries()).toEqual(["current prompt", "prior session prompt"]);
    const records = await readdir(restored.historyDirectory);
    expect(records).toHaveLength(2);
    expect((await stat(restored.historyDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(restored.historyDirectory, records[0]!))).mode & 0o777).toBe(0o600);
    const editor = makeEditor(restored);
    editor.handleInput("\x1b[A");
    expect(editor.getText()).toBe("current prompt");
  });

  test("isolates histories by normalized working directory and ignores unscoped history", async () => {
    const agentDirectory = await mkdtemp(join(tmpdir(), "pi-vim-prompt-history-scope-"));
    temporaryDirectories.push(agentDirectory);
    await writeFile(join(agentDirectory, "pi-vim-prompt-history.json"), JSON.stringify(["unknown origin"]));

    const first = new PromptHistoryService(agentDirectory, join(agentDirectory, "project", "..", "project"));
    await first.start();
    expect(first.getEntries()).toEqual([]);
    await first.add("project prompt");

    const sameDirectory = new PromptHistoryService(agentDirectory, join(agentDirectory, "project"));
    const otherDirectory = new PromptHistoryService(agentDirectory, join(agentDirectory, "other"));
    await Promise.all([sameDirectory.start(), otherDirectory.start()]);
    expect(sameDirectory.getEntries()).toEqual(["project prompt"]);
    expect(otherDirectory.getEntries()).toEqual([]);
  });

  test("retains only the newest 200 prompts per working directory", async () => {
    const history = await makeHistory();
    for (let index = 0; index < 205; index++) await history.add(`prompt ${index}`);

    const restored = new PromptHistoryService(dirname(history.historyFile), dirname(history.historyFile));
    await restored.start();
    expect(restored.getEntries()).toHaveLength(200);
    expect(restored.getEntries()[0]).toBe("prompt 204");
    expect(restored.getEntries()[199]).toBe("prompt 5");
    expect(await readdir(restored.historyDirectory)).toHaveLength(200);
  });

  test("publishes a submitted prompt before its durable write finishes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-vim-prompt-history-immediate-"));
    temporaryDirectories.push(directory);
    const history = new PromptHistoryService(directory, directory);

    const persistence = history.add("submitted immediately");

    expect(history.getEntries()).toEqual(["submitted immediately"]);
    await persistence;
    const restored = new PromptHistoryService(directory, directory);
    await restored.start();
    expect(restored.getEntries()).toEqual(["submitted immediately"]);
  });

  test("preserves prompts written concurrently by separate instances", async () => {
    const first = await makeHistory();
    const second = new PromptHistoryService(dirname(first.historyFile), dirname(first.historyFile));
    await second.start();

    await Promise.all([first.add("from first process"), second.add("from second process")]);

    const restored = new PromptHistoryService(dirname(first.historyFile), dirname(first.historyFile));
    await restored.start();
    expect(new Set(restored.getEntries())).toEqual(new Set(["from first process", "from second process"]));
  });

  test("falls through to the base editor history when persistent history is empty", async () => {
    const history = await makeHistory();
    const editor = makeEditor(history);
    (editor as any).history = ["base editor prompt"];
    (editor as any).historyIndex = -1;

    editor.handleInput("\x1b[A");

    expect(editor.getText()).toBe("base editor prompt");
  });

  test("ignores malformed storage and filters unsafe entries", async () => {
    const history = await makeHistory("not json");
    expect(history.getEntries()).toEqual([]);
    expect(isSafePromptHistoryEntry("a\nmultiline prompt")).toBe(true);
    expect(isSafePromptHistoryEntry("password=secret")).toBe(false);
    expect(isSafePromptHistoryEntry("bad\u0000prompt")).toBe(false);
  });
});


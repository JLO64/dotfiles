import { chmod, mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import type { ExtensionMode, InputSource } from "@earendil-works/pi-coding-agent";
import { DEFAULT_SECRET_PATTERNS } from "./zsh-history.js";

const MAX_ENTRIES = 2_000;
const MAX_ENTRY_LENGTH = 100_000;
const RECORD_NAME = /^\d{13}-[0-9a-f-]+\.json$/u;

export function isInteractivePromptHistoryInput(source: InputSource, mode: ExtensionMode): boolean {
  return source === "interactive" && mode === "tui";
}

export function isSafePromptHistoryEntry(entry: string): boolean {
  if (!entry.trim() || entry.length > MAX_ENTRY_LENGTH) return false;
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/u.test(entry)) return false;
  return !DEFAULT_SECRET_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(entry);
  });
}

export class PromptHistoryService {
  /** Legacy snapshot path, retained for reading history written by older versions. */
  readonly historyFile: string;
  readonly historyDirectory: string;
  private entries: string[] = [];
  private onUpdate: (() => void) | null = null;
  private loading: Promise<void> | null = null;
  private loaded = false;
  private operations: Promise<void> = Promise.resolve();

  constructor(agentDir: string) {
    this.historyFile = join(agentDir, "pi-vim-prompt-history.json");
    this.historyDirectory = join(agentDir, "pi-vim-prompt-history");
  }

  start(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = this.load();
    return this.loading;
  }

  dispose(): void {
    this.onUpdate = null;
  }

  setOnUpdate(onUpdate: (() => void) | null): void {
    this.onUpdate = onUpdate;
  }

  getEntries(): readonly string[] {
    return this.entries;
  }

  isReady(): boolean {
    return this.loaded;
  }

  add(text: string): Promise<void> {
    if (!isSafePromptHistoryEntry(text) || this.entries[0] === text) return this.operations;

    // Publish immediately for the editor; persistence runs independently of Pi's input dispatch.
    this.entries = [text, ...this.entries.filter((entry) => entry !== text)].slice(0, MAX_ENTRIES);
    this.onUpdate?.();
    const operation = this.operations.then(async () => {
      await this.start();
      await this.appendRecord(text);
    });
    this.operations = operation.catch(() => {
      // Persistence is best-effort; do not leak prompt contents or reject an unawaited input event.
      console.error("pi-vim: failed to persist prompt history");
    });
    return this.operations;
  }

  private async load(): Promise<void> {
    const legacyEntries: string[] = [];
    try {
      const parsed: unknown = JSON.parse(await readFile(this.historyFile, "utf8"));
      if (Array.isArray(parsed)) {
        legacyEntries.push(...parsed.filter(
          (entry): entry is string => typeof entry === "string" && isSafePromptHistoryEntry(entry),
        ).slice(0, MAX_ENTRIES));
      }
    } catch {
      // Missing or malformed legacy storage is treated as empty.
    }

    const records: string[] = [];
    try {
      const names = (await readdir(this.historyDirectory))
        .filter((name) => RECORD_NAME.test(name))
        .sort((a, b) => b.localeCompare(a))
        .slice(0, MAX_ENTRIES);
      const loadedRecords = await Promise.all(names.map(async (name) => {
        try {
          const entry: unknown = JSON.parse(await readFile(join(this.historyDirectory, name), "utf8"));
          return typeof entry === "string" && isSafePromptHistoryEntry(entry) ? entry : null;
        } catch {
          // Ignore incomplete or malformed individual records.
          return null;
        }
      }));
      records.push(...loadedRecords.filter((entry): entry is string => entry !== null));
    } catch {
      // Missing or unreadable record storage is treated as empty.
    }

    const seen = new Set<string>();
    this.entries = [...this.entries, ...records, ...legacyEntries].filter((entry) => {
      if (seen.has(entry)) return false;
      seen.add(entry);
      return true;
    }).slice(0, MAX_ENTRIES);
    this.loaded = true;
    this.onUpdate?.();
  }

  private async appendRecord(text: string): Promise<void> {
    await mkdir(this.historyDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.historyDirectory, 0o700);

    const directory = this.historyDirectory;
    const name = `${Date.now().toString().padStart(13, "0")}-${randomUUID()}.json`;
    const target = join(directory, name);
    const temporary = join(directory, `.${basename(target)}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(text)}\n`, { encoding: "utf8", mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, target);
      await chmod(target, 0o600);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }

    // Unique per-prompt records avoid cross-process stale-snapshot overwrites.
    // Concurrent pruning can temporarily leave extra files, but never removes newer records.
    try {
      const oldNames = (await readdir(directory))
        .filter((entry) => RECORD_NAME.test(entry))
        .sort((a, b) => b.localeCompare(a))
        .slice(MAX_ENTRIES);
      await Promise.all(oldNames.map((entry) => unlink(join(directory, entry)).catch(() => {})));
    } catch {
      // Retention cleanup is best-effort; a later write can retry it.
    }
  }
}

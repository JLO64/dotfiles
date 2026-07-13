import { watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

const DEFAULT_MAX_FILE_ENTRIES = 30_000;
const DEFAULT_MAX_RECENT_PI_ENTRIES = 1_000;
const DEFAULT_RELOAD_DEBOUNCE_MS = 300;

export const DEFAULT_SECRET_PATTERNS: readonly RegExp[] = [
  /\bapi[_-]?key\s*=/i,
  /\b(?:access[_-]?)?token\s*=/i,
  /\bpassword\s*=/i,
  /\bsecret\s*=/i,
  /authorization\s*:\s*bearer\b/i,
  /\bbearer\s+\S+/i,
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/i,
];

export type ShellQuery = {
  prefix: "!" | "!!";
  query: string;
};

export type ParseZshHistoryOptions = {
  maxEntries?: number;
  secretPatterns?: readonly RegExp[];
};

export type ZshHistoryServiceOptions = ParseZshHistoryOptions & {
  historyFile?: string;
  maxRecentPiEntries?: number;
  reloadDebounceMs?: number;
};

function expandHome(path: string, home: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return path;
}

export function resolveZshHistoryFile(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const configured = env.ZSH_HISTORY_FILE || env.HISTFILE;
  return expandHome(configured || join(home, ".zsh_history"), home);
}

export function isSafeHistoryEntry(
  entry: string,
  secretPatterns: readonly RegExp[] = DEFAULT_SECRET_PATTERNS,
): boolean {
  if (!entry.trim()) return false;
  // Reject terminal controls and all logical/physical multiline candidates.
  if (/[\x00-\x1f\x7f-\x9f]/u.test(entry)) return false;

  return !secretPatterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(entry);
  });
}

function dedupeNewestFirst(entriesOldestFirst: string[], maxEntries: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (let index = entriesOldestFirst.length - 1; index >= 0; index--) {
    const entry = entriesOldestFirst[index]!;
    if (seen.has(entry)) continue;
    seen.add(entry);
    result.push(entry);
    if (result.length >= maxEntries) break;
  }

  return result;
}

export function parseZshHistory(
  content: string,
  options: ParseZshHistoryOptions = {},
): string[] {
  const maxEntries = Math.max(0, options.maxEntries ?? DEFAULT_MAX_FILE_ENTRIES);
  if (maxEntries === 0 || content.length === 0) return [];

  const secretPatterns = options.secretPatterns ?? DEFAULT_SECRET_PATTERNS;
  const lines = content.split(/\r?\n/u);
  // A file-ending newline is a separator, not an empty continuation line.
  if (lines[lines.length - 1] === "") lines.pop();

  const entries: string[] = [];
  let logicalEntry = "";
  let isMultiline = false;

  const finishLogicalEntry = (): void => {
    if (!isMultiline) {
      const extended = /^: \d+:\d+;(.*)$/u.exec(logicalEntry);
      const command = extended
        ? (extended[1] ?? "")
        : logicalEntry.startsWith("\\:")
          ? logicalEntry.slice(1)
          : logicalEntry;
      if (isSafeHistoryEntry(command, secretPatterns)) entries.push(command);
    }
    logicalEntry = "";
    isMultiline = false;
  };

  for (const line of lines) {
    if (line.endsWith("\\")) {
      logicalEntry += `${line.slice(0, -1)}\n`;
      isMultiline = true;
      continue;
    }

    logicalEntry += line;
    finishLogicalEntry();
  }

  // A trailing continuation is incomplete and therefore intentionally skipped.
  return dedupeNewestFirst(entries, maxEntries);
}

export function extractShellQuery(text: string): ShellQuery | null {
  if (!text.startsWith("!") || text.includes("\n") || text.includes("\r")) {
    return null;
  }

  const prefix: "!" | "!!" = text.startsWith("!!") ? "!!" : "!";
  return {
    prefix,
    query: text.slice(prefix.length).replace(/^\s+/u, ""),
  };
}

export function findHistorySuffix(
  newestFirstEntries: readonly string[],
  query: string,
): string | null {
  if (!/\S/u.test(query)) return null;

  for (const candidate of newestFirstEntries) {
    if (candidate.length > query.length && candidate.startsWith(query)) {
      return candidate.slice(query.length);
    }
  }

  return null;
}

export class ZshHistoryService {
  readonly historyFile: string;

  private readonly maxEntries: number;
  private readonly maxRecentPiEntries: number;
  private readonly reloadDebounceMs: number;
  private readonly secretPatterns: readonly RegExp[];
  private fileEntries: string[] = [];
  private recentPiEntries: string[] = [];
  private watcher: FSWatcher | null = null;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private onUpdate: (() => void) | null = null;

  constructor(options: ZshHistoryServiceOptions = {}) {
    this.historyFile = options.historyFile ?? resolveZshHistoryFile();
    this.maxEntries = Math.max(0, options.maxEntries ?? DEFAULT_MAX_FILE_ENTRIES);
    this.maxRecentPiEntries = Math.max(
      0,
      options.maxRecentPiEntries ?? DEFAULT_MAX_RECENT_PI_ENTRIES,
    );
    this.reloadDebounceMs = Math.max(
      0,
      options.reloadDebounceMs ?? DEFAULT_RELOAD_DEBOUNCE_MS,
    );
    this.secretPatterns = options.secretPatterns ?? DEFAULT_SECRET_PATTERNS;
  }

  setOnUpdate(onUpdate: (() => void) | null): void {
    this.onUpdate = onUpdate;
  }

  start(): void {
    this.disposeWatcher();
    this.recentPiEntries = [];
    const generation = ++this.generation;
    this.startWatcher(generation);
    void this.reload(generation);
  }

  dispose(): void {
    this.generation++;
    this.disposeWatcher();
    this.onUpdate = null;
  }

  addPiCommand(command: string): void {
    if (
      this.maxRecentPiEntries === 0
      || !isSafeHistoryEntry(command, this.secretPatterns)
    ) {
      return;
    }

    this.recentPiEntries = [
      command,
      ...this.recentPiEntries.filter((entry) => entry !== command),
    ].slice(0, this.maxRecentPiEntries);
    this.onUpdate?.();
  }

  replaceFileEntries(entriesNewestFirst: readonly string[]): void {
    this.fileEntries = entriesNewestFirst
      .filter((entry) => isSafeHistoryEntry(entry, this.secretPatterns))
      .slice(0, this.maxEntries);
    this.onUpdate?.();
  }

  findSuffix(query: string): string | null {
    return findHistorySuffix(this.recentPiEntries, query)
      ?? findHistorySuffix(this.fileEntries, query);
  }

  private async reload(generation: number): Promise<void> {
    try {
      const content = await readFile(this.historyFile, "utf8");
      const entries = parseZshHistory(content, {
        maxEntries: this.maxEntries,
        secretPatterns: this.secretPatterns,
      });
      if (generation !== this.generation) return;
      this.fileEntries = entries;
      this.onUpdate?.();
    } catch {
      // Missing/unreadable history must not disturb the last valid index or
      // disclose history contents through logs or notifications.
    }
  }

  private startWatcher(generation: number): void {
    const parent = dirname(this.historyFile);
    const target = basename(this.historyFile);

    try {
      const watcher = watch(parent, { persistent: false }, (_event, filename) => {
        if (generation !== this.generation) return;
        if (filename !== null && filename.toString() !== target) return;
        this.scheduleReload(generation);
      });
      watcher.on("error", () => {
        if (this.watcher === watcher) {
          watcher.close();
          this.watcher = null;
        }
      });
      this.watcher = watcher;
    } catch {
      this.watcher = null;
    }
  }

  private scheduleReload(generation: number): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      if (generation === this.generation) void this.reload(generation);
    }, this.reloadDebounceMs);
  }

  private disposeWatcher(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}

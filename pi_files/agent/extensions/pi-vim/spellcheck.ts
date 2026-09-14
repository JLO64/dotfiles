import { checkTextDocument, getDefaultBundledSettingsAsync } from "cspell-lib";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getMarkdownHighlightSpans } from "./markdown-highlighting.js";

export interface SpellSpan {
  line: number;
  start: number;
  end: number;
  word?: string;
}

type RenderRequester = () => void;

export const SPELLCHECK_DEBOUNCE_MS = 50;
const dictionaryFilename = "pi-vim-spellcheck.json";
const excludedMarkdownStyles = new Set(["code", "codeBlock", "codeBlockBorder", "linkUrl"]);
const spellcheckDebugEnabled = process.env.PI_VIM_SPELLCHECK_DEBUG === "1";

function debugSpellcheck(event: string, details?: unknown): void {
  if (!spellcheckDebugEnabled) return;
  console.debug("[pi-vim spellcheck]", event, details ?? "");
}

// Load bundled dictionaries once at module initialization, outside input handlers.
const bundledSettingsPromise = getDefaultBundledSettingsAsync().then(
  (settings) => {
    debugSpellcheck("bundled dictionaries initialized");
    return settings;
  },
  (error: unknown) => {
    debugSpellcheck("bundled dictionary initialization failed", error);
    return undefined;
  },
);

export function isCustomWord(value: string): boolean {
  return /^\p{L}[\p{L}'’-]*$/u.test(value) && value.length > 1;
}

/** Replace non-prose tokens with spaces without changing UTF-16 offsets. */
export function maskSpellcheckLine(line: string, markdownSpans: readonly { start: number; end: number; style: string }[]): string {
  const masked = line.split("");
  const mask = (start: number, end: number) => {
    for (let index = Math.max(0, start); index < Math.min(line.length, end); index++) masked[index] = " ";
  };

  for (const span of markdownSpans) {
    if (excludedMarkdownStyles.has(span.style)) mask(span.start, span.end);
  }
  // URLs, emails, paths, flags, hashes, and identifier-like tokens are not prose.
  const technical = /(?:https?:\/\/|www\.)\S+|\b\S+@\S+\b|(?:^|\s)[~/][^\s]*|\b\S*[\\/]\S*|(?:^|\s)-{1,2}\S+|(?:^|\s)#[^\s]+|\b\S*\d\S*\b|\b[A-Za-z_][A-Za-z0-9_]*[._:][A-Za-z0-9_.:-]*\b/gu;
  for (const match of line.matchAll(technical)) {
    if (match.index !== undefined) mask(match.index, match.index + match[0].length);
  }
  return masked.join("");
}

/**
 * Mask the active trailing word until whitespace or punctuation terminates it.
 * This intentionally follows the buffer end only; cursor-position exclusion is not available here.
 */
export function maskUnfinishedTrailingWord(line: string): string {
  const match = line.match(/\p{L}[\p{L}'’-]*$/u);
  if (!match || match.index === undefined) return line;
  return `${line.slice(0, match.index)}${" ".repeat(match[0].length)}`;
}

export class SpellcheckService {
  private words = new Set<string>();
  private spans: SpellSpan[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private revision = 0;
  private disposed = false;
  private readonly dictionaryPath: string;

  constructor(agentDir: string, private readonly requestRender: RenderRequester = () => {}) {
    this.dictionaryPath = join(agentDir, dictionaryFilename);
  }

  async start(): Promise<void> {
    try {
      const raw = await readFile(this.dictionaryPath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const word of parsed) if (typeof word === "string" && isCustomWord(word)) this.words.add(word.toLocaleLowerCase());
      }
    } catch {
      // A missing or malformed personal dictionary must not affect editing.
    }
  }

  getSpans(): readonly SpellSpan[] { return this.spans; }
  getWords(): string[] { return [...this.words].sort(); }

  schedule(lines: readonly string[]): void {
    if (this.disposed) return;
    const revision = ++this.revision;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.scan(lines, revision);
    }, SPELLCHECK_DEBOUNCE_MS);
  }

  async addWord(value: string): Promise<boolean> {
    const word = value.trim();
    if (!isCustomWord(word)) return false;
    const normalized = word.toLocaleLowerCase();
    if (this.words.has(normalized)) return true;
    this.words.add(normalized);
    try {
      await mkdir(dirname(this.dictionaryPath), { recursive: true });
      const temp = `${this.dictionaryPath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temp, `${JSON.stringify(this.getWords(), null, 2)}\n`, "utf8");
      await rename(temp, this.dictionaryPath);
    } catch {
      this.words.delete(normalized);
      return false;
    }
    this.spans = this.spans.filter((span) => span.word !== normalized);
    this.requestRender();
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.revision++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.spans = [];
  }

  private async scan(lines: readonly string[], revision: number): Promise<void> {
    const markdown = getMarkdownHighlightSpans(lines);
    const spans: SpellSpan[] = [];
    try {
      const bundledSettings = await bundledSettingsPromise;
      if (!bundledSettings) return;
      // Personal words are read after asynchronous initialization so additions remain live.
      const settings = {
        ...bundledSettings,
        language: "en",
        words: [...(bundledSettings.words ?? []), ...this.words],
      };
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        if (this.disposed || revision !== this.revision) return;
        const raw = lines[lineIndex] ?? "";
        const masked = maskSpellcheckLine(raw, markdown[lineIndex] ?? []);
        const text = lineIndex === lines.length - 1 ? maskUnfinishedTrailingWord(masked) : masked;
        const result = await checkTextDocument(
          { uri: "untitled:pi-vim", text, languageId: "plaintext", locale: "en" },
          { noConfigSearch: true },
          settings,
        );
        const lineSpans: SpellSpan[] = [];
        for (const item of result.items) {
          if (item.isError && item.endPos > item.startPos) {
            lineSpans.push({
              line: lineIndex,
              start: item.startPos,
              end: item.endPos,
              word: item.text.toLocaleLowerCase(),
            });
          }
        }
        spans.push(...lineSpans);
        debugSpellcheck("line checked", { line: lineIndex, raw, masked: text, issues: result.items, spans: lineSpans });
        // Yield between lines so large pasted buffers never monopolize the UI thread.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      if (this.disposed || revision !== this.revision) return;
      this.spans = spans;
      debugSpellcheck("scan complete", { spans });
      this.requestRender();
    } catch (error) {
      debugSpellcheck("scan failed", error);
      // cspell failures are best-effort and leave the editor usable.
    }
  }
}

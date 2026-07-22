/**
 * Modal Editor - vim-like modal editing extension
 *
 * Usage: pi --extension ./index.ts
 *
 * - Escape / ctrl+[: insert → normal mode (in normal mode, aborts agent)
 * - i: normal → insert mode (at cursor)
 * - a: insert after cursor
 * - A: insert at end of line
 * - I: insert at start of line
 * - o: open new line below (insert mode)
 * - O: open new line above (insert mode)
 * - hjkl: navigation in normal mode
 * - 0/$: line start/end
 * - ^: first non-whitespace char of line
 * - _: first non-whitespace (with count: down count-1 lines first); linewise with d/c/y
 * - x: delete char under cursor
 * - D: delete to end of line
 * - S: substitute line (delete line content + insert mode)
 * - s: Flash-style cursor jump (normal mode only; type pattern, then label)
 * - v: characterwise Visual mode; v/Escape exits, o swaps selection ends
 * - Visual motions: h/j/k/l, w/e/b/W/E/B, 0/$/^/_, gg/G, {/}, f/F/t/T, ;/,
 * - Visual operators: d/x delete, c/s change, y yank; i/a text objects select ranges
 * - cl: substitute char (delete char + insert mode)
 * - d{motion}: delete with motion (`w/b/e` + `W/B/E`, `$`, `0`, `^`, `dd`/`d_`, `f/t/F/T{char}`)
 * - c{motion}: change with same motion set as `d` (then enter insert mode)
 * - y{motion}: yank with same motion set as `d` (no text mutation)
 * - f{char}: jump to next {char} on line
 * - F{char}: jump to previous {char} on line
 * - t{char}: jump to just before next {char} on line
 * - T{char}: jump to just after previous {char} on line
 * - ;: repeat last f/F/t/T motion (same direction)
 * - ,: repeat last f/F/t/T motion (reverse direction)
 * - w/b/e: `word` motions (keyword/punctuation aware)
 * - W/B/E: `WORD` motions (whitespace-delimited non-space runs)
 * - {/}: paragraph motions to previous/next paragraph start (line start col 0)
 * - `{count}` prefixes supported for navigation, paragraph motions, and `d/c` word/WORD motions
 * - i{w}: inside word text object (works with c/d/y)
 * - a{w}: around word text object (works with c/d/y)
 * - i(/i), i{/i}, i[/i], i</i>, i", i': inside delimiter text objects
 * - a(/a), a{/a}, a[/a], a</a>, a", a': around delimiter text objects (include delimiters)
 * - operator forms with braces (`d{`, `d}`, `c{`, `c}`, `y{`, `y}`) are out of scope
 * - counted yank caveat: `y2w`, `2yw`, `y2W`, `2yW` cancel (linewise counts still supported)
 * - Flash `s` is normal-mode only: no counts, visual mode, or operator-pending support
 * - Angle-bracket text objects (`i<`, `a<`) use raw balanced `<`/`>`; this can overlap with comparison operators
 * - Shift+Alt+A: go to end of line (insert mode shortcut)
 * - Shift+Alt+I: go to start of line (insert mode shortcut)
 * - Alt+o: open new line below (insert mode shortcut)
 * - Alt+Shift+o: open new line above (insert mode shortcut)
 * - u: undo (normal mode, sends ctrl+_ to underlying readline editor)
 * - ctrl+c, ctrl+d, etc. work in both modes
 *
 * Inspired by original repo:
 * - https://github.com/badlogic/pi-mono
 *   (packages/coding-agent/examples/extensions/modal-editor.ts)
 *
 * Additional ideas adapted from:
 * - https://github.com/l-lin/dotfiles
 *   (home-manager/modules/share/ai/pi/.pi/agent/extensions/vim-mode)
 */

import {
  copyToClipboard,
  CustomEditor,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { wordWrapLine } from "./word-wrap.js";
import {
  extractShellQuery,
  ZshHistoryService,
} from "./zsh-history.js";
import { extractPiQuestions, stripPiQuestionsBlock } from "./pi-questions.js";

import type {
  Mode,
  CharMotion,
  PendingMotion,
  PendingOperator,
  LastCharMotion,
  FlashState,
  FlashMatch,
  VisualState,
} from "./types.js";
import {
  NORMAL_KEYS,
  CHAR_MOTION_KEYS,
  ESC_LEFT,
  ESC_RIGHT,
  ESC_UP,
  CTRL_A,
  CTRL_E,
  CTRL_K,
  CTRL_R,
  CTRL_UNDERSCORE,
  NEWLINE,
  ESC_DOWN,
} from "./types.js";
import { findDelimiterRange, TEXT_OBJECT_DELIMITERS } from "./text-objects.js";
import {
  reverseCharMotion,
  findCharMotionTarget,
  findParagraphMotionTarget,
  findFirstNonWhitespaceColumn,
  getLineGraphemes,
  type WordMotionClass,
} from "./motions.js";
import {
  WordBoundaryCache,
  type WordMotionDirection,
  type WordMotionTarget,
} from "./word-boundary-cache.js";

const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";
const BRACKETED_PASTE_END_TAIL = BRACKETED_PASTE_END.slice(1);
const MAX_COUNT = 9999;
const SHELL_COLOR_START = "\x1b[38;2;62;143;176m";
const STREAMING_COLOR_START = "\x1b[38;2;235;111;146m";
const FOREGROUND_RESET = "\x1b[39m";
const GHOST_STYLE_START = "\x1b[2;38;5;245m";
const STYLE_RESET = "\x1b[0m";
const FAKE_CURSOR_AT_LINE_END = "\x1b[7m \x1b[0m";
const CURSOR_SHAPE_BAR = "\x1b[6 q";
const CURSOR_SHAPE_BLOCK = "\x1b[2 q";
const CURSOR_SHAPE_DEFAULT = "\x1b[0 q";
const PILL_GLYPHS = "\u{e0b6}████████\u{e0b4}";
const PILL_WIDTH = visibleWidth(PILL_GLYPHS);
const PILL_TRAVERSAL_MS = 2400;
const PILL_FRAME_INTERVAL_MS = 1000 / 30;

function shellColorize(text: string): string {
  return `${SHELL_COLOR_START}${text}${FOREGROUND_RESET}`;
}

type EditorSnapshot = {
  text: string;
  cursor: { line: number; col: number };
};

type TransitionState = "none" | "undo" | "redo";

type ModeColorizers = {
  insert: (s: string) => string;
  normal: (s: string) => string;
  visual: (s: string) => string;
};

type ModalEditorInternals = {
  state?: { lines?: string[]; cursorLine?: number; cursorCol?: number };
  preferredVisualCol?: number | null;
  lastAction?: string | null;
  historyIndex?: number;
  scrollOffset?: number;
  onChange?: (text: string) => void;
  tui?: { requestRender?: () => void };
  pushUndoSnapshot?: () => void;
  setCursorCol?: (col: number) => void;
};

export class ModalEditor extends CustomEditor {
  private mode: Mode = "insert";
  private pendingMotion: PendingMotion = null;
  private pendingTextObject: "i" | "a" | null = null;
  private pendingOperator: PendingOperator = null;
  private prefixCount: string = "";
  private operatorCount: string = "";
  private pendingG: boolean = false;
  private pendingGCount: string = "";
  private pendingReplace: boolean = false;
  private lastCharMotion: LastCharMotion | null = null;
  private flashState: FlashState | null = null;
  private visualState: VisualState | null = null;
  private discardingBracketedPasteInNormalMode: boolean = false;
  private pendingEscWhileDiscardingBracketedPasteInNormalMode: boolean = false;
  private wordBoundaryCache = new WordBoundaryCache();
  private readonly redoStack: EditorSnapshot[] = [];
  private currentTransition: TransitionState = "none";
  private onChangeHooked: boolean = false;
  private readonly labelColorizers: ModeColorizers | null;
  private readonly borderColorizers: ModeColorizers | null;
  private readonly historyService: ZshHistoryService | null;
  private hardwareCursorEnabled: boolean = false;
  private cursorShapeSent: string | null = null;

  // Working / input-lock state
  private locked: boolean = false;
  private lockTimer: ReturnType<typeof setInterval> | null = null;
  private lockStartTime: number = 0;
  private accentColorizer: (s: string) => string = (s) =>
    `${STREAMING_COLOR_START}${s}${FOREGROUND_RESET}`;
  private nowFn: () => number = Date.now;

  // Unnamed register
  private unnamedRegister: string = "";
  private clipboardFn: (text: string) => Promise<void> = async (text: string) => {
    await copyToClipboard(text);
  };

  constructor(
    tui: any,
    theme: any,
    kb: any,
    labelColorizers?: ModeColorizers | null,
    borderColorizers?: ModeColorizers | null,
    historyService?: ZshHistoryService | null,
  ) {
    super(tui, theme, kb);
    this.labelColorizers = labelColorizers ?? null;
    this.borderColorizers = borderColorizers ?? null;
    this.historyService = historyService ?? null;
    this.historyService?.setOnUpdate(() => this.requestRender());
  }

  // Test seams
  setClipboardFn(fn: (text: string) => unknown): void {
    this.clipboardFn = async (text: string) => {
      await fn(text);
    };
  }
  getRegister(): string { return this.unnamedRegister; }
  setRegister(text: string): void { this.unnamedRegister = text; }
  getMode(): Mode { return this.mode; }
  getText(): string { return this.getLines().join("\n"); }
  getGhostSuffix(): string | null { return this.getEligibleGhostSuffix(); }
  setNowFn(fn: () => number): void { this.nowFn = fn; }
  setAccentColorizer(fn: (s: string) => string): void { this.accentColorizer = fn; }
  isLocked(): boolean { return this.locked; }
  lock(): void {
    this.stopLockTimer();
    this.locked = true;
    this.lockStartTime = this.nowFn();
    this.startLockTimer();
    this.requestRender();
  }
  unlock(prefillText?: string | null): void {
    this.stopLockTimer();
    this.locked = false;
    if (prefillText && prefillText.length > 0) {
      this.setText(prefillText);
    } else {
      this.requestRender();
    }
  }

  override setText(text: string): void {
    this.clearRedoStack();
    this.flashState = null;
    this.visualState = null;
    if (this.mode === "visual") {
      this.mode = "normal";
      this.clearPendingState();
    }
    super.setText(text);
  }

  private captureSnapshot(): EditorSnapshot {
    const cursor = this.getCursor();
    return {
      text: this.getText(),
      cursor: { line: cursor.line, col: cursor.col },
    };
  }

  private requireRedoRestoreState(
    editor: ModalEditorInternals,
  ): { lines: string[]; cursorLine?: number; cursorCol?: number } {
    const state = editor.state;
    if (!state || !Array.isArray(state.lines)) {
      throw new Error("Redo restore prerequisite: editor state unavailable");
    }
    return state as { lines: string[]; cursorLine?: number; cursorCol?: number };
  }

  private restoreSnapshot(snapshot: EditorSnapshot): void {
    const editor = this as unknown as ModalEditorInternals;
    const state = this.requireRedoRestoreState(editor);

    const lines = snapshot.text.split("\n");
    state.lines = lines.length > 0 ? lines : [""];

    const maxLine = Math.max(0, state.lines.length - 1);
    const cursorLine = Math.max(0, Math.min(snapshot.cursor.line, maxLine));
    const line = state.lines[cursorLine] ?? "";
    const cursorCol = Math.max(0, Math.min(snapshot.cursor.col, line.length));

    state.cursorLine = cursorLine;
    if (typeof editor.setCursorCol === "function") {
      editor.setCursorCol(cursorCol);
    } else {
      state.cursorCol = cursorCol;
      editor.preferredVisualCol = null;
    }

    this.invalidateWordBoundaryCache();

    editor.historyIndex = -1;
    editor.lastAction = null;
    editor.onChange?.(this.getText());
    editor.tui?.requestRender?.();
  }

  private snapshotChanged(a: EditorSnapshot, b: EditorSnapshot): boolean {
    return a.text !== b.text
      || a.cursor.line !== b.cursor.line
      || a.cursor.col !== b.cursor.col;
  }

  private withTransition<T>(
    transition: Exclude<TransitionState, "none">,
    action: () => T,
  ): T {
    const previousTransition = this.currentTransition;
    this.currentTransition = transition;
    try {
      return action();
    } finally {
      this.currentTransition = previousTransition;
    }
  }

  private performUndo(count: number = this.takeTotalCount(1)): void {
    const maxSteps = Math.max(1, Math.min(MAX_COUNT, count));
    for (let i = 0; i < maxSteps; i++) {
      let changed = false;
      this.withTransition("undo", () => {
        const beforeUndo = this.captureSnapshot();
        super.handleInput(CTRL_UNDERSCORE);
        const afterUndo = this.captureSnapshot();

        if (this.snapshotChanged(beforeUndo, afterUndo)) {
          this.redoStack.push(beforeUndo);
          changed = true;
        }
      });
      if (!changed) break;
    }
  }

  private performRedo(count: number = this.takeTotalCount(1)): void {
    const maxSteps = Math.max(1, Math.min(MAX_COUNT, count));
    const editor = this as unknown as ModalEditorInternals;

    for (let i = 0; i < maxSteps; i++) {
      const snapshot = this.redoStack[this.redoStack.length - 1];
      if (!snapshot) break;

      this.withTransition("redo", () => {
        this.requireRedoRestoreState(editor);
        if (typeof editor.pushUndoSnapshot !== "function") {
          throw new Error(
            "Redo restore prerequisite: pushUndoSnapshot unavailable",
          );
        }
        editor.pushUndoSnapshot();
        this.restoreSnapshot(snapshot);
        this.redoStack.pop();
      });
    }
  }

  private clearRedoStack(): void {
    this.redoStack.length = 0;
  }

  private invalidateWordBoundaryCache(): void {
    this.wordBoundaryCache = new WordBoundaryCache();
  }

  private ensureOnChangeHook(): void {
    if (this.onChangeHooked) return;

    const editor = this as unknown as ModalEditorInternals;
    const originalOnChange = editor.onChange;

    editor.onChange = (text: string) => {
      originalOnChange?.(text);
      this.centralInvalidationCheck();
    };

    this.onChangeHooked = true;
  }

  private centralInvalidationCheck(): void {
    if (this.redoStack.length === 0) return;
    if (this.currentTransition !== "none") return;
    this.clearRedoStack();
  }

  private applySyntheticEdit(mutation: () => void): void {
    const editor = this as unknown as ModalEditorInternals;
    if (!editor.state || !Array.isArray(editor.state.lines)) {
      throw new Error(
        "Synthetic edit prerequisite: editor state unavailable",
      );
    }

    if (typeof editor.pushUndoSnapshot !== "function") {
      throw new Error(
        "Synthetic edit prerequisite: pushUndoSnapshot unavailable",
      );
    }

    const textBefore = this.getText();
    const preCursorLine = editor.state.cursorLine;
    const preCursorCol = editor.state.cursorCol;

    mutation();

    if (this.getText() === textBefore) return;

    // Text changed — push undo boundary for pre-mutation state.
    // Briefly swap pre-mutation state in for the snapshot, then
    // restore the post-mutation result.
    const postLines = editor.state.lines.slice();
    const postCursorLine = editor.state.cursorLine;
    const postCursorCol = editor.state.cursorCol;
    const postPreferredCol = editor.preferredVisualCol;

    const preLines = textBefore.split("\n");
    editor.state.lines = preLines.length > 0 ? preLines : [""];
    editor.state.cursorLine = preCursorLine;
    editor.state.cursorCol = preCursorCol;
    editor.pushUndoSnapshot();

    editor.state.lines = postLines;
    editor.state.cursorLine = postCursorLine;
    editor.state.cursorCol = postCursorCol;
    editor.preferredVisualCol = postPreferredCol;

    editor.onChange?.(this.getText());
    editor.tui?.requestRender?.();
  }

  private clearPendingState(): void {
    this.pendingMotion = null;
    this.pendingTextObject = null;
    this.pendingOperator = null;
    this.prefixCount = "";
    this.operatorCount = "";
    this.pendingG = false;
    this.pendingGCount = "";
    this.pendingReplace = false;
  }

  private isEscapeLikeInput(data: string): boolean {
    return matchesKey(data, "escape") || matchesKey(data, "ctrl+[");
  }

  private isShellInput(): boolean {
    return this.getText().startsWith("!");
  }

  private getEligibleGhostSuffix(): string | null {
    if (
      !this.historyService
      || this.mode !== "insert"
      || this.isShowingAutocomplete()
    ) {
      return null;
    }

    const lines = this.getLines();
    const cursor = this.getCursor();
    if (lines.length !== 1 || cursor.line !== 0 || cursor.col !== lines[0]!.length) {
      return null;
    }

    const shellQuery = extractShellQuery(lines[0]!);
    return shellQuery ? this.historyService.findSuffix(shellQuery.query) : null;
  }

  private stripBracketedPasteInNormalMode(data: string): { filtered: string | null; stripped: boolean } {
    let chunk = data;
    let stripped = false;

    while (true) {
      if (this.discardingBracketedPasteInNormalMode) {
        stripped = true;
        const end = chunk.indexOf(BRACKETED_PASTE_END);
        if (end === -1) {
          return { filtered: null, stripped };
        }
        this.discardingBracketedPasteInNormalMode = false;
        this.pendingEscWhileDiscardingBracketedPasteInNormalMode = false;
        chunk = chunk.slice(end + BRACKETED_PASTE_END.length);
        if (!chunk) return { filtered: null, stripped };
      }

      const start = chunk.indexOf(BRACKETED_PASTE_START);
      if (start === -1) {
        return { filtered: chunk, stripped };
      }

      stripped = true;
      const end = chunk.indexOf(BRACKETED_PASTE_END, start + BRACKETED_PASTE_START.length);
      if (end === -1) {
        this.discardingBracketedPasteInNormalMode = true;
        const leading = chunk.slice(0, start);
        return { filtered: leading.length > 0 ? leading : null, stripped };
      }

      chunk = chunk.slice(0, start) + chunk.slice(end + BRACKETED_PASTE_END.length);
      if (!chunk) return { filtered: null, stripped };
    }
  }

  handleInput(data: string): void {
    this.ensureOnChangeHook();

    if (this.locked) {
      // While the agent is working, only the abort path is allowed through.
      const keybindings = (this as unknown as { keybindings?: { matches: (data: string, key: string) => boolean } }).keybindings;
      if (this.isEscapeLikeInput(data) || keybindings?.matches(data, "app.interrupt")) {
        super.handleInput(data);
      }
      return;
    }

    if (this.flashState) {
      if (this.isEscapeLikeInput(data)) {
        this.cancelFlashMode(true);
        return;
      }
      this.handleFlashInput(data);
      return;
    }

    if (this.mode !== "insert") {
      if (this.discardingBracketedPasteInNormalMode) {
        if (this.isEscapeLikeInput(data)) {
          if (this.pendingEscWhileDiscardingBracketedPasteInNormalMode) {
            this.pendingEscWhileDiscardingBracketedPasteInNormalMode = false;
            this.discardingBracketedPasteInNormalMode = false;
            this.clearPendingState();
            return;
          } else {
            this.pendingEscWhileDiscardingBracketedPasteInNormalMode = true;
            this.clearPendingState();
            return;
          }
        } else if (this.pendingEscWhileDiscardingBracketedPasteInNormalMode) {
          if (data.startsWith(BRACKETED_PASTE_END_TAIL)) {
            this.pendingEscWhileDiscardingBracketedPasteInNormalMode = false;
            this.discardingBracketedPasteInNormalMode = false;
            data = data.slice(BRACKETED_PASTE_END_TAIL.length);
            if (data.length === 0) {
              this.clearPendingState();
              return;
            }
          } else {
            this.pendingEscWhileDiscardingBracketedPasteInNormalMode = false;
          }
        }
      }

      const { filtered, stripped } = this.stripBracketedPasteInNormalMode(data);
      if (stripped) {
        this.clearPendingState();
      }
      if (filtered === null) return;
      data = filtered;
    }

    if (this.isEscapeLikeInput(data)) {
      return this.handleEscape();
    }

    if (this.mode === "insert") {
      if (matchesKey(data, "tab") && !this.isShowingAutocomplete()) {
        const suffix = this.getEligibleGhostSuffix();
        if (suffix) {
          this.insertTextAtCursor(suffix);
          this.requestRender();
          return;
        }
      }

      // Shift+Alt+A: go to end of line (like Esc -> A but stay in insert)
      if (matchesKey(data, Key.shiftAlt("a")) || data === "\x1bA") {
        return super.handleInput(CTRL_E);
      }
      // Shift+Alt+I: go to start of line (like Esc -> I but stay in insert)
      if (matchesKey(data, Key.shiftAlt("i")) || data === "\x1bI") {
        return super.handleInput(CTRL_A);
      }
      // Alt+o: open new line below (stay in insert mode)
      if (matchesKey(data, Key.alt("o")) || data === "\x1bo") {
        this.openLineBelow();
        return;
      }
      // Alt+Shift+o: open new line above (stay in insert mode)
      // \x1bO is the legacy sequence for Alt+Shift+O (VT100 SS3 prefix in non-Kitty terminals)
      if (matchesKey(data, Key.shiftAlt("o")) || data === "\x1bO") {
        this.openLineAbove();
        return;
      }
      super.handleInput(data);
      return;
    }

    if (this.mode === "visual") {
      this.handleVisualMode(data);
      return;
    }

    if (this.pendingReplace) {
      this.pendingReplace = false;
      if (!this.isPrintableInput(data)) {
        this.prefixCount = "";
        this.operatorCount = "";
        return;
      }

      const count = this.takeTotalCount(1);
      const cursor = this.getCursor();
      const line = this.getLines()[cursor.line] ?? "";
      const range = this.getGraphemeRangeAtCol(line, cursor.col, count);
      if (!range) return;

      const before = line.slice(0, range.start);
      const after = line.slice(range.end);
      const replacement = data.repeat(count);
      const lineStartAbs = this.getAbsoluteIndex(cursor.line, 0);
      const text = this.getText();
      const newText = text.slice(0, lineStartAbs) + before + replacement + after
        + text.slice(lineStartAbs + line.length);
      const newCursorAbs = lineStartAbs + before.length + data.length * (count - 1);
      this.replaceTextInBuffer(newText, newCursorAbs);
      return;
    }

    if (this.pendingTextObject) {
      return this.handlePendingTextObject(data);
    }

    if (this.pendingMotion) {
      return this.handlePendingMotion(data);
    }

    if (this.pendingOperator === "d") {
      return this.handlePendingDelete(data);
    }

    if (this.pendingOperator === "c") {
      return this.handlePendingChange(data);
    }

    if (this.pendingOperator === "y") {
      return this.handlePendingYank(data);
    }

    this.handleNormalMode(data);
  }

  private clearUnderlyingPasteStateIfActive(): void {
    const editor = this as unknown as {
      isInPaste?: boolean;
      pasteBuffer?: string;
      pasteCounter?: number;
    };

    if (!editor.isInPaste) return;

    editor.isInPaste = false;
    if (typeof editor.pasteBuffer === "string") {
      editor.pasteBuffer = "";
    }
    if (typeof editor.pasteCounter === "number") {
      editor.pasteCounter = 0;
    }
  }

  private handleEscape(): void {
    if (this.mode === "visual") {
      this.exitVisualMode();
      return;
    }

    if (
      this.pendingMotion
      || this.pendingTextObject
      || this.pendingOperator
      || this.prefixCount
      || this.operatorCount
      || this.pendingG
      || this.pendingGCount
      || this.pendingReplace
    ) {
      this.clearPendingState();
      return;
    }
    if (this.mode === "insert") {
      this.clearUnderlyingPasteStateIfActive();
      this.mode = "normal";
    } else {
      super.handleInput("\x1b"); // pass escape to abort agent
    }
  }

  private isPrintableChunk(data: string): boolean {
    if (data.length === 0) return false;
    for (const char of data) {
      const codePoint = char.codePointAt(0)!;
      if (codePoint < 32 || codePoint === 127) return false;
    }
    return true;
  }

  private isPrintableInput(data: string): boolean {
    return this.isPrintableChunk(data) && getLineGraphemes(data).length === 1;
  }

  private isDigit(data: string): boolean {
    return data.length === 1 && data >= "0" && data <= "9";
  }

  private isCountStarter(data: string): boolean {
    return data.length === 1 && data >= "1" && data <= "9";
  }

  private takeTotalCount(defaultValue: number = 1): number {
    const prefixRaw = this.prefixCount;
    const operatorRaw = this.operatorCount;
    this.prefixCount = "";
    this.operatorCount = "";

    if (!prefixRaw && !operatorRaw) return defaultValue;

    const parse = (raw: string): number | null => {
      if (!raw) return null;
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      return parsed;
    };

    const prefix = parse(prefixRaw);
    const operator = parse(operatorRaw);

    if (prefix === null && operator === null) return defaultValue;

    const total = prefix !== null && operator !== null
      ? prefix * operator
      : prefix ?? operator ?? defaultValue;

    if (!Number.isFinite(total) || total <= 0) return defaultValue;
    return Math.min(MAX_COUNT, total);
  }

  private cancelPendingOperator(data: string): void {
    this.pendingOperator = null;
    this.prefixCount = "";
    this.operatorCount = "";
    if (!this.isPrintableChunk(data)) {
      super.handleInput(data);
    }
  }

  private handlePendingMotion(data: string): void {
    if (!this.isPrintableInput(data)) {
      this.pendingMotion = null;
      this.cancelPendingOperator(data);
      return;
    }

    if (this.pendingOperator === "d") {
      this.deleteWithCharMotion(this.pendingMotion!, data);
      this.pendingOperator = null;
    } else if (this.pendingOperator === "c") {
      this.deleteWithCharMotion(this.pendingMotion!, data);
      this.pendingOperator = null;
      this.mode = "insert";
    } else if (this.pendingOperator === "y") {
      this.yankWithCharMotion(this.pendingMotion!, data);
      this.pendingOperator = null;
    } else {
      this.executeCharMotion(this.pendingMotion!, data);
    }

    this.pendingMotion = null;
  }

  private handlePendingTextObject(data: string): void {
    const kind = this.pendingTextObject!;
    const count = this.takeTotalCount(1);

    if (data === "w") {
      const range = this.getWordObjectRange(kind, count);
      this.pendingTextObject = null;
      if (!range || !this.pendingOperator) {
        this.pendingOperator = null;
        return;
      }
      this.applyTextObjectRange(range.startAbs, range.endAbs);
      return;
    }

    if (TEXT_OBJECT_DELIMITERS.has(data)) {
      // Delimiter text objects do not support counts; consume any count to
      // prevent it from leaking into subsequent input.
      const cursor = this.getCursor();
      const range = findDelimiterRange(
        this.getLines(),
        cursor.line,
        cursor.col,
        data,
        kind,
      );
      this.pendingTextObject = null;
      if (!range || !this.pendingOperator) {
        this.pendingOperator = null;
        return;
      }
      this.applyTextObjectRange(range.startAbs, range.endAbs);
      return;
    }

    this.pendingTextObject = null;
    this.cancelPendingOperator(data);
  }

  private applyTextObjectRange(
    startAbs: number,
    endAbs: number,
  ): void {
    const operator = this.pendingOperator;
    this.pendingOperator = null;

    if (operator === "d") {
      this.deleteRangeByAbsolute(startAbs, endAbs);
      return;
    }

    if (operator === "c") {
      this.deleteRangeByAbsolute(startAbs, endAbs);
      // After deletion the cursor is already at startAbs, which is the inner
      // start for `i` objects and the former opener position for `a` objects
      // (now the inner start because the opener was removed).
      this.mode = "insert";
      return;
    }

    if (operator === "y") {
      this.yankRangeByAbsolute(startAbs, endAbs);
      return;
    }
  }

  private handlePendingDelete(data: string): void {
    if (this.isDigit(data)) {
      if (this.operatorCount.length === 0) {
        if (data !== "0") {
          this.operatorCount = data;
          return;
        }
      } else {
        this.operatorCount += data;
        return;
      }
    }

    if (data === "d") {
      const count = this.takeTotalCount(1);
      this.deleteLinewiseByDelta(count - 1);
      this.pendingOperator = null;
      return;
    }

    if (data === "j" || data === "k") {
      const hasDualCount = this.prefixCount.length > 0 && this.operatorCount.length > 0;
      const count = this.takeTotalCount(1);
      const delta = hasDualCount ? Math.max(0, count - 1) : count;
      this.deleteLinewiseByDelta(data === "j" ? delta : -delta);
      this.pendingOperator = null;
      return;
    }

    if (data === "G") {
      if (this.prefixCount.length > 0 || this.operatorCount.length > 0) {
        this.cancelPendingOperator(data);
        return;
      }

      this.deleteToBufferEndLinewise();
      this.pendingOperator = null;
      return;
    }

    if (data === "_") {
      const count = this.takeTotalCount(1);
      this.deleteLinewiseByDelta(count - 1);
      this.pendingOperator = null;
      return;
    }

    if (CHAR_MOTION_KEYS.has(data)) {
      this.pendingMotion = data as PendingMotion;
      return;
    }

    const hasCount = this.prefixCount.length > 0 || this.operatorCount.length > 0;
    const supportsCountedWordMotion = (
      data === "w"
      || data === "e"
      || data === "b"
      || data === "W"
      || data === "E"
      || data === "B"
    );
    const supportsCountedTextObject = data === "i" || data === "a";

    if (hasCount && !supportsCountedWordMotion && !supportsCountedTextObject) {
      // Counted forms beyond dd, d{count}j/k, d{count}{f/F/t/T}, and
      // d{count}{w/e/b/W/E/B}/{i/a}w are out of scope.
      this.cancelPendingOperator(data);
      return;
    }

    if (supportsCountedTextObject) {
      this.pendingTextObject = data;
      return;
    }

    const motionCount = supportsCountedWordMotion ? this.takeTotalCount(1) : 1;
    if (this.deleteWithMotion(data, motionCount)) {
      this.pendingOperator = null;
      return;
    }

    // Invalid motion: cancel operator to avoid sticky surprising deletes.
    this.cancelPendingOperator(data);
  }

  private handlePendingChange(data: string): void {
    if (this.isDigit(data)) {
      if (this.operatorCount.length === 0) {
        if (data !== "0") {
          this.operatorCount = data;
          return;
        }
      } else {
        this.operatorCount += data;
        return;
      }
    }

    if (data === "c") {
      if (this.prefixCount.length > 0 || this.operatorCount.length > 0) {
        this.cancelPendingOperator(data);
        return;
      }

      this.cutLine();
      this.pendingOperator = null;
      this.mode = "insert";
      return;
    }

    if (data === "_") {
      const count = this.takeTotalCount(1);
      if (count <= 1) {
        this.cutLine();
      } else {
        const currentLine = this.getCursor().line;
        const lines = this.getLines();
        const clampedEnd = Math.min(currentLine + count - 1, lines.length - 1);
        this.writeToRegister(this.getLinewisePayload(currentLine, clampedEnd));
        const before = lines.slice(0, currentLine);
        const after = lines.slice(clampedEnd + 1);
        const newLines = [...before, "", ...after];
        const newText = newLines.join("\n");
        const cursorAbs = before.reduce((acc, l) => acc + l.length + 1, 0);
        this.replaceTextInBuffer(newText, cursorAbs);
      }
      this.pendingOperator = null;
      this.mode = "insert";
      return;
    }

    if (CHAR_MOTION_KEYS.has(data)) {
      this.pendingMotion = data as PendingMotion;
      return;
    }

    const hasCount = this.prefixCount.length > 0 || this.operatorCount.length > 0;
    const supportsCountedWordMotion = (
      data === "w"
      || data === "e"
      || data === "b"
      || data === "W"
      || data === "E"
      || data === "B"
    );
    const supportsCountedTextObject = data === "i" || data === "a";

    if (hasCount && !supportsCountedWordMotion && !supportsCountedTextObject) {
      this.cancelPendingOperator(data);
      return;
    }

    if (supportsCountedTextObject) {
      this.pendingTextObject = data;
      return;
    }

    const motionCount = supportsCountedWordMotion ? this.takeTotalCount(1) : 1;
    const effectiveMotion = data === "W" && this.isCursorOnNonWhitespace()
      ? "E"
      : data;
    if (this.deleteWithMotion(effectiveMotion, motionCount)) {
      this.pendingOperator = null;
      this.mode = "insert";
      return;
    }

    // Invalid motion: cancel operator to avoid sticky surprising changes.
    this.cancelPendingOperator(data);
  }

  private enterVisualMode(): void {
    const cursor = this.getCursor();
    this.clearPendingState();
    this.mode = "visual";
    this.visualState = {
      anchor: { line: cursor.line, col: cursor.col },
      rangeOverride: null,
    };
    this.requestRender();
  }

  private exitVisualMode(): void {
    this.visualState = null;
    this.clearPendingState();
    this.mode = "normal";
    this.requestRender();
  }

  private requestRender(): void {
    const editor = this as unknown as { tui?: { requestRender?: () => void } };
    editor.tui?.requestRender?.();
  }

  private startLockTimer(): void {
    this.stopLockTimer();
    const timer = setInterval(() => this.requestRender(), PILL_FRAME_INTERVAL_MS);
    if (typeof (timer as any).unref === "function") {
      (timer as any).unref();
    }
    this.lockTimer = timer;
  }

  private stopLockTimer(): void {
    if (this.lockTimer) {
      clearInterval(this.lockTimer);
      this.lockTimer = null;
    }
  }

  private enableHardwareCursor(): void {
    if (this.hardwareCursorEnabled) return;
    const tui = (this as unknown as { tui?: { setShowHardwareCursor?: (enabled: boolean) => void } }).tui;
    if (typeof tui?.setShowHardwareCursor === "function") {
      tui.setShowHardwareCursor(true);
      this.hardwareCursorEnabled = true;
    }
  }

  private syncCursorShape(): void {
    this.enableHardwareCursor();
    const tui = (this as unknown as { tui?: { terminal?: { write?: (data: string) => void } } }).tui;
    if (typeof tui?.terminal?.write !== "function") return;
    const desired = this.mode === "insert" ? CURSOR_SHAPE_BAR : CURSOR_SHAPE_BLOCK;
    if (this.cursorShapeSent === desired) return;
    tui.terminal.write(desired);
    this.cursorShapeSent = desired;
  }

  private stripInsertFakeCursor(lines: string[]): string[] {
    if (this.mode !== "insert") return lines;
    const marker = CURSOR_MARKER;
    const markerLen = marker.length;
    const inverseStart = "\x1b[7m";
    const inverseEnd = "\x1b[0m";
    return lines.map((line) => {
      const markerIndex = line.indexOf(marker);
      if (markerIndex === -1) return line;
      const afterMarker = line.slice(markerIndex + markerLen);
      if (!afterMarker.startsWith(inverseStart)) return line;
      const resetIndex = afterMarker.indexOf(inverseEnd, inverseStart.length);
      if (resetIndex === -1) return line;
      const char = afterMarker.slice(inverseStart.length, resetIndex);
      const rest = afterMarker.slice(resetIndex + inverseEnd.length);
      return line.slice(0, markerIndex + markerLen) + char + rest;
    });
  }

  private moveVisualHead(action: () => void): void {
    if (!this.visualState) return;
    this.visualState.rangeOverride = null;
    action();
    this.requestRender();
  }

  private swapVisualEnds(): void {
    if (!this.visualState) return;
    const previousAnchor = this.visualState.anchor;
    const head = this.getCursor();
    this.visualState.anchor = { line: head.line, col: head.col };
    this.visualState.rangeOverride = null;
    this.moveCursorToAbsoluteIndex(
      this.getAbsoluteIndex(previousAnchor.line, previousAnchor.col),
    );
  }

  private handleVisualMode(data: string): void {
    if (!this.visualState) {
      this.mode = "normal";
      return;
    }

    if (this.pendingTextObject) {
      this.handleVisualTextObject(data);
      return;
    }

    if (this.pendingMotion) {
      const motion = this.pendingMotion;
      this.pendingMotion = null;
      if (this.isPrintableInput(data)) {
        this.moveVisualHead(() => this.executeCharMotion(motion, data));
      } else {
        this.prefixCount = "";
        this.operatorCount = "";
      }
      return;
    }

    if (this.pendingG) {
      this.pendingG = false;
      if (data === "g") {
        const count = this.takeTotalCount(1);
        this.moveVisualHead(() => this.moveCursorToLineStart(count - 1));
      } else {
        this.prefixCount = "";
        this.operatorCount = "";
      }
      return;
    }

    if (this.prefixCount.length > 0 && this.isDigit(data)) {
      this.prefixCount += data;
      return;
    }
    if (this.prefixCount.length === 0 && this.isCountStarter(data)) {
      this.prefixCount = data;
      return;
    }

    if (data === "v") {
      this.exitVisualMode();
      return;
    }

    if (data === "o") {
      this.prefixCount = "";
      this.operatorCount = "";
      this.swapVisualEnds();
      return;
    }

    if (data === "d" || data === "x") {
      this.applyVisualSelection("delete");
      return;
    }
    if (data === "c" || data === "s") {
      this.applyVisualSelection("change");
      return;
    }
    if (data === "y") {
      this.applyVisualSelection("yank");
      return;
    }

    if (data === "i" || data === "a") {
      this.pendingTextObject = data;
      return;
    }

    if (data === "g") {
      this.pendingG = true;
      return;
    }

    if (data === "G") {
      const hadCount = this.prefixCount.length > 0;
      const count = this.takeTotalCount(1);
      this.moveVisualHead(() => {
        if (hadCount) this.moveCursorToLineStart(count - 1);
        else this.moveCursorToBufferEnd();
      });
      return;
    }

    if (CHAR_MOTION_KEYS.has(data)) {
      this.pendingMotion = data as PendingMotion;
      return;
    }

    if (data === ";" && this.lastCharMotion) {
      this.moveVisualHead(() =>
        this.executeCharMotion(this.lastCharMotion!.motion, this.lastCharMotion!.char, false),
      );
      return;
    }
    if (data === "," && this.lastCharMotion) {
      this.moveVisualHead(() =>
        this.executeCharMotion(
          reverseCharMotion(this.lastCharMotion!.motion),
          this.lastCharMotion!.char,
          false,
        ),
      );
      return;
    }

    if (data === "h" || data === "l") {
      const count = this.takeTotalCount(1);
      this.moveVisualHead(() => this.moveCursorBy(data === "h" ? -count : count));
      return;
    }
    if (data === "j" || data === "k") {
      const count = this.takeTotalCount(1);
      this.moveVisualHead(() => this.moveCursorVertically(data === "j" ? count : -count));
      return;
    }

    if (data === "0") {
      this.takeTotalCount(1);
      this.moveVisualHead(() => this.moveCursorToCol(0));
      return;
    }
    if (data === "$") {
      this.takeTotalCount(1);
      this.moveVisualHead(() => {
        const line = this.getLines()[this.getCursor().line] ?? "";
        this.moveCursorToCol(line.length);
      });
      return;
    }
    if (data === "^") {
      this.takeTotalCount(1);
      this.moveVisualHead(() => this.moveCursorToFirstNonWhitespace());
      return;
    }
    if (data === "_") {
      const count = this.takeTotalCount(1);
      this.moveVisualHead(() => {
        if (count > 1) this.moveCursorVertically(count - 1);
        this.moveCursorToFirstNonWhitespace();
      });
      return;
    }

    if (data === "{" || data === "}") {
      this.moveVisualHead(() =>
        this.executeParagraphMotion(data === "}" ? "forward" : "backward"),
      );
      return;
    }

    if (data === "w") {
      const count = this.takeTotalCount(1);
      this.moveVisualHead(() => this.moveWord("forward", "start", count, "word"));
      return;
    }
    if (data === "e") {
      const count = this.takeTotalCount(1);
      this.moveVisualHead(() => this.moveWord("forward", "end", count, "word"));
      return;
    }
    if (data === "b") {
      const count = this.takeTotalCount(1);
      this.moveVisualHead(() => this.moveWord("backward", "start", count, "word"));
      return;
    }
    if (data === "W") {
      const count = this.takeTotalCount(1);
      this.moveVisualHead(() => this.moveWord("forward", "start", count, "WORD"));
      return;
    }
    if (data === "E") {
      const count = this.takeTotalCount(1);
      this.moveVisualHead(() => this.moveWord("forward", "end", count, "WORD"));
      return;
    }
    if (data === "B") {
      const count = this.takeTotalCount(1);
      this.moveVisualHead(() => this.moveWord("backward", "start", count, "WORD"));
      return;
    }

    this.prefixCount = "";
    this.operatorCount = "";
    if (!this.isPrintableChunk(data)) {
      this.exitVisualMode();
      super.handleInput(data);
    }
  }

  private handleVisualTextObject(data: string): void {
    if (!this.visualState || !this.pendingTextObject) return;

    const kind = this.pendingTextObject;
    const count = this.takeTotalCount(1);
    this.pendingTextObject = null;

    let range: { startAbs: number; endAbs: number } | null = null;
    if (data === "w") {
      range = this.getWordObjectRange(kind, count);
    } else if (TEXT_OBJECT_DELIMITERS.has(data)) {
      const cursor = this.getCursor();
      range = findDelimiterRange(
        this.getLines(),
        cursor.line,
        cursor.col,
        data,
        kind,
      );
    }

    if (range) this.setVisualSelectionRange(range.startAbs, range.endAbs);
  }

  private setVisualSelectionRange(startAbs: number, endAbs: number): void {
    if (!this.visualState) return;

    const text = this.getText();
    const start = Math.max(0, Math.min(startAbs, text.length));
    const end = Math.max(start, Math.min(endAbs, text.length));
    const startCursor = this.getCursorFromAbsoluteIndex(text, start);
    let headAbs = start;

    if (end > start) {
      const endCursor = this.getCursorFromAbsoluteIndex(text, end);
      const lines = this.getLines();
      if (endCursor.col > 0) {
        const line = lines[endCursor.line] ?? "";
        const segments = getLineGraphemes(line.slice(0, endCursor.col));
        const last = segments[segments.length - 1];
        headAbs = this.getAbsoluteIndex(endCursor.line, last?.start ?? endCursor.col - 1);
      } else if (endCursor.line > 0) {
        const previousLine = endCursor.line - 1;
        headAbs = this.getAbsoluteIndex(previousLine, (lines[previousLine] ?? "").length);
      }
    }

    this.visualState.anchor = startCursor;
    this.visualState.rangeOverride = { startAbs: start, endAbs: end };
    this.moveCursorToAbsoluteIndex(headAbs);
  }

  private getVisualSelectionRange(): { startAbs: number; endAbs: number } | null {
    if (!this.visualState) return null;
    if (this.visualState.rangeOverride) return this.visualState.rangeOverride;

    const anchor = this.visualState.anchor;
    const head = this.getCursor();
    const anchorAbs = this.getAbsoluteIndex(anchor.line, anchor.col);
    const headAbs = this.getAbsoluteIndex(head.line, head.col);
    const startAbs = Math.min(anchorAbs, headAbs);
    const maxEndpoint = anchorAbs >= headAbs ? anchor : head;
    const line = this.getLines()[maxEndpoint.line] ?? "";
    const grapheme = this.getGraphemeRangeAtCol(line, maxEndpoint.col, 1);
    const endAbs = grapheme
      ? this.getAbsoluteIndex(maxEndpoint.line, grapheme.end)
      : Math.max(anchorAbs, headAbs);

    return { startAbs, endAbs };
  }

  private applyVisualSelection(operation: "delete" | "change" | "yank"): void {
    const range = this.getVisualSelectionRange();
    if (!range) {
      this.exitVisualMode();
      return;
    }

    const text = this.getText();
    const start = Math.max(0, Math.min(range.startAbs, text.length));
    const end = Math.max(start, Math.min(range.endAbs, text.length));
    const selected = text.slice(start, end);

    this.visualState = null;
    this.clearPendingState();

    if (operation === "yank") {
      if (selected) this.writeToRegister(selected);
      this.mode = "normal";
      this.moveCursorToAbsoluteIndex(start);
      return;
    }

    if (selected) this.writeToRegister(selected);
    this.mode = operation === "change" ? "insert" : "normal";
    if (end > start) {
      this.replaceTextInBuffer(text.slice(0, start) + text.slice(end), start);
    } else {
      this.moveCursorToAbsoluteIndex(start);
    }
  }

  private handleNormalMode(data: string): void {
    if (this.pendingG) {
      if (this.isDigit(data)) {
        this.pendingGCount += data;
        return;
      }

      this.pendingG = false;
      const hadGCount = this.pendingGCount.length > 0;
      this.pendingGCount = "";

      if (!hadGCount) {
        if (data === "g") {
          const count = this.takeTotalCount(1);
          this.moveCursorToLineStart(count - 1);
          return;
        }

        if (data === "J") {
          this.joinLines(false);
          return;
        }
      }

      this.clearPendingState();
      return;
    }

    if (this.prefixCount.length > 0) {
      if (this.isDigit(data)) {
        this.prefixCount += data;
        return;
      }

      if (data === "d" || data === "y") {
        this.pendingOperator = data;
        return;
      }

      if (data === "c") {
        this.pendingOperator = "c";
        return;
      }

      if (data === "g") {
        this.pendingGCount = "";
        this.pendingG = true;
        return;
      }

      if (data === "G") {
        const count = this.takeTotalCount(1);
        this.moveCursorToLineStart(count - 1);
        return;
      }

      const supportsCountedStandaloneEdit = (
        data === "x"
        || data === "r"
        || data === "S"
        || data === "D"
        || data === "C"
        || data === "p"
        || data === "P"
        || data === "Y"
        || data === "J"
        || data === "u"
        || data === CTRL_UNDERSCORE
        || matchesKey(data, "ctrl+_")
        || data === CTRL_R
        || matchesKey(data, "ctrl+r")
      );
      const supportsCountedCharMotion = (
        CHAR_MOTION_KEYS.has(data)
        || data === ";"
        || data === ","
      );
      const supportsCountedWordMotion = (
        data === "w"
        || data === "e"
        || data === "b"
        || data === "W"
        || data === "E"
        || data === "B"
      );
      const supportsCountedParagraphMotion = data === "{" || data === "}";
      const supportsCountedNav = (
        data === "h"
        || data === "j"
        || data === "k"
        || data === "l"
      );
      const supportsCountedUnderscore = data === "_";

      if (supportsCountedNav) {
        const count = this.takeTotalCount(1);
        const clamped = Math.min(count, MAX_COUNT);
        if (data === "h") {
          this.moveCursorBy(-clamped);
        } else if (data === "l") {
          this.moveCursorBy(clamped);
        } else {
          const delta = data === "j" ? clamped : -clamped;
          this.moveCursorVertically(delta);
        }
        return;
      }

      if (supportsCountedParagraphMotion) {
        this.executeParagraphMotion(data === "}" ? "forward" : "backward");
        return;
      }

      if (
        !supportsCountedStandaloneEdit
        && !supportsCountedCharMotion
        && !supportsCountedWordMotion
        && !supportsCountedParagraphMotion
        && !supportsCountedUnderscore
      ) {
        // Unsupported prefixed forms: drop count and keep processing this key.
        this.prefixCount = "";
        this.operatorCount = "";
      }
    } else if (this.isCountStarter(data)) {
      this.prefixCount = data;
      return;
    }

    if (data === "J") {
      this.joinLines(true);
      return;
    }

    if (data === "g") {
      this.pendingGCount = "";
      this.pendingG = true;
      return;
    }

    if (data === "G") {
      this.moveCursorToBufferEnd();
      return;
    }

    if (data === "r") {
      this.pendingReplace = true;
      return;
    }

    if (data === "s") {
      this.enterFlashMode();
      return;
    }

    if (data === "v") {
      this.enterVisualMode();
      return;
    }

    if (data === "d") {
      this.pendingOperator = "d";
      return;
    }

    if (data === "c") {
      this.pendingOperator = "c";
      return;
    }

    if (data === "y") {
      this.pendingOperator = "y";
      return;
    }

    if (data === "p") {
      this.putAfter();
      return;
    }

    if (data === "P") {
      this.putBefore();
      return;
    }

    if (data === "Y") {
      const count = this.takeTotalCount(1);
      this.yankLinewiseByDelta(count - 1);
      return;
    }

    if (CHAR_MOTION_KEYS.has(data)) {
      this.pendingMotion = data as PendingMotion;
      return;
    }

    if (data === ";" && this.lastCharMotion) {
      this.executeCharMotion(this.lastCharMotion.motion, this.lastCharMotion.char, false);
      return;
    }
    if (data === "," && this.lastCharMotion) {
      this.executeCharMotion(
        reverseCharMotion(this.lastCharMotion.motion),
        this.lastCharMotion.char,
        false,
      );
      return;
    }

    if (data === "u" || data === CTRL_UNDERSCORE || matchesKey(data, "ctrl+_")) {
      this.performUndo();
      return;
    }

    if (data === CTRL_R || matchesKey(data, "ctrl+r")) {
      this.performRedo();
      return;
    }

    if (data === "}" || data === "{") {
      this.executeParagraphMotion(data === "}" ? "forward" : "backward");
      return;
    }

    if (data === "^") {
      this.moveCursorToFirstNonWhitespace();
      return;
    }

    if (data === "_") {
      const count = this.takeTotalCount(1);
      if (count > 1) {
        this.moveCursorVertically(count - 1);
      }
      this.moveCursorToFirstNonWhitespace();
      return;
    }

    if (data === "w") {
      const count = this.takeTotalCount(1);
      return this.moveWord("forward", "start", count, "word");
    }
    if (data === "b") return this.moveWord("backward", "start", this.takeTotalCount(1), "word");
    if (data === "e") return this.moveWord("forward", "end", this.takeTotalCount(1), "word");
    if (data === "W") return this.moveWord("forward", "start", this.takeTotalCount(1), "WORD");
    if (data === "B") return this.moveWord("backward", "start", this.takeTotalCount(1), "WORD");
    if (data === "E") return this.moveWord("forward", "end", this.takeTotalCount(1), "WORD");

    if (Object.hasOwn(NORMAL_KEYS, data)) {
      return this.handleMappedKey(data);
    }

    // Pass control sequences (ctrl+c, etc.) to super, ignore printable chars
    if (this.isPrintableChunk(data)) return;
    super.handleInput(data);
  }

  private openLineBelow(): void {
    super.handleInput(CTRL_E);
    super.handleInput(NEWLINE);
  }

  private openLineAbove(): void {
    super.handleInput(CTRL_A);
    super.handleInput(NEWLINE);
    super.handleInput(ESC_UP);
  }

  private handleMappedKey(key: string): void {
    const seq = NORMAL_KEYS[key];
    switch (key) {
      case "i":
        this.mode = "insert";
        break;
      case "a":
        this.mode = "insert";
        if (!this.isCursorAtOrPastEol()) {
          super.handleInput(ESC_RIGHT);
        }
        break;
      case "A":
        this.mode = "insert";
        super.handleInput(CTRL_E);
        break;
      case "I":
        this.mode = "insert";
        this.moveCursorToFirstNonWhitespace();
        break;
      case "o":
        this.openLineBelow();
        this.mode = "insert";
        break;
      case "O":
        this.openLineAbove();
        this.mode = "insert";
        break;
      case "D":
        this.takeTotalCount(1);
        this.cutToEndOfLine();
        break;
      case "C":
        this.takeTotalCount(1);
        this.cutToEndOfLine();
        this.mode = "insert";
        break;
      case "S":
        this.takeTotalCount(1);
        this.cutCurrentLineContent();
        this.mode = "insert";
        break;
      case "x":
        this.cutCharUnderCursor();
        break;
      case "j":
        this.moveCursorVertically(1);
        break;
      case "k":
        this.moveCursorVertically(-1);
        break;
      default:
        if (seq) super.handleInput(seq);
    }
  }

  private executeCharMotion(motion: CharMotion, targetChar: string, saveMotion: boolean = true): void {
    const line = this.getLines()[this.getCursor().line] ?? "";
    const col = this.getCursor().col;
    const count = this.takeTotalCount(1);
    const targetCol = findCharMotionTarget(line, col, motion, targetChar, !saveMotion, count);

    if (targetCol !== null && saveMotion) {
      this.lastCharMotion = { motion, char: targetChar };
    }

    if (targetCol !== null && targetCol !== col) {
      this.moveCursorToCol(targetCol);
    }
  }

  private executeParagraphMotion(direction: "forward" | "backward"): void {
    const lines = this.getLines();
    const fromLine = this.getCursor().line;
    const count = this.takeTotalCount(1);
    const targetLine = findParagraphMotionTarget(lines, fromLine, direction, count);
    this.moveCursorToLineStart(targetLine);
  }

  private tryMoveCursorByState(delta: number): boolean {
    if (delta === 0) return true;

    const editor = this as unknown as {
      state?: { lines?: string[]; cursorLine?: number; cursorCol?: number };
      preferredVisualCol?: number;
      tui?: { requestRender?: () => void };
    };

    const state = editor.state;
    if (!state || !Array.isArray(state.lines)) return false;
    if (!Number.isInteger(state.cursorLine) || !Number.isInteger(state.cursorCol)) return false;

    const cursorLine = state.cursorLine as number;
    const cursorCol = state.cursorCol as number;
    const line = state.lines[cursorLine] ?? "";
    if (this.hasMultiCodeUnitGraphemes(line)) return false;

    const target = cursorCol + delta;

    // Only short-circuit line-local movement when each grapheme is one code
    // unit; otherwise let the base editor keep cursor boundaries valid.
    if (target < 0 || target > line.length) return false;

    state.cursorCol = target;
    editor.preferredVisualCol = target;
    editor.tui?.requestRender?.();
    return true;
  }

  private moveCursorBy(delta: number): void {
    if (delta === 0) return;

    if (this.tryMoveCursorByState(delta)) return;

    const seq = delta > 0 ? ESC_RIGHT : ESC_LEFT;
    for (let i = 0; i < Math.abs(delta); i++) {
      super.handleInput(seq);
    }
  }

  private moveCursorVertically(delta: number): void {
    if (delta === 0) return;

    const editor = this as unknown as {
      state?: { lines?: string[]; cursorLine?: number; cursorCol?: number };
      preferredVisualCol?: number | null;
      lastAction?: string | null;
      tui?: { requestRender?: () => void };
    };

    const state = editor.state;
    if (!state || !Array.isArray(state.lines) || state.lines.length === 0) {
      const seq = delta > 0 ? ESC_DOWN : ESC_UP;
      for (let i = 0; i < Math.abs(delta); i++) {
        super.handleInput(seq);
      }
      return;
    }

    const currentLine = state.cursorLine ?? 0;
    const targetLine = Math.max(0, Math.min(currentLine + delta, state.lines.length - 1));
    if (targetLine === currentLine) return;

    const preferredCol = editor.preferredVisualCol ?? state.cursorCol ?? 0;
    const targetLineText = state.lines[targetLine] ?? "";
    editor.lastAction = null;
    state.cursorLine = targetLine;
    state.cursorCol = Math.min(preferredCol, targetLineText.length);
    editor.preferredVisualCol = preferredCol;
    editor.tui?.requestRender?.();
  }

  private moveCursorToCol(col: number): void {
    const editor = this as unknown as {
      state?: { lines?: string[]; cursorLine?: number; cursorCol?: number };
      preferredVisualCol?: number | null;
      lastAction?: string | null;
      tui?: { requestRender?: () => void };
    };

    const state = editor.state;
    if (!state || !Array.isArray(state.lines)) return;

    editor.lastAction = null;
    state.cursorCol = col;
    editor.preferredVisualCol = col;
    editor.tui?.requestRender?.();
  }

  private moveCursorToAbsoluteIndex(abs: number): void {
    const editor = this as unknown as {
      state?: { lines?: string[]; cursorLine?: number; cursorCol?: number };
      preferredVisualCol?: number | null;
      lastAction?: string | null;
      tui?: { requestRender?: () => void };
    };

    const state = editor.state;
    if (!state || !Array.isArray(state.lines)) return;

    const { line, col } = this.getCursorFromAbsoluteIndex(this.getText(), abs);
    editor.lastAction = null;
    state.cursorLine = line;
    state.cursorCol = col;
    editor.preferredVisualCol = col;
    editor.tui?.requestRender?.();
  }

  private moveCursorToLineStart(lineIndex: number): void {
    const editor = this as unknown as {
      state?: { lines?: string[]; cursorLine?: number; cursorCol?: number };
      preferredVisualCol?: number | null;
      lastAction?: string | null;
      tui?: { requestRender?: () => void };
    };

    const state = editor.state;
    if (!state || !Array.isArray(state.lines) || state.lines.length === 0) {
      super.handleInput(CTRL_A);
      return;
    }

    const targetLine = Math.max(0, Math.min(lineIndex, state.lines.length - 1));
    editor.lastAction = null;
    state.cursorLine = targetLine;
    state.cursorCol = 0;
    editor.preferredVisualCol = null;
    editor.tui?.requestRender?.();
  }

  private moveCursorToFirstNonWhitespace(): void {
    const { line } = this.getCurrentLineAndCol();
    const targetCol = findFirstNonWhitespaceColumn(line);
    this.moveCursorToCol(targetCol);
  }

  private moveCursorToBufferEnd(): void {
    const lines = this.getLines();
    this.moveCursorToLineStart(Math.max(0, lines.length - 1));
  }

  private joinLines(normalize: boolean): void {
    const count = this.takeTotalCount(2);
    const steps = Math.max(0, count - 1);
    if (steps === 0) return;

    this.applySyntheticEdit(() => {
      const editor = this as unknown as ModalEditorInternals;
      const state = editor.state;
      if (!state || !Array.isArray(state.lines)) return;

      const currentLine = state.cursorLine ?? 0;
      let joinPoint = state.cursorCol ?? 0;

      for (let i = 0; i < steps; i++) {
        if (currentLine >= state.lines.length - 1) break;

        const left = state.lines[currentLine]!;
        const right = state.lines[currentLine + 1]!;
        let joined: string;

        if (normalize) {
          const trimmedRight = right.trimStart();
          const leftEndsWithSpace = left.length > 0 && /\s/.test(left[left.length - 1]!);
          const needsSeparator = !leftEndsWithSpace && trimmedRight.length > 0;
          joined = needsSeparator ? `${left} ${trimmedRight}` : left + trimmedRight;
          joinPoint = left.length;
        } else {
          joined = left + right;
          joinPoint = left.length;
        }

        state.lines.splice(currentLine, 2, joined);
      }

      state.cursorLine = currentLine;
      state.cursorCol = joinPoint;
      editor.preferredVisualCol = joinPoint;
    });
  }

  private isWordChar(ch: string): boolean {
    return /\w/.test(ch);
  }

  private charType(
    ch: string | undefined,
    semanticClass: WordMotionClass = "word",
  ): "space" | "word" | "other" {
    if (!ch || /\s/.test(ch)) return "space";
    if (semanticClass === "WORD") return "word";
    if (this.isWordChar(ch)) return "word";
    return "other";
  }

  private resolveWordMotion(
    motion: string,
  ): { motion: "w" | "e" | "b"; semanticClass: WordMotionClass } | null {
    if (motion === "w" || motion === "e" || motion === "b") {
      return { motion, semanticClass: "word" };
    }

    if (motion === "W" || motion === "E" || motion === "B") {
      const normalizedMotion = motion.toLowerCase() as "w" | "e" | "b";
      return { motion: normalizedMotion, semanticClass: "WORD" };
    }

    return null;
  }

  private getAbsoluteIndex(line: number, col: number): number {
    const lines = this.getLines();
    let idx = 0;
    for (let i = 0; i < line; i++) {
      idx += (lines[i] ?? "").length + 1;
    }
    return idx + col;
  }

  private getAbsoluteIndexFromCursor(): number {
    const cursor = this.getCursor();
    return this.getAbsoluteIndex(cursor.line, cursor.col);
  }

  private findWordTargetInText(
    text: string,
    abs: number,
    direction: "forward" | "backward",
    target: "start" | "end",
    count: number = 1,
    semanticClass: WordMotionClass = "word",
  ): number {
    const len = text.length;
    if (len === 0) return 0;

    const steps = Math.max(1, Math.min(MAX_COUNT, count));
    let i = Math.max(0, Math.min(abs, len));

    for (let step = 0; step < steps; step++) {
      let next = i;

      if (direction === "forward") {
        if (next >= len) {
          next = len;
        } else if (target === "start") {
          const startType = this.charType(text[next], semanticClass);
          if (startType !== "space") {
            while (next < len && this.charType(text[next], semanticClass) === startType) next++;
          }
          while (next < len && this.charType(text[next], semanticClass) === "space") next++;
        } else {
          if (next < len - 1) next++;
          while (next < len && this.charType(text[next], semanticClass) === "space") next++;
          if (next >= len) {
            next = len;
          } else {
            const t = this.charType(text[next], semanticClass);
            while (next < len - 1 && this.charType(text[next + 1], semanticClass) === t) next++;
          }
        }
      } else {
        if (next >= len) next = len - 1;
        if (next > 0) next--;
        while (next > 0 && this.charType(text[next], semanticClass) === "space") next--;
        const t = this.charType(text[next], semanticClass);
        while (next > 0 && this.charType(text[next - 1], semanticClass) === t) next--;
      }

      if (next === i) break;
      i = next;
    }

    return i;
  }

  private tryFindWordTargetInLine(
    line: string,
    col: number,
    direction: WordMotionDirection,
    target: WordMotionTarget,
    allowSameColumn: boolean = false,
    semanticClass: WordMotionClass = "word",
  ): number | null {
    if (line.length === 0) return null;
    if (col < 0 || col > line.length) return null;

    if (direction === "forward") {
      if (col >= line.length) return null;
    } else {
      if (col <= 0) return null;
      if (!/\S/.test(line.slice(0, col))) return null;
    }

    const targetCol = this.wordBoundaryCache.tryFindTarget(
      line,
      col,
      direction,
      target,
      semanticClass,
    );
    if (targetCol === null) return null;

    if (direction === "forward") {
      if (targetCol >= line.length) return null;
      if (allowSameColumn) {
        if (targetCol < col) return null;
      } else if (targetCol <= col) {
        return null;
      }
      return targetCol;
    }

    if (allowSameColumn) {
      if (targetCol > col) return null;
    } else if (targetCol >= col) {
      return null;
    }

    return targetCol;
  }

  private tryFindWordTargetLineLocal(
    direction: WordMotionDirection,
    target: WordMotionTarget,
    semanticClass: WordMotionClass = "word",
  ): number | null {
    const cursor = this.getCursor();
    const lineIndex = cursor.line;
    const col = cursor.col;
    const lineSnapshot = this.getLines()[lineIndex] ?? "";

    const targetCol = this.tryFindWordTargetInLine(
      lineSnapshot,
      col,
      direction,
      target,
      false,
      semanticClass,
    );
    if (targetCol === null) return null;

    const liveLine = this.getLines()[lineIndex] ?? "";
    const liveCol = this.getCursor().col;
    if (liveLine !== lineSnapshot || liveCol !== col) return null;

    return targetCol;
  }

  private tryMoveWordLineLocal(
    direction: "forward" | "backward",
    target: "start" | "end",
    semanticClass: WordMotionClass = "word",
  ): boolean {
    const col = this.getCursor().col;
    const targetCol = this.tryFindWordTargetLineLocal(direction, target, semanticClass);
    if (targetCol === null || targetCol === col) return false;

    this.moveCursorToCol(targetCol);
    return true;
  }

  private tryWordMotionLineLocalRange(
    motion: "w" | "e" | "b",
    count: number = 1,
    semanticClass: WordMotionClass = "word",
  ): { col: number; targetCol: number; inclusive: boolean } | null {
    const cursor = this.getCursor();
    const lineIndex = cursor.line;
    const col = cursor.col;
    const lineSnapshot = this.getLines()[lineIndex] ?? "";
    const direction: WordMotionDirection = motion === "b" ? "backward" : "forward";
    const target: WordMotionTarget = motion === "e" ? "end" : "start";
    const steps = Math.max(1, Math.min(MAX_COUNT, count));

    let currentCol = col;
    for (let step = 0; step < steps; step++) {
      const nextCol = this.tryFindWordTargetInLine(
        lineSnapshot,
        currentCol,
        direction,
        target,
        motion === "e",
        semanticClass,
      );
      if (nextCol === null) return null;
      if (nextCol === currentCol && step < steps - 1) return null;
      currentCol = nextCol;
    }

    const liveLine = this.getLines()[lineIndex] ?? "";
    const liveCol = this.getCursor().col;
    if (liveLine !== lineSnapshot || liveCol !== col) return null;

    return {
      col,
      targetCol: currentCol,
      inclusive: motion === "e",
    };
  }

  private moveWord(
    direction: "forward" | "backward",
    target: "start" | "end",
    count: number = 1,
    semanticClass: WordMotionClass = "word",
  ): void {
    let remaining = Math.max(1, Math.min(MAX_COUNT, count));

    while (remaining > 0) {
      if (this.tryMoveWordLineLocal(direction, target, semanticClass)) {
        remaining--;
        continue;
      }

      const text = this.getText();
      const currentAbs = this.getAbsoluteIndexFromCursor();
      const targetAbs = this.findWordTargetInText(
        text,
        currentAbs,
        direction,
        target,
        remaining,
        semanticClass,
      );
      if (targetAbs !== currentAbs) {
        this.moveCursorToAbsoluteIndex(targetAbs);
      }
      return;
    }
  }

  private writeToRegister(text: string): void {
    this.unnamedRegister = text;
    if (!text) return;

    void this.clipboardFn(text).catch(() => {});
  }

  private getCurrentLineAndCol(): { line: string; col: number } {
    const line = this.getLines()[this.getCursor().line] ?? "";
    const col = this.getCursor().col;
    return { line, col };
  }

  private hasMultiCodeUnitGraphemes(line: string): boolean {
    return getLineGraphemes(line).some((segment) => segment.end - segment.start > 1);
  }

  private getGraphemeRangeAtCol(
    line: string,
    col: number,
    count: number,
    clampToLine: boolean = false,
  ): { start: number; end: number } | null {
    const clampedCol = Math.max(0, Math.min(col, line.length));
    const segments = getLineGraphemes(line);
    const startIndex = segments.findIndex((segment) => clampedCol < segment.end);
    if (startIndex === -1) return null;

    let endIndex = startIndex + Math.max(1, count) - 1;
    if (endIndex >= segments.length) {
      if (!clampToLine) return null;
      endIndex = segments.length - 1;
    }

    return {
      start: segments[startIndex]!.start,
      end: segments[endIndex]!.end,
    };
  }

  private isCursorOnNonWhitespace(): boolean {
    const { line, col } = this.getCurrentLineAndCol();
    const ch = line[col];
    return ch !== undefined && !/\s/.test(ch);
  }

  private isCursorAtOrPastEol(): boolean {
    const { line, col } = this.getCurrentLineAndCol();
    return col >= line.length;
  }

  private cutCharUnderCursor(): void {
    const count = Math.max(1, Math.min(MAX_COUNT, this.takeTotalCount(1)));
    const cursor = this.getCursor();
    const line = this.getLines()[cursor.line] ?? "";
    const range = this.getGraphemeRangeAtCol(line, cursor.col, count, true);
    if (!range) return;

    const lineStartAbs = this.getAbsoluteIndex(cursor.line, 0);
    const text = this.getText();
    this.writeToRegister(line.slice(range.start, range.end));
    this.replaceTextInBuffer(
      text.slice(0, lineStartAbs + range.start) + text.slice(lineStartAbs + range.end),
      lineStartAbs + range.start,
    );
  }

  private cutToEndOfLine(): void {
    const lines = this.getLines();
    const cursorLine = this.getCursor().line;
    const { line, col } = this.getCurrentLineAndCol();

    const hasNextLine = cursorLine < lines.length - 1;
    const deleted = col < line.length ? line.slice(col) : hasNextLine ? "\n" : "";

    this.writeToRegister(deleted);
    super.handleInput(CTRL_K);
  }

  private cutCurrentLineContent(): void {
    const lines = this.getLines();
    const cursorLine = this.getCursor().line;
    const { line } = this.getCurrentLineAndCol();

    const hasNextLine = cursorLine < lines.length - 1;
    const deleted = line.length > 0 ? line : hasNextLine ? "\n" : "";

    this.writeToRegister(deleted);
    super.handleInput(CTRL_A);
    super.handleInput(CTRL_K);
  }

  private cutLine(): void {
    this.cutCurrentLineContent();
  }

  private getNormalizedLineRange(startLine: number, endLine: number): { start: number; end: number } {
    const lines = this.getLines();
    const last = Math.max(0, lines.length - 1);
    const clampedStart = Math.max(0, Math.min(startLine, last));
    const clampedEnd = Math.max(0, Math.min(endLine, last));
    return {
      start: Math.min(clampedStart, clampedEnd),
      end: Math.max(clampedStart, clampedEnd),
    };
  }

  private getLinewisePayload(startLine: number, endLine: number): string {
    const lines = this.getLines();
    const { start, end } = this.getNormalizedLineRange(startLine, endLine);
    return `${lines.slice(start, end + 1).join("\n")}\n`;
  }

  private getLineDeleteAbsoluteRange(startLine: number, endLine: number): { startAbs: number; endAbs: number } {
    const lines = this.getLines();
    const text = this.getText();
    const { start, end } = this.getNormalizedLineRange(startLine, endLine);
    const lastLine = Math.max(0, lines.length - 1);

    let startAbs = this.getAbsoluteIndex(start, 0);
    let endAbs: number;

    if (end < lastLine) {
      const endLineText = lines[end] ?? "";
      endAbs = this.getAbsoluteIndex(end, endLineText.length) + 1;
    } else {
      endAbs = text.length;
      if (start > 0) {
        startAbs = Math.max(0, startAbs - 1);
      }
    }

    return { startAbs, endAbs };
  }

  private deleteLineRange(startLine: number, endLine: number): void {
    const lines = this.getLines();
    if (lines.length === 0) return;

    const payload = this.getLinewisePayload(startLine, endLine);
    const { startAbs, endAbs } = this.getLineDeleteAbsoluteRange(startLine, endLine);

    this.writeToRegister(payload);

    if (endAbs > startAbs) {
      const text = this.getText();
      const newText = text.slice(0, startAbs) + text.slice(endAbs);
      this.replaceTextInBuffer(newText, startAbs);

      // Ensure cursor is at column 0 of the landing line
      super.handleInput(CTRL_A);
    }
  }

  private yankLineRange(startLine: number, endLine: number): void {
    if (this.getLines().length === 0) return;
    this.writeToRegister(this.getLinewisePayload(startLine, endLine));
  }

  private deleteLinewiseByDelta(delta: number): void {
    const currentLine = this.getCursor().line;
    this.deleteLineRange(currentLine, currentLine + delta);
  }

  private yankLinewiseByDelta(delta: number): void {
    const currentLine = this.getCursor().line;
    this.yankLineRange(currentLine, currentLine + delta);
  }

  private deleteToBufferEndLinewise(): void {
    this.deleteLineRange(this.getCursor().line, this.getLines().length - 1);
  }

  private yankToBufferEndLinewise(): void {
    this.yankLineRange(this.getCursor().line, this.getLines().length - 1);
  }

  private deleteWithMotion(motion: string, count: number = 1): boolean {
    const cursor = this.getCursor();
    const col = cursor.col;

    if (motion === "$") {
      // Match D/C behavior exactly, including newline kill at EOL.
      this.cutToEndOfLine();
      return true;
    }

    if (motion === "0") {
      this.deleteRange(col, 0, false);
      return true;
    }

    if (motion === "^") {
      this.deleteRange(col, findFirstNonWhitespaceColumn(this.getLines()[cursor.line] ?? ""), false);
      return true;
    }

    if (motion === "h" || motion === "l") {
      const line = this.getLines()[cursor.line] ?? "";
      const lineStartAbs = this.getAbsoluteIndex(cursor.line, 0);
      const targetCol = col + (motion === "l" ? 0 : -1);
      if (targetCol < 0 || targetCol >= line.length) return false;
      const range = this.getGraphemeRangeAtCol(line, targetCol, 1);
      if (!range) return false;
      this.deleteRangeByAbsolute(lineStartAbs + range.start, lineStartAbs + range.end);
      return true;
    }

    const wordMotion = this.resolveWordMotion(motion);
    if (wordMotion) {
      const lineLocalRange = this.tryWordMotionLineLocalRange(
        wordMotion.motion,
        count,
        wordMotion.semanticClass,
      );
      if (lineLocalRange) {
        this.deleteRange(
          lineLocalRange.col,
          lineLocalRange.targetCol,
          lineLocalRange.inclusive,
        );
        return true;
      }

      const text = this.getText();
      const currentAbs = this.getAbsoluteIndexFromCursor();
      const targetAbs = this.findWordTargetInText(
        text,
        currentAbs,
        wordMotion.motion === "b" ? "backward" : "forward",
        wordMotion.motion === "e" ? "end" : "start",
        count,
        wordMotion.semanticClass,
      );
      this.deleteRangeByAbsolute(currentAbs, targetAbs, wordMotion.motion === "e");
      return true;
    }

    return false;
  }

  private deleteWithCharMotion(motion: CharMotion, targetChar: string): void {
    const line = this.getLines()[this.getCursor().line] ?? "";
    const col = this.getCursor().col;
    const count = this.takeTotalCount(1);
    const targetCol = findCharMotionTarget(line, col, motion, targetChar, false, count);

    if (targetCol === null) return;

    this.lastCharMotion = { motion, char: targetChar };
    this.deleteRange(col, targetCol, true); // char motions are inclusive
  }

  private handlePendingYank(data: string): void {
    if (this.isDigit(data)) {
      if (this.operatorCount.length === 0) {
        if (data !== "0") {
          this.operatorCount = data;
          return;
        }
      } else {
        this.operatorCount += data;
        return;
      }
    }

    if (data === "y") {
      const count = this.takeTotalCount(1);
      this.yankLinewiseByDelta(count - 1);
      this.pendingOperator = null;
      return;
    }

    if (data === "j" || data === "k") {
      const hasDualCount = this.prefixCount.length > 0 && this.operatorCount.length > 0;
      const count = this.takeTotalCount(1);
      const delta = hasDualCount ? Math.max(0, count - 1) : count;
      this.yankLinewiseByDelta(data === "j" ? delta : -delta);
      this.pendingOperator = null;
      return;
    }

    if (data === "G") {
      if (this.prefixCount.length > 0 || this.operatorCount.length > 0) {
        this.cancelPendingOperator(data);
        return;
      }

      this.yankToBufferEndLinewise();
      this.pendingOperator = null;
      return;
    }

    if (data === "_") {
      const count = this.takeTotalCount(1);
      this.yankLinewiseByDelta(count - 1);
      this.pendingOperator = null;
      return;
    }

    if (CHAR_MOTION_KEYS.has(data)) {
      this.pendingMotion = data as PendingMotion;
      return;
    }

    if (this.prefixCount.length > 0 || this.operatorCount.length > 0) {
      // Counted forms beyond yy, y{count}j/k, and y{count}{f/F/t/T} are out of scope.
      this.cancelPendingOperator(data);
      return;
    }

    if (data === "i" || data === "a") {
      this.pendingTextObject = data;
      return;
    }

    if (this.yankWithMotion(data)) {
      this.pendingOperator = null;
    } else {
      this.cancelPendingOperator(data); // cancel on unrecognised motion
    }
  }

  private yankWithMotion(motion: string): boolean {
    const cursor = this.getCursor();
    const line = this.getLines()[cursor.line] ?? "";
    const col = cursor.col;

    if (motion === "$") {
      this.yankRange(col, line.length, false);
      return true;
    }

    if (motion === "0") {
      this.yankRange(col, 0, false);
      return true;
    }

    if (motion === "^") {
      this.yankRange(col, findFirstNonWhitespaceColumn(line), false);
      return true;
    }

    if (motion === "h" || motion === "l") {
      const lineStartAbs = this.getAbsoluteIndex(cursor.line, 0);
      const targetCol = col + (motion === "l" ? 0 : -1);
      if (targetCol < 0 || targetCol >= line.length) return false;
      const range = this.getGraphemeRangeAtCol(line, targetCol, 1);
      if (!range) return false;
      this.yankRangeByAbsolute(lineStartAbs + range.start, lineStartAbs + range.end);
      return true;
    }

    const wordMotion = this.resolveWordMotion(motion);
    if (wordMotion) {
      const lineLocalRange = this.tryWordMotionLineLocalRange(
        wordMotion.motion,
        1,
        wordMotion.semanticClass,
      );
      if (lineLocalRange) {
        this.yankRange(
          lineLocalRange.col,
          lineLocalRange.targetCol,
          lineLocalRange.inclusive,
        );
        return true;
      }

      const text = this.getText();
      const currentAbs = this.getAbsoluteIndexFromCursor();
      const targetAbs = this.findWordTargetInText(
        text,
        currentAbs,
        wordMotion.motion === "b" ? "backward" : "forward",
        wordMotion.motion === "e" ? "end" : "start",
        1,
        wordMotion.semanticClass,
      );
      this.yankRangeByAbsolute(currentAbs, targetAbs, wordMotion.motion === "e");
      return true;
    }

    return false;
  }

  private yankWithCharMotion(motion: CharMotion, targetChar: string): void {
    const line = this.getLines()[this.getCursor().line] ?? "";
    const col = this.getCursor().col;
    const count = this.takeTotalCount(1);
    const targetCol = findCharMotionTarget(line, col, motion, targetChar, false, count);

    if (targetCol === null) return;

    this.lastCharMotion = { motion, char: targetChar };
    this.yankRange(col, targetCol, true); // char motions are inclusive
  }

  private yankRange(col: number, targetCol: number, inclusive: boolean): void {
    const line = this.getLines()[this.getCursor().line] ?? "";
    const start = Math.min(col, targetCol);
    const rawEnd = Math.max(col, targetCol) + (inclusive ? 1 : 0);
    let end = Math.min(rawEnd, line.length);

    if (inclusive) {
      const targetRange = this.getGraphemeRangeAtCol(line, Math.max(col, targetCol), 1);
      end = targetRange?.end ?? end;
    }

    if (end <= start) return;

    // Yank only — no cursor movement, no text mutation
    this.writeToRegister(line.slice(start, end));
  }

  private yankRangeByAbsolute(currentAbs: number, targetAbs: number, inclusive: boolean = false): void {
    const text = this.getText();
    const start = Math.min(currentAbs, targetAbs);
    const rawEnd = Math.max(currentAbs, targetAbs) + (inclusive ? 1 : 0);
    const end = Math.min(rawEnd, text.length);
    if (end <= start) return;
    this.writeToRegister(text.slice(start, end));
  }

  private getCursorFromAbsoluteIndex(text: string, abs: number): { line: number; col: number } {
    const lines = text.length === 0 ? [""] : text.split("\n");
    let remaining = Math.max(0, Math.min(abs, text.length));
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex] ?? "";
      if (remaining <= line.length) return { line: lineIndex, col: remaining };
      remaining -= line.length + 1;
    }
    const lastLine = Math.max(0, lines.length - 1);
    return { line: lastLine, col: (lines[lastLine] ?? "").length };
  }

  private replaceTextInBuffer(text: string, cursorAbs: number): void {
    const editor = this as unknown as {
      state?: { lines?: string[]; cursorLine?: number; cursorCol?: number };
      preferredVisualCol?: number | null;
      historyIndex?: number;
      lastAction?: string | null;
      onChange?: (text: string) => void;
      tui?: { requestRender?: () => void };
      pushUndoSnapshot?: () => void;
      autocompleteState?: unknown;
      updateAutocomplete?: () => void;
    };
    const state = editor.state;
    if (!state) return;
    const currentText = this.getText();
    if (currentText !== text) editor.pushUndoSnapshot?.();
    const nextLines = text.length === 0 ? [""] : text.split("\n");
    const { line, col } = this.getCursorFromAbsoluteIndex(text, cursorAbs);
    editor.historyIndex = -1;
    editor.lastAction = null;
    state.lines = nextLines;
    state.cursorLine = line;
    state.cursorCol = col;
    editor.preferredVisualCol = null;
    editor.onChange?.(text);
    if (editor.autocompleteState) editor.updateAutocomplete?.();
    editor.tui?.requestRender?.();
  }

  private deleteRangeByAbsolute(currentAbs: number, targetAbs: number, inclusive: boolean = false): void {
    const text = this.getText();
    const start = Math.min(currentAbs, targetAbs);
    const rawEnd = Math.max(currentAbs, targetAbs) + (inclusive ? 1 : 0);
    const end = Math.min(rawEnd, text.length);

    if (end <= start) return;

    this.writeToRegister(text.slice(start, end));

    this.replaceTextInBuffer(text.slice(0, start) + text.slice(end), start);
  }

  private getWordObjectRange(
    kind: "i" | "a",
    count: number = 1,
  ): { startAbs: number; endAbs: number } | null {
    const lines = this.getLines();
    const cursor = this.getCursor();
    const line = lines[cursor.line] ?? "";
    if (!line) return null;

    const steps = Math.max(1, Math.min(MAX_COUNT, count));
    const hasWordChar = (idx: number) => idx >= 0 && idx < line.length && this.isWordChar(line[idx]!);

    let col = Math.min(cursor.col, Math.max(0, line.length - 1));

    if (!hasWordChar(col)) {
      let right = col;
      while (right < line.length && !hasWordChar(right)) right++;
      if (right < line.length) {
        col = right;
      } else {
        let left = Math.min(col, line.length - 1);
        while (left >= 0 && !hasWordChar(left)) left--;
        if (left < 0) return null;
        col = left;
      }
    }

    let start = col;
    while (start > 0 && hasWordChar(start - 1)) start--;

    let end = col + 1;
    while (end < line.length && hasWordChar(end)) end++;

    let remaining = steps - 1;
    while (remaining > 0) {
      let nextWordStart = end;
      while (nextWordStart < line.length && !hasWordChar(nextWordStart)) nextWordStart++;
      if (nextWordStart >= line.length) break;

      let nextWordEnd = nextWordStart + 1;
      while (nextWordEnd < line.length && hasWordChar(nextWordEnd)) nextWordEnd++;

      end = nextWordEnd;
      remaining--;
    }

    if (kind === "a") {
      let aroundEnd = end;
      while (aroundEnd < line.length && /\s/.test(line[aroundEnd]!)) aroundEnd++;

      if (aroundEnd > end) {
        end = aroundEnd;
      } else {
        while (start > 0 && /\s/.test(line[start - 1]!)) start--;
      }
    }

    return {
      startAbs: this.getAbsoluteIndex(cursor.line, start),
      endAbs: this.getAbsoluteIndex(cursor.line, end),
    };
  }

  private static readonly PUT_SIZE_LIMIT = 512 * 1024; // 512 KB safety cap

  private putAfter(): void {
    const count = this.takeTotalCount(1);
    const text = this.unnamedRegister;
    if (!text) return;
    const safeCount = Math.min(count, Math.max(1, Math.floor(ModalEditor.PUT_SIZE_LIMIT / text.length)));

    if (text.endsWith("\n")) {
      const content = text.slice(0, -1);
      for (let i = 0; i < safeCount; i++) {
        // Line-wise: insert new line below and fill it
        super.handleInput(CTRL_E);
        super.handleInput(NEWLINE);
        for (const char of content) {
          super.handleInput(char === "\n" ? NEWLINE : char);
        }
      }
      return;
    }

    // Character-wise: insert after cursor
    if (!this.isCursorAtOrPastEol()) {
      super.handleInput(ESC_RIGHT);
    }
    for (let i = 0; i < safeCount; i++) {
      for (const char of text) {
        super.handleInput(char === "\n" ? NEWLINE : char);
      }
    }
  }

  private putBefore(): void {
    const count = this.takeTotalCount(1);
    const text = this.unnamedRegister;
    if (!text) return;
    const safeCount = Math.min(count, Math.max(1, Math.floor(ModalEditor.PUT_SIZE_LIMIT / text.length)));

    if (text.endsWith("\n")) {
      const content = text.slice(0, -1);
      for (let i = 0; i < safeCount; i++) {
        // Line-wise: insert new line above and fill it
        super.handleInput(CTRL_A);
        super.handleInput(NEWLINE);
        super.handleInput(ESC_UP);
        for (const char of content) {
          super.handleInput(char === "\n" ? NEWLINE : char);
        }
      }
      return;
    }

    // Character-wise: insert before cursor (just type it)
    for (let i = 0; i < safeCount; i++) {
      for (const char of text) {
        super.handleInput(char === "\n" ? NEWLINE : char);
      }
    }
  }

  private deleteRange(col: number, targetCol: number, inclusive: boolean): void {
    const cursor = this.getCursor();
    const line = this.getLines()[cursor.line] ?? "";
    const lineStartAbs = this.getAbsoluteIndex(cursor.line, 0);
    const start = Math.min(col, targetCol);
    const rawEnd = Math.max(col, targetCol) + (inclusive ? 1 : 0);
    let end = Math.min(rawEnd, line.length);

    if (inclusive) {
      const targetRange = this.getGraphemeRangeAtCol(line, Math.max(col, targetCol), 1);
      end = targetRange?.end ?? end;
    }

    this.deleteRangeByAbsolute(lineStartAbs + start, lineStartAbs + end);
  }

  private enterFlashMode(): void {
    const cursor = this.getCursor();
    this.flashState = {
      pattern: "",
      origin: { line: cursor.line, col: cursor.col },
      matches: [],
    };
    const editor = this as unknown as { tui?: { requestRender?: () => void } };
    editor.tui?.requestRender?.();
  }

  private cancelFlashMode(restoreOrigin: boolean): void {
    if (!this.flashState) return;
    if (restoreOrigin) {
      this.moveCursorToAbsoluteIndex(
        this.getAbsoluteIndex(this.flashState.origin.line, this.flashState.origin.col),
      );
    }
    this.flashState = null;
    const editor = this as unknown as { tui?: { requestRender?: () => void } };
    editor.tui?.requestRender?.();
  }

  private handleFlashInput(data: string): void {
    if (!this.flashState) return;

    if (matchesKey(data, "return") || data === "\r" || data === "\n") {
      const first = this.flashState.matches[0];
      if (first) {
        this.jumpToFlashMatch(first);
      } else {
        this.cancelFlashMode(true);
      }
      return;
    }

    if (matchesKey(data, "backspace") || data === "\x7f" || data === "\b") {
      if (this.flashState.pattern.length === 0) {
        this.cancelFlashMode(true);
      } else {
        this.flashState.pattern = this.flashState.pattern.slice(0, -1);
        this.recomputeFlashMatches();
      }
      return;
    }

    if (!this.isPrintableInput(data)) {
      return;
    }

    const match = this.flashState.matches.find((m) => m.label === data);
    if (match) {
      this.jumpToFlashMatch(match);
      return;
    }

    this.flashState.pattern += data;
    this.recomputeFlashMatches();
  }

  private jumpToFlashMatch(match: FlashMatch): void {
    this.moveCursorToAbsoluteIndex(this.getAbsoluteIndex(match.line, match.col));
    this.flashState = null;
  }

  private recomputeFlashMatches(): void {
    if (!this.flashState) return;
    const pattern = this.flashState.pattern;
    if (pattern.length === 0) {
      this.flashState.matches = [];
    } else {
      this.flashState.matches = this.assignFlashLabels(this.findFlashMatches(pattern));
    }
    const editor = this as unknown as { tui?: { requestRender?: () => void } };
    editor.tui?.requestRender?.();
  }

  private readonly FLASH_LABELS = "asdfghjklqwertyuiopzxcvbnm";

  private findFlashMatches(pattern: string): Array<{ line: number; col: number }> {
    const lines = this.getLines();
    const matches: Array<{ line: number; col: number }> = [];
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex] ?? "";
      let col = 0;
      while (col <= line.length - pattern.length) {
        if (line.slice(col, col + pattern.length) === pattern) {
          matches.push({ line: lineIndex, col });
          col += Math.max(1, pattern.length);
        } else {
          col++;
        }
      }
    }
    return this.orderFlashMatches(matches);
  }

  private orderFlashMatches(
    matches: Array<{ line: number; col: number }>,
  ): Array<{ line: number; col: number }> {
    if (!this.flashState) return matches;
    const origin = this.flashState.origin;
    const sameLineAfter = matches.filter(
      (m) => m.line === origin.line && m.col > origin.col,
    );
    const linesBelow = matches.filter((m) => m.line > origin.line);
    const sameLineBeforeOrAt = matches.filter(
      (m) => m.line === origin.line && m.col <= origin.col,
    );
    const linesAbove = matches.filter((m) => m.line < origin.line);
    return [...sameLineAfter, ...linesBelow, ...sameLineBeforeOrAt, ...linesAbove];
  }

  private assignFlashLabels(
    matches: Array<{ line: number; col: number }>,
  ): FlashMatch[] {
    const labels = this.FLASH_LABELS;
    return matches.slice(0, labels.length).map((m, i) => ({
      ...m,
      label: labels[i]!,
    }));
  }

  private renderVisualOverlays(width: number, baseLines: string[]): string[] {
    if (this.mode !== "visual" || !this.visualState) return baseLines;

    const selection = this.getVisualSelectionRange();
    if (!selection || selection.endAbs <= selection.startAbs) return baseLines;

    const paddingX = Math.min(
      this.getPaddingX(),
      Math.max(0, Math.floor((width - 1) / 2)),
    );
    const contentWidth = Math.max(1, width - paddingX * 2);
    const layoutWidth = Math.max(1, contentWidth - (paddingX ? 0 : 1));
    const leftPadding = " ".repeat(paddingX);
    const layoutLines = this.buildFlashLayout(layoutWidth);
    if (layoutLines.length === 0) return baseLines;

    const cursorLayoutIndex = this.findLayoutLineIndex(layoutLines, this.getCursor());
    if (cursorLayoutIndex === -1) return baseLines;

    const terminalRows = (this as unknown as { tui?: { terminal?: { rows: number } } })
      .tui?.terminal?.rows ?? 24;
    const maxVisibleLines = Math.max(5, Math.floor(terminalRows * 0.3));
    const scrollOffset = this.getRenderedScrollOffset(
      layoutLines.length,
      maxVisibleLines,
    );

    const contentStart = 1;
    const contentEnd = baseLines.length - 1;
    const result = [...baseLines];

    for (let layoutIndex = scrollOffset; layoutIndex < layoutLines.length; layoutIndex++) {
      if (layoutIndex >= scrollOffset + maxVisibleLines) break;

      const renderedContentIndex = contentStart + (layoutIndex - scrollOffset);
      if (renderedContentIndex >= contentEnd) break;

      const layoutLine = layoutLines[layoutIndex]!;
      const lineStartAbs = this.getAbsoluteIndex(layoutLine.logicalLine, 0);
      const rowStartAbs = lineStartAbs + layoutLine.startCol;
      const rowEndAbs = lineStartAbs + layoutLine.endCol;
      const selectedStart = Math.max(selection.startAbs, rowStartAbs);
      const selectedEnd = Math.min(selection.endAbs, rowEndAbs);
      if (selectedEnd <= selectedStart) continue;

      const startVisibleCol = this.computeVisibleColumn(
        layoutLine.text,
        selectedStart - rowStartAbs,
      );
      const endVisibleCol = this.computeVisibleColumn(
        layoutLine.text,
        selectedEnd - rowStartAbs,
      );
      if (
        startVisibleCol === null
        || endVisibleCol === null
        || endVisibleCol <= startVisibleCol
      ) {
        continue;
      }

      const renderedLine = result[renderedContentIndex]!;
      if (!renderedLine.startsWith(leftPadding)) continue;

      const contentStartIndex = leftPadding.length;
      const contentEndIndex = renderedLine.length - (paddingX > 0 ? paddingX : 0);
      const beforePadding = renderedLine.slice(0, contentStartIndex);
      const afterPadding = renderedLine.slice(contentEndIndex);
      const content = renderedLine.slice(contentStartIndex, contentEndIndex);
      const highlighted = this.highlightVisibleRange(
        content,
        startVisibleCol,
        endVisibleCol,
      );
      result[renderedContentIndex] = beforePadding + highlighted + afterPadding;
    }

    return result.map((line) =>
      visibleWidth(line) > width ? truncateToWidth(line, width, "") : line,
    );
  }

  private highlightVisibleRange(content: string, startCol: number, endCol: number): string {
    const selectionBackground = "\x1b[48;5;240m";
    const reset = "\x1b[0m";
    let result = "";
    let visibleCol = 0;
    let index = 0;

    while (index < content.length) {
      if (content[index] === "\x1b") {
        const ansiEnd = this.findAnsiSequenceEnd(content, index);
        if (ansiEnd !== null) {
          result += content.slice(index, ansiEnd);
          index = ansiEnd;
          continue;
        }
      }

      const grapheme = getLineGraphemes(content.slice(index))[0];
      if (!grapheme) {
        result += content.slice(index);
        break;
      }

      const segment = content.slice(index, index + grapheme.end);
      const segmentWidth = visibleWidth(segment);
      const selected = visibleCol < endCol && visibleCol + segmentWidth > startCol;
      result += selected
        ? `${selectionBackground}${segment}${reset}`
        : segment;
      visibleCol += segmentWidth;
      index += segment.length;
    }

    return result;
  }

  private renderFlashOverlays(width: number, baseLines: string[]): string[] {
    if (!this.flashState || this.flashState.matches.length === 0) return baseLines;

    const paddingX = Math.min(
      this.getPaddingX(),
      Math.max(0, Math.floor((width - 1) / 2)),
    );
    const contentWidth = Math.max(1, width - paddingX * 2);
    const layoutWidth = Math.max(1, contentWidth - (paddingX ? 0 : 1));
    const leftPadding = " ".repeat(paddingX);

    const layoutLines = this.buildFlashLayout(layoutWidth);
    if (layoutLines.length === 0) return baseLines;

    const cursor = this.getCursor();
    const cursorLayoutIndex = this.findLayoutLineIndex(layoutLines, cursor);
    if (cursorLayoutIndex === -1) return baseLines;

    const terminalRows = (this as unknown as { tui?: { terminal?: { rows: number } } }).tui?.terminal?.rows ?? 24;
    const maxVisibleLines = Math.max(5, Math.floor(terminalRows * 0.3));
    const scrollOffset = this.getRenderedScrollOffset(
      layoutLines.length,
      maxVisibleLines,
    );

    const contentStart = 1;
    const contentEnd = baseLines.length - 1;
    const result = [...baseLines];

    const LABEL_FG = "\x1b[30m"; // black
    const LABEL_BG = "\x1b[43m"; // yellow bg
    const RESET = "\x1b[0m";

    for (const match of this.flashState.matches) {
      const matchLayoutIndex = layoutLines.findIndex(
        (l) => l.logicalLine === match.line && l.startCol <= match.col && match.col < l.endCol,
      );
      if (matchLayoutIndex === -1) continue;
      if (matchLayoutIndex < scrollOffset || matchLayoutIndex >= scrollOffset + maxVisibleLines) continue;

      const renderedContentIndex = contentStart + (matchLayoutIndex - scrollOffset);
      if (renderedContentIndex >= contentEnd) continue;

      const layoutLine = layoutLines[matchLayoutIndex]!;
      const visibleCol = this.computeVisibleColumn(layoutLine.text, match.col - layoutLine.startCol);
      if (visibleCol === null || visibleCol >= contentWidth) continue;

      const renderedLine = result[renderedContentIndex]!;
      if (!renderedLine.startsWith(leftPadding)) continue;

      const contentStartIndex = leftPadding.length;
      const contentEndIndex = renderedLine.length - (paddingX > 0 ? paddingX : 0);
      const beforePadding = renderedLine.slice(0, contentStartIndex);
      const afterPadding = renderedLine.slice(contentEndIndex);
      let content = renderedLine.slice(contentStartIndex, contentEndIndex);

      const split = this.splitRenderedContentAtVisibleColumn(content, visibleCol);
      if (!split) continue;

      const label = `${LABEL_FG}${LABEL_BG}${match.label}${RESET}`;
      const newContent = split.before + label + split.after;
      const newWidth = visibleWidth(content) - split.atWidth + visibleWidth(match.label);
      const newPadding = Math.max(0, contentWidth - newWidth);
      result[renderedContentIndex] = beforePadding + newContent + " ".repeat(newPadding) + afterPadding;
    }

    return result.map((line) =>
      visibleWidth(line) > width ? truncateToWidth(line, width, "") : line,
    );
  }

  private buildFlashLayout(layoutWidth: number): Array<{
    logicalLine: number;
    startCol: number;
    endCol: number;
    text: string;
  }> {
    const layoutLines: Array<{
      logicalLine: number;
      startCol: number;
      endCol: number;
      text: string;
    }> = [];
    const lines = this.getLines();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (visibleWidth(line) <= layoutWidth) {
        layoutLines.push({ logicalLine: i, startCol: 0, endCol: line.length, text: line });
      } else {
        const chunks = wordWrapLine(line, layoutWidth);
        for (const chunk of chunks) {
          layoutLines.push({
            logicalLine: i,
            startCol: chunk.startIndex,
            endCol: chunk.endIndex,
            text: chunk.text,
          });
        }
      }
    }
    return layoutLines;
  }

  private getRenderedScrollOffset(layoutLineCount: number, maxVisibleLines: number): number {
    const editor = this as unknown as ModalEditorInternals;
    const maxScrollOffset = Math.max(0, layoutLineCount - maxVisibleLines);
    const offset = Number.isInteger(editor.scrollOffset) ? editor.scrollOffset! : 0;
    return Math.max(0, Math.min(offset, maxScrollOffset));
  }

  private findLayoutLineIndex(
    layoutLines: Array<{ logicalLine: number; startCol: number; endCol: number }>,
    cursor: { line: number; col: number },
  ): number {
    for (let index = 0; index < layoutLines.length; index++) {
      const layoutLine = layoutLines[index]!;
      if (layoutLine.logicalLine !== cursor.line) continue;
      const next = layoutLines[index + 1];
      const isLastForLogicalLine = !next || next.logicalLine !== cursor.line;
      if (
        cursor.col >= layoutLine.startCol
        && (cursor.col < layoutLine.endCol || (isLastForLogicalLine && cursor.col === layoutLine.endCol))
      ) {
        return index;
      }
    }
    return -1;
  }

  private computeVisibleColumn(lineText: string, colOffset: number): number | null {
    if (colOffset < 0 || colOffset > lineText.length) return null;
    if (colOffset === 0) return 0;
    let width = 0;
    let byte = 0;
    const graphemes = getLineGraphemes(lineText);
    for (const g of graphemes) {
      if (byte >= colOffset) break;
      width += visibleWidth(lineText.slice(g.start, g.end));
      byte = g.end;
    }
    return width;
  }

  private splitRenderedContentAtVisibleColumn(
    content: string,
    targetCol: number,
  ): { before: string; at: string; after: string; atWidth: number } | null {
    let col = 0;
    let i = 0;
    while (i < content.length && col < targetCol) {
      if (content[i] === "\x1b") {
        const end = this.findAnsiSequenceEnd(content, i);
        if (end === null) break;
        i = end;
        continue;
      }
      const graphemes = getLineGraphemes(content.slice(i));
      const g = graphemes[0];
      if (!g) break;
      const seg = content.slice(i, i + g.end);
      const w = visibleWidth(seg);
      if (col + w > targetCol) break;
      col += w;
      i += seg.length;
    }

    if (i >= content.length) {
      return { before: content, at: "", after: "", atWidth: 0 };
    }

    const graphemes = getLineGraphemes(content.slice(i));
    const g = graphemes[0];
    if (!g) return { before: content, at: "", after: "", atWidth: 0 };
    const seg = content.slice(i, i + g.end);
    return {
      before: content.slice(0, i),
      at: seg,
      after: content.slice(i + seg.length),
      atWidth: visibleWidth(seg),
    };
  }

  private findAnsiSequenceEnd(s: string, start: number): number | null {
    if (s[start] !== "\x1b" || start + 1 >= s.length) return null;

    const kind = s[start + 1];
    if (kind === "[") {
      // CSI: the first byte in the 0x40–0x7e range terminates the sequence.
      for (let i = start + 2; i < s.length; i++) {
        const code = s.charCodeAt(i);
        if (code >= 0x40 && code <= 0x7e) return i + 1;
      }
      return null;
    }

    if (kind === "]" || kind === "_") {
      // OSC and APC (including Pi's hardware-cursor marker) end in BEL or ST.
      for (let i = start + 2; i < s.length; i++) {
        if (s[i] === "\x07") return i + 1;
        if (s[i] === "\x1b" && s[i + 1] === "\\") return i + 2;
      }
    }

    return null;
  }

  private renderGhostOverlay(width: number, baseLines: string[]): string[] {
    const suffix = this.getEligibleGhostSuffix();
    if (!suffix) return baseLines;

    const lineIndex = baseLines.findIndex((line) =>
      line.includes(FAKE_CURSOR_AT_LINE_END)
    );
    if (lineIndex === -1) return baseLines;

    const line = baseLines[lineIndex]!;
    const cursorIndex = line.indexOf(FAKE_CURSOR_AT_LINE_END);
    const cursorEnd = cursorIndex + FAKE_CURSOR_AT_LINE_END.length;
    const throughCursor = line.slice(0, cursorEnd);
    const paddingX = Math.min(
      this.getPaddingX(),
      Math.max(0, Math.floor((width - 1) / 2)),
    );
    const availableWidth = Math.max(
      0,
      width - visibleWidth(throughCursor) - paddingX,
    );
    const visibleSuffix = truncateToWidth(suffix, availableWidth, "");
    if (!visibleSuffix) return baseLines;

    const withGhost = `${throughCursor}${GHOST_STYLE_START}${visibleSuffix}${STYLE_RESET}`;
    const padding = " ".repeat(Math.max(0, width - visibleWidth(withGhost)));
    const result = [...baseLines];
    result[lineIndex] = withGhost + padding;
    return result;
  }

  render(width: number): string[] {
    if (this.locked) return this.renderLocked(width);
    if (width < 4) return super.render(width);

    const innerWidth = width - 2;
    const visualLines = this.renderVisualOverlays(
      innerWidth,
      super.render(innerWidth),
    );
    const flashLines = this.renderFlashOverlays(innerWidth, visualLines);
    const editorLines = this.stripInsertFakeCursor(
      this.renderGhostOverlay(innerWidth, flashLines),
    );
    if (editorLines.length === 0) return editorLines;

    const paddingX = Math.min(
      this.getPaddingX(),
      Math.max(0, Math.floor((innerWidth - 1) / 2)),
    );
    const contentWidth = Math.max(1, innerWidth - paddingX * 2);
    const layoutWidth = Math.max(1, contentWidth - (paddingX ? 0 : 1));
    const layoutLineCount = this.buildFlashLayout(layoutWidth).length;
    const terminalRows = (this as unknown as { tui?: { terminal?: { rows: number } } })
      .tui?.terminal?.rows ?? 24;
    const maxVisibleLines = Math.max(5, Math.floor(terminalRows * 0.3));
    const visibleEditorLines = Math.min(layoutLineCount, maxVisibleLines);
    const bottomBorderIndex = Math.min(
      1 + visibleEditorLines,
      editorLines.length - 1,
    );

    const contentLines = [
      ...editorLines.slice(1, bottomBorderIndex),
      ...editorLines.slice(bottomBorderIndex + 1),
    ];
    const borderColorize = this.getModeColorizer(this.borderColorizers);
    const top = borderColorize(`╭${"─".repeat(innerWidth)}╮`);
    const framedContent = contentLines.map((line) => {
      const safeLine = visibleWidth(line) > innerWidth
        ? truncateToWidth(line, innerWidth, "")
        : line;
      const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(safeLine)));
      return `${borderColorize("│")}${safeLine}${padding}${borderColorize("│")}`;
    });
    const bottom = this.renderBottomBorder(width, borderColorize);

    this.syncCursorShape();
    return [top, ...framedContent, bottom];
  }

  private getModeColorizer(colorizers: ModeColorizers | null): (s: string) => string {
    if (this.isShellInput()) return shellColorize;
    if (!colorizers) return (s: string) => s;
    if (this.mode === "insert") return colorizers.insert;
    if (this.mode === "visual") return colorizers.visual;
    return colorizers.normal;
  }

  private renderBottomBorder(
    width: number,
    borderColorize: (s: string) => string,
  ): string {
    const maxLabelWidth = Math.max(0, width - 6);
    if (maxLabelWidth === 0) {
      return borderColorize(`╰${"─".repeat(Math.max(0, width - 2))}╯`);
    }

    const rawLabel = truncateToWidth(this.getModeLabel(), maxLabelWidth, "…");
    const labelWidth = visibleWidth(rawLabel);
    const connectorWidth = Math.max(1, width - labelWidth - 5);
    const labelColorize = this.getModeColorizer(this.labelColorizers);
    const boldLabel = labelColorize(`\x1b[1m${rawLabel}\x1b[22m`);
    const bottom = `${borderColorize(`╰${"─".repeat(connectorWidth)} `)}${boldLabel}${borderColorize(" ─╯")}`;

    return visibleWidth(bottom) > width
      ? truncateToWidth(bottom, width, "")
      : bottom;
  }

  private getModeLabel(): string {
    if (this.flashState) {
      return `FLASH /${this.flashState.pattern}`;
    }

    if (this.isShellInput()) return "SHELL";
    if (this.mode === "insert") return "INSERT";
    if (this.mode === "visual") {
      const count = `${this.prefixCount}${this.operatorCount}`;
      if (this.pendingTextObject) return `VISUAL ${count}${this.pendingTextObject}_`;
      if (this.pendingMotion) return `VISUAL ${count}${this.pendingMotion}_`;
      if (this.pendingG) return `VISUAL ${count}g_`;
      if (count) return `VISUAL ${count}_`;
      return "VISUAL";
    }

    const prefixCount = this.prefixCount;
    const operatorCount = this.operatorCount;

    if (this.pendingReplace) {
      return prefixCount ? `NORMAL ${prefixCount}r_` : "NORMAL r_";
    }
    if (this.pendingOperator && this.pendingMotion) {
      return `NORMAL ${prefixCount}${this.pendingOperator}${operatorCount}${this.pendingMotion}_`;
    }
    if (this.pendingOperator) {
      return `NORMAL ${prefixCount}${this.pendingOperator}${operatorCount}_`;
    }
    if (this.pendingMotion) return `NORMAL ${this.pendingMotion}_`;
    if (this.pendingG) {
      return this.pendingGCount
        ? `NORMAL g${this.pendingGCount}_`
        : "NORMAL g_";
    }

    const count = `${prefixCount}${operatorCount}`;
    if (count) return `NORMAL ${count}_`;
    return "NORMAL";
  }

  private renderLocked(width: number): string[] {
    const elapsed = this.nowFn() - this.lockStartTime;
    const progress = (elapsed % PILL_TRAVERSAL_MS) / PILL_TRAVERSAL_MS;
    const colorize = this.accentColorizer;

    if (width <= 0) {
      return ["", "", ""];
    }

    if (width === 1) {
      return [colorize("╭"), colorize("│"), colorize("╰")];
    }

    const innerWidth = width - 2;
    const top = colorize(`╭${"─".repeat(innerWidth)}╮`);
    const content = this.renderLockedContentRow(innerWidth, progress, colorize);
    const bottom = this.renderLockedBottomBorder(width, colorize);

    return [top, content, bottom];
  }

  private renderLockedContentRow(
    innerWidth: number,
    progress: number,
    colorize: (s: string) => string,
  ): string {
    const leftBorder = colorize("│");
    const rightBorder = colorize("│");

    if (innerWidth <= 0) {
      return leftBorder + rightBorder;
    }

    if (innerWidth < PILL_WIDTH) {
      let pill = "";
      let pillWidth = 0;
      for (const char of PILL_GLYPHS) {
        const charWidth = visibleWidth(char);
        if (pillWidth + charWidth > innerWidth) break;
        pill += char;
        pillWidth += charWidth;
      }
      const coloredPill = colorize(pill);
      const rightPad = " ".repeat(Math.max(0, innerWidth - pillWidth));
      return leftBorder + coloredPill + rightPad + rightBorder;
    }

    const maxPos = Math.max(0, innerWidth - PILL_WIDTH);
    const pos = Math.round(progress * maxPos);
    const leftPad = " ".repeat(pos);
    const coloredPill = colorize(PILL_GLYPHS);
    const rightWidth = Math.max(0, innerWidth - pos - PILL_WIDTH);
    const rightPad = " ".repeat(rightWidth);

    return leftBorder + leftPad + coloredPill + rightPad + rightBorder;
  }

  private renderLockedBottomBorder(
    width: number,
    colorize: (s: string) => string,
  ): string {
    const label = "STREAMING";
    const maxLabelWidth = Math.max(0, width - 6);
    if (maxLabelWidth === 0) {
      return colorize(`╰${"─".repeat(Math.max(0, width - 2))}╯`);
    }

    const rawLabel = truncateToWidth(label, maxLabelWidth, "…");
    const labelWidth = visibleWidth(rawLabel);
    const connectorWidth = Math.max(1, width - labelWidth - 5);
    const boldLabel = `\x1b[1m${rawLabel}\x1b[22m`;
    const bottom = `${colorize(`╰${"─".repeat(connectorWidth)} `)}${colorize(boldLabel)}${colorize(" ─╯")}`;

    return visibleWidth(bottom) > width
      ? truncateToWidth(bottom, width, "")
      : bottom;
  }
}

interface AssistantTextMatch {
  index: number;
  text: string;
  body: string;
  stripped: string;
}

function findAssistantTextBlockWithQuestions(
  message: { role?: string; content?: unknown },
): AssistantTextMatch | null {
  if (!message || message.role !== "assistant") return null;
  const content = message.content;

  if (typeof content === "string") {
    const text = content;
    const body = extractPiQuestions(text);
    if (!body) return null;
    const stripped = stripPiQuestionsBlock(text);
    if (stripped === null) return null;
    return { index: -1, text, body, stripped };
  }

  if (!Array.isArray(content)) return null;

  for (let i = 0; i < content.length; i++) {
    const block = content[i];
    let text: string | null = null;
    if (typeof block === "string") {
      text = block;
    } else if (
      block
      && typeof block === "object"
      && (block as any).type === "text"
      && typeof (block as any).text === "string"
    ) {
      text = (block as any).text;
    }

    if (text === null) continue;

    const body = extractPiQuestions(text);
    if (!body) continue;

    const stripped = stripPiQuestionsBlock(text);
    if (stripped === null) continue;

    return { index: i, text, body, stripped };
  }

  return null;
}

function replaceAssistantTextBlock(
  message: { role?: string; stopReason?: string; content?: unknown },
  match: AssistantTextMatch,
): any {
  const newMessage = { ...message };
  if (typeof message.content === "string") {
    newMessage.content = match.stripped;
  } else if (Array.isArray(message.content)) {
    newMessage.content = (message.content as any[]).map((block: any, i: number) => {
      if (i !== match.index) return block;
      if (typeof block === "string") return match.stripped;
      return { ...block, text: match.stripped };
    });
  }
  return newMessage;
}

export default function (pi: ExtensionAPI) {
  const historyService = new ZshHistoryService();
  let activeTui: { terminal?: { write: (data: string) => void } } | null = null;
  let activeEditor: ModalEditor | null = null;
  let pendingQuestions: string | null = null;

  pi.on("session_start", (_event, ctx) => {
    // Hide Pi's built-in working loader row so the custom scanner is the
    // only visible working indicator; do this before any setup that could
    // trigger a render flicker on agent start.
    ctx.ui.setWorkingVisible(false);
    historyService.start();
    const appTheme = ctx.ui.theme;
    ctx.ui.setEditorComponent((tui, theme, kb) => {
      activeTui = tui as { terminal?: { write: (data: string) => void } };
      const labelColorizers: ModeColorizers = {
        insert: (s: string) => appTheme.fg("accent", s),
        visual: (s: string) => appTheme.fg("dim", s),
        normal: (s: string) => appTheme.fg("text", s),
      };
      const borderColorizers: ModeColorizers = {
        insert: (s: string) => appTheme.fg("accent", s),
        visual: (s: string) => appTheme.fg("dim", s),
        normal: (s: string) => appTheme.fg("text", s),
      };
      const editor = new ModalEditor(
        tui,
        theme,
        kb,
        labelColorizers,
        borderColorizers,
        historyService,
      );
      activeEditor = editor;
      return editor;
    });
  });

  pi.on("agent_start", () => {
    pendingQuestions = null;
    activeEditor?.lock();
  });

  pi.on("message_end", (event) => {
    const message = event.message as {
      role?: string;
      stopReason?: string;
      content?: unknown;
    };
    if (message.role !== "assistant") return;
    if (message.stopReason !== "stop") return;

    const match = findAssistantTextBlockWithQuestions(message);
    if (!match) return;

    pendingQuestions = match.body;
    return { message: replaceAssistantTextBlock(message, match) };
  });

  pi.on("agent_settled", () => {
    activeEditor?.unlock(pendingQuestions);
    pendingQuestions = null;
  });

  pi.on("user_bash", (event) => {
    historyService.addPiCommand(event.command);
  });

  pi.on("session_shutdown", () => {
    historyService.dispose();
    activeEditor?.unlock();
    activeEditor = null;
    pendingQuestions = null;
    if (activeTui?.terminal?.write) {
      activeTui.terminal.write(CURSOR_SHAPE_DEFAULT);
    }
    activeTui = null;
  });
}

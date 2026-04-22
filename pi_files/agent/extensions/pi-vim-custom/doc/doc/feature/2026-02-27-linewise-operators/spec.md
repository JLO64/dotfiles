# Linewise operators + whole-buffer Vim commands spec

**Date:** 2026-02-27  
**Branch:** `spec/linewise-operators`  
**Status:** Draft

## 1) Problem

Current extension cannot do ergonomic multi-line kill/yank flows:

- `d2j` / `y2j` not supported.
- `3dd` / `3yy` not supported.
- `ggdG` / `ggyG` not possible (`gg`/`G` missing as motions).

Result: users must repeat `dd`/`yy` manually, slow and error-prone.

## 2) Goals

1. Add Vim-style multi-line linewise delete/yank for practical REPL editing.
2. Enable whole-buffer delete/yank with standard sequences.
3. Keep existing non-related motions/operators behavior stable.

## 3) Non-goals

1. No full Vim count system (`3w`, `2fX`, etc.) in this slice.
2. No visual mode, named registers, macros, search, ex commands.
3. No `%d`/`%y` command-line aliases.

## 4) Command surface (new)

### 4.1 Multi-line delete/yank

- `d{count}j` → delete current line through `{count}` lines below (linewise)
- `d{count}k` → delete current line through `{count}` lines above (linewise)
- `y{count}j` → yank current line through `{count}` lines below (linewise)
- `y{count}k` → yank current line through `{count}` lines above (linewise)

Examples:
- `d2j` deletes 3 lines total.
- `y4j` yanks 5 lines total.

### 4.2 Counted doubled operators

- `{count}dd` → delete `{count}` lines (linewise)
- `{count}yy` → yank `{count}` lines (linewise)

Examples:
- `3dd` deletes 3 lines.
- `5yy` yanks 5 lines.

### 4.3 Whole-buffer flows

- `gg` motion: move cursor to line 0, col 0
- `G` motion: move cursor to last line, col 0
- `dG` / `yG`: linewise op from current line to last line

This unlocks:
- `ggdG` → delete whole buffer
- `ggyG` → yank whole buffer

## 5) Semantics

### 5.1 Linewise register contract

For these new linewise ops (`d{count}j/k`, `{count}dd`, `{count}yy`, `dG`, `yG`):

- Register payload is newline-terminated linewise text.
- `p`/`P` must treat payload as linewise (already keyed off trailing `\n`).

### 5.2 Range clamping

- Ranges clamp to buffer bounds.
- `d999j` on short buffers deletes to EOF safely.
- `y999k` from top yanks from BOF to current line.

### 5.3 Cursor behavior

- After linewise delete: cursor lands at col 0 on the first surviving line in the deleted span position (or last remaining line when deleting at EOF).
- After yank: cursor unchanged.

### 5.4 Cancel/error behavior

- Invalid continuation after `d`/`y` still cancels pending operator (existing rule).
- Partial count with no valid completion is discarded on cancel/escape.

## 6) Parsing scope (intentional)

Supported count placements in this slice:

1. After operator before vertical motion: `d2j`, `y3k`
2. Before doubled operator: `3dd`, `4yy`

Not in scope now:
- combined dual counts (`2d3j`)
- global counts for all motions/commands.

## 7) Implementation outline

### 7.1 State additions (`index.ts`)

- `pendingCount: string` (digits accumulator)
- `pendingG: boolean` (for `gg` sequence)

### 7.2 New helpers

- `parseCountOrDefault(...)`
- `clearPendingCount()` (called with `clearPendingState`)
- line helpers:
  - `getLineStartAbs(lineIdx)`
  - `getLineEndAbsInclusiveNewline(lineIdx)`
  - `deleteLineRange(startLine, endLine)`
  - `yankLineRange(startLine, endLine)`

### 7.3 Operator integration

Extend pending operator handlers (`d`/`y`) to accept:

- digit accumulation after operator,
- `j`/`k`/`G` as valid motions with linewise range execution.

### 7.4 Normal mode integration

- `gg` handling (`g` pending then `g`)
- `G` direct motion
- count prefix handling for `{count}dd` / `{count}yy`

### 7.5 Docs

Update `README.md` command tables + “Known differences” section.

## 8) Tests (must add)

In `test/modal-editor.test.ts` add focused scenarios:

1. `d2j` deletes exactly 3 lines; register newline-terminated.
2. `y2j` yanks 3 lines; text unchanged.
3. `{count}dd` / `{count}yy` (`3dd`, `2yy`).
4. `d{large}j` clamps at EOF.
5. `y{large}k` clamps at BOF.
6. `ggdG` deletes full buffer.
7. `ggyG` yanks full buffer and keeps text.
8. `dG` from middle line deletes to EOF.
9. invalid count continuation cancels cleanly.
10. regression: existing `dw/de/db`, `d$`, char motions unchanged.

## 9) Acceptance criteria

1. All existing tests pass.
2. New tests above pass.
3. `ggdG`, `ggyG`, `d2j`, `y2j`, `3dd`, `3yy` work as specified.
4. No regressions in existing operator cancellation behavior.

## 10) Risks

1. Off-by-one around newline-inclusive linewise ranges.
2. Count parser stickiness leaking into unrelated commands.
3. Interaction bugs between `pendingG`, operator state, and escape cancel.

Mitigation: keep parser small, reset state aggressively on cancel/fallback, and cover with explicit regression tests.

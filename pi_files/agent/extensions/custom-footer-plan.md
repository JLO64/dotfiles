# Custom Footer Extension — Planning Document

## Goal

Replace pi's default footer with a personalized, information-dense status bar based on my Claude Code `statusline-command.sh` script.

---

## Current Default Footer (Reference)

The built-in `FooterComponent` renders up to 3 lines:

```
~/Documents/GitHub/dotfiles (main) • session-name
↑11k ↓1.1k R12k $0.042 4.5%/262k (auto)                                                                                    (openrouter) moonshotai/kimi-k2.6 • medium
[extension status texts]
```

**Line 1:** `cwd (git-branch) • session-name`
**Line 2:** Token stats (input/output/cacheRead/cacheWrite/cost/context%) + model info
**Line 3:** Extension status texts from `ctx.ui.setStatus()`

---

## Decisions (Final)

| Question | Decision |
|----------|----------|
| Layout | **Single-line flowing sentence** (left-to-right, like Claude script) |
| Git dirty count + ahead/behind | **Yes** — shell out to `git status` / `git rev-list` |
| Color scheme | **Pi theme tokens** (`accent`, `dim`, `warning`, `error`). *Note: may switch to hardcoded ANSI 256-color codes in the future.* |
| Time display | **Yes** — current time in `3:45pm` format |
| Claude OAuth usage % / countdown | **No** — Claude-specific, not available in pi |
| Session name / auto-compact / extension statuses | **No** — not in the Claude script, not needed here |
| Cache read/write tokens | **No** — omitted for brevity |
| Cost display | **No** — omitted for brevity |
| Provider prefix | **No** — omitted for brevity |
| Thinking level | **No** — omitted for brevity |

---

## Desired Footer Design

### Single-line flowing layout

```
moonshotai/kimi-k2.6 (↑11k ↓1.1k 4.5%) ~/Documents/GitHub/dotfiles on main(3) ↑2↓1 3:45pm
```

**Left to right:**
1. **Model name** — e.g. `moonshotai/kimi-k2.6`
2. **Token stats** — `(↑11k ↓1.1k 4.5%)` in parentheses
3. **Directory** — `~/Documents/GitHub/dotfiles` (with `~` for `$HOME`)
4. **Git info** — `on main(3) ↑2↓1` (branch, dirty count, ahead/behind)
5. **Time** — `3:45pm`

### Color mapping (pi theme tokens)

| Element | Token | Rationale |
|---------|-------|-----------|
| Model name | `accent` | Primary highlight |
| Directory | `accent` + `bold` | Primary highlight, stands out |
| Git branch | `accent` | Primary highlight |
| Connectors (`on`) | `dim` | Subtle, recedes |
| Time | `dim` | Fades into background |
| Context % < 70% | plain | No color needed |
| Context % 70–90% | `warning` | Attention threshold |
| Context % > 90% | `error` | Urgent threshold |

---

## Data Sources

| Data | Source | Notes |
|------|--------|-------|
| `cwd` | `ctx.sessionManager.getCwd()` | Replace `$HOME` with `~` |
| `git branch` | `footerData.getGitBranch()` | Reactive via `onBranchChange()` |
| `git dirty count` | `git status --porcelain \| wc -l` | Cached, refreshed every 3s |
| `git ahead/behind` | `git rev-list --count` | Cached, refreshed every 3s |
| `input tokens` | Sum `usage.input` from assistant messages | Cumulative across session |
| `output tokens` | Sum `usage.output` from assistant messages | Cumulative across session |
| `context %` | `ctx.getContextUsage()?.percent` | Color-coded at 70%/90% thresholds |
| `model id` | `ctx.model?.id` | |
| `time` | `new Date().toLocaleTimeString()` | Updates every minute |

---

## Technical Approach

### Extension Structure

Single-file extension:

```
~/.pi/agent/extensions/
└── custom-footer.ts          # Entry point
```

Backed up in this repo at:

```
pi_files/agent/extensions/
├── custom-footer.ts          # The extension
└── custom-footer-plan.md     # This document
```

### Key Implementation Details

#### 1. Hook into `session_start`

```typescript
pi.on("session_start", async (_event, ctx) => {
  ctx.ui.setFooter((tui, theme, footerData) => {
    // ...
  });
});
```

#### 2. Git status caching

Git status is computed via `execSync` and cached in a closure variable. Refreshed every 3 seconds via `setInterval`, plus immediately on `footerData.onBranchChange()`.

```typescript
let cachedGit: GitInfo | null = getGitInfo(cwd);
const gitTimer = setInterval(() => { cachedGit = getGitInfo(cwd); }, 3000);
```

#### 3. Clock refresh

Time updates every minute via `setInterval` calling `tui.requestRender()`.

```typescript
const clockTimer = setInterval(() => tui.requestRender(), 60000);
```

#### 4. Context usage with color thresholds

```typescript
const contextPercent = ctx.getContextUsage()?.percent ?? 0;
let contextStr: string;
if (contextPercent > 90) {
  contextStr = theme.fg("error", `${contextPercent.toFixed(1)}%`);
} else if (contextPercent > 70) {
  contextStr = theme.fg("warning", `${contextPercent.toFixed(1)}%`);
} else {
  contextStr = `${contextPercent.toFixed(1)}%`;
}
```

#### 5. Width-safe rendering

Single line truncated to terminal width:

```typescript
const line = modelPart + stats + " " + dirPart + gitPart + timePart;
return [truncateToWidth(line, width)];
```

#### 6. Cleanup on dispose

```typescript
return {
  dispose() {
    clearInterval(gitTimer);
    clearInterval(clockTimer);
    branchUnsub();
  },
  invalidate() {},
  render(width) { /* ... */ },
};
```

---

## Files

| File | Purpose |
|------|---------|
| `~/.pi/agent/extensions/custom-footer.ts` | The live extension (symlinked or copied from repo) |
| `pi_files/agent/extensions/custom-footer.ts` | Backup in this repo |
| `pi_files/agent/extensions/custom-footer-plan.md` | This planning document |

---

## Testing Workflow

1. Symlink or copy `custom-footer.ts` to `~/.pi/agent/extensions/`
2. In pi, run `/reload` to hot-load the extension
3. Verify footer renders correctly at various terminal widths
4. Test git branch changes (switch branches, see reactive update)
5. Test context threshold colors (send large prompts to push context %)
6. Verify clock updates every minute
7. Iterate on layout/colors based on real usage

---

## Future Enhancements

- **Hardcoded ANSI colors** — swap theme tokens for 256-color escape sequences (e.g. orange `208`, yellow `226`)
- **Command to toggle footer** — `/footer` to switch between custom and default
- **Per-project footer configs** — different layouts for different project types
- **Custom widgets above editor** — pair with `ctx.ui.setWidget()` for todo lists, git status, etc.

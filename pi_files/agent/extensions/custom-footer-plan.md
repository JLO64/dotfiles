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
| Time display | **Yes** — current time in `4:05pm` format |
| Claude OAuth usage % / countdown | **No** — Claude-specific, not available in pi |
| Session name / auto-compact / extension statuses | **No** — not in the Claude script, not needed here |
| Cache read/write tokens | **No** — omitted for brevity |
| Cost display | **Yes** — cumulative cost from `usage.cost.total` |
| Provider prefix | **No** — omitted for brevity |
| Thinking level | **No** — omitted for brevity |
| Username / "via" connector | **No** — replaced with hostname in directory |
| Nerd font icons | **Planned** — `\|` used as placeholder, to be replaced manually with actual icons |

---

## Desired Footer Design

### Single-line flowing layout

```
|moonshotai/kimi-k2.6 (↑1.6M ↓46k 22.3%) in |~/Documents/GitHub/dotfiles (HOSTNAME) on main ↑3 at |4:21pm
```

**Left to right:**
1. **Model icon + name** — e.g. `|moonshotai/kimi-k2.6`
2. **Token stats + cost** — `(↑1.6M ↓46k 22.3% $0.042)` in parentheses
3. **Connector** — `in`
4. **Directory icon + path + hostname** — `|~/Documents/GitHub/dotfiles (HOSTNAME)`
5. **Git info** — `on main ↑3` (branch, dirty count, ahead/behind)
6. **Connector** — `at`
7. **Time icon + time** — `|4:21pm`

### Color mapping (pi theme tokens)

| Element | Token | Rationale |
|---------|-------|-----------|
| `\|` icon placeholders | `accent` | Stand out as visual markers |
| Model name | `accent` | Primary highlight |
| Directory | `accent` + `bold` | Primary highlight, stands out |
| Hostname `(HOSTNAME)` | `dim` | Secondary info, recedes |
| Git branch | `accent` | Primary highlight |
| Connectors (`in`, `at`, `on`) | `dim` | Subtle, recedes |
| Time | `accent` | Visible but not urgent |
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
| `cost` | Sum `usage.cost.total` from assistant messages, with OpenRouter real-cost fallback | See "OpenRouter cost fetching" below |
| `context %` | `ctx.getContextUsage()?.percent` | Color-coded at 70%/90% thresholds |
| `model id` | `ctx.model?.id` | |
| `hostname` | `execSync("hostname -s")` | Short hostname, fallback to `"unknown"` |
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

#### 4. Hostname lookup

```typescript
let hostname = "unknown";
try {
  hostname = execSync("hostname -s", { encoding: "utf-8", timeout: 1000 }).trim();
} catch {
  hostname = "unknown";
}
```

#### 5. Context usage with color thresholds

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

#### 6. Icon placeholders

All nerd font icons are represented by `|` (pipe character) wrapped in `accent` color. These must be manually replaced with actual nerd font icons after deployment.

```typescript
const icon = theme.fg("accent", "|");
const modelPart = icon + theme.fg("accent", modelName);
const dirPart = icon + theme.fg("accent", theme.bold(displayCwd)) + theme.fg("dim", ` (${hostname})`);
const timePart = icon + theme.fg("accent", timeStr);
```

#### 7. Width-safe rendering

Single line truncated to terminal width:

```typescript
const line =
  modelPart +
  stats +
  theme.fg("dim", " in ") +
  dirPart +
  gitPart +
  theme.fg("dim", " at ") +
  timePart;
return [truncateToWidth(line, width)];
```

#### 8. OpenRouter cost fetching (async fallback)

**Problem:** pi-ai computes cost client-side from a static model registry (`models.generated.ts`). For some OpenRouter models (e.g. `moonshotai/kimi-k2.6`), the registry has zeroed or missing costs, so `usage.cost.total` is always `0`.

**Solution:** After each assistant turn, query OpenRouter's `/api/v1/generation?id={responseId}` endpoint to fetch the actual cost charged to the account.

**Architecture:**

```typescript
// Module-level cache: responseId -> real cost
const openRouterCosts = new Map<string, number>();

// On turn_end, fire an async fetch (with delay + retries) and cache the result
pi.on("turn_end", async (event, ctx) => {
  const msg = event.message;
  if (msg.role !== "assistant") return;
  const am = msg as AssistantMessage;
  if (!am.responseId) return;
  if (am.provider !== "openrouter") return;
  if (openRouterCosts.has(am.responseId)) return;

  const apiKey = await ctx.modelRegistry.getApiKeyForProvider("openrouter");
  if (!apiKey) return;

  const fetchCost = async (attempt: number): Promise<void> => {
    try {
      const res = await fetch(
        `https://openrouter.ai/api/v1/generation?id=${am.responseId}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      if (!res.ok) {
        if (res.status === 404 && attempt < 3) {
          setTimeout(() => fetchCost(attempt + 1), attempt * 2000);
        }
        return;
      }
      const json = await res.json();
      const cost = json.data?.total_cost;
      if (typeof cost === "number") {
        openRouterCosts.set(am.responseId, cost);
        footerRequestRender?.(); // trigger footer redraw
      }
    } catch {
      // Silently ignore fetch failures so they don't block the agent loop.
    }
  };
  setTimeout(() => fetchCost(1), 2000);
});
```

**Footer render integration:**

```typescript
for (const entry of ctx.sessionManager.getBranch()) {
  if (entry.type === "message" && entry.message.role === "assistant") {
    const m = entry.message as AssistantMessage;
    totalInput += m.usage.input;
    totalOutput += m.usage.output;
    // Prefer fetched real cost, fall back to pi-ai's client-side estimate
    const realCost = m.responseId ? openRouterCosts.get(m.responseId) : undefined;
    totalCost += realCost ?? m.usage.cost?.total ?? 0;
  }
}
```

**Key details:**
- `responseId` is preserved by pi-ai's `openai-completions` provider (`output.responseId ||= chunk.id`), so every assistant message carries the OpenRouter completion ID.
- A **2000ms initial delay** is required because the generation record isn't immediately available after the stream ends. A single 800ms attempt was observed to consistently 404.
- **Up to 3 retries** with exponential backoff (2s, 4s, 6s) on 404 errors, because the record can take several seconds to propagate on OpenRouter's side.
- The cache is **cleared on `session_start`** to avoid leaking costs across sessions.
- For non-OpenRouter providers, the code falls back to `usage.cost.total` (the existing behavior).
- The fetch is **fire-and-forget** — failures are silently ignored so they don't block the agent loop.

#### 9. Cleanup on dispose

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
7. Verify hostname displays correctly
8. Iterate on layout/colors based on real usage

---

## Future Enhancements

- **Nerd font icons** — replace all `|` placeholders with actual icons (must be done manually)
- **Hardcoded ANSI colors** — swap theme tokens for 256-color escape sequences (e.g. orange `208`, yellow `226`)
- **Command to toggle footer** — `/footer` to switch between custom and default
- **Per-project footer configs** — different layouts for different project types
- **Custom widgets above editor** — pair with `ctx.ui.setWidget()` for todo lists, git status, etc.

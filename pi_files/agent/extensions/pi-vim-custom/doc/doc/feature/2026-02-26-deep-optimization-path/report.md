# Deep Optimization Path — Batch 3 Report (T6/T7)

Date: 2026-02-26

## Final verdict against acceptance thresholds

All thresholds passed.

| Gate | Threshold | Result | Status |
|---|---:|---:|---|
| `w` on 400-word single line | >= 3x faster | 3839.0083 -> 0.8802 us/op (**4361.35x**) | PASS |
| `b` on 400-word single line | >= 3x faster | 5116.6937 -> 0.9094 us/op (**5626.35x**) | PASS |
| Non-word regression (`h`) | <= 10% slower | 2086.4644 -> 2060.5659 us/op (**-1.24%**) | PASS |
| Non-word regression (ignored printable) | <= 10% slower | 0.1772 -> 0.1910 us/op (**+7.79%**) | PASS |
| Startup incremental median | <= +10 ms | 4.1976 ms | PASS |
| Heap incremental | <= +2 MB | 156,336 bytes (~0.15 MB) | PASS |
| Tests | all pass | 131 passed, 0 failed | PASS |

Baseline source: `benchmark-baseline.json`
Final source: `benchmark-final.json`

## T6 roadblock loop (five attempts)

Attempt metrics and decisions are recorded in `benchmark-attempts.json`.

1. **Reduce regex overhead in char classification**
   - Result: hotspot regressed (`w`/`b` slower than baseline), `h` worsened.
   - Decision: **rejected**.
2. **Reduce repeated line/cursor fetches in hot paths**
   - Result: only marginal gain; safety trade-off (weaker guard verification) not worth it.
   - Decision: **rejected**.
3. **Batch/optimize cursor movement command emission**
   - Result: orders-of-magnitude `w`/`b` improvement with non-word regressions within budget.
   - Decision: **selected**.
4. **Rework boundary-table search strategy (array index vs binary search)**
   - Result: slightly mixed `w`/`b`; `dw` and memory regressed vs selected attempt 3 baseline.
   - Decision: **rejected**.
5. **Tune cache invalidation granularity**
   - Result: `dw` regressed and startup incremental breached +10 ms in attempt run.
   - Decision: **rejected**.

## Kept trade-off

Kept only attempt #3:

- `index.ts`: guarded line-local cursor movement fast path (`tryMoveCursorByState`) in `moveCursorBy`, with canonical key-emission fallback when guards fail.

Why kept:
- Dominant hotspot reduction.
- No semantic test regressions.
- Acceptance thresholds remain satisfied.

## Rejected trade-offs

- Attempt #1: added complexity + regressions under this harness run.
- Attempt #2: small/noisy gain, weaker safety checks.
- Attempt #4: alternate boundary search strategy worsened mixed-path profile.
- Attempt #5: invalidation tuning increased overhead in measured paths.

## Remaining risks

- Fast path writes through internal editor state shape (`state.cursorCol`, `preferredVisualCol`). If upstream editor internals change, fallback path still exists but this optimization could degrade/disable.
- Perf variance remains high for sub-microsecond paths; medians were used consistently to reduce noise.
- E2E interactive latency was deferred per batch scope; only harness-level microbench + test suite verified here.

---
description: Research docs and local code, then use diff-proposer to draft a non-applied patch
argument-hint: "<change request>"
---
Use the subagent tool in two phases for this request:

$@

Phase 1: Run `docs-researcher` and `codebase-researcher` in parallel with the `tasks` parameter. Ask `docs-researcher` to find relevant external documentation and ask `codebase-researcher` to inspect the local implementation.

Phase 2: After both results return, run `diff-proposer` with the original request plus the Phase 1 findings. The diff-proposer must propose changes only and must not edit or write files.

Return a concise synthesis plus the proposed diffs and source/file references.

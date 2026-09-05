# Subagent Resources

The subagent extension launches each agent in a separate pi process. Agent profiles can control which tools, extensions, and skills that child process receives. This keeps specialized resources out of unrelated agent contexts; it is not a filesystem security boundary.

## Agent profile fields

Agent profiles are Markdown files under `~/.pi/agent/agents/` or a project's `.pi/agents/` directory.

```yaml
---
name: example
description: Example specialized agent
tools: read, example_tool
extensions: ../restricted-extensions/example.ts
skills: ../restricted-skills/example/SKILL.md
isolate-extensions: true
isolate-skills: true
model: provider/model
context-token-limit: 90000
---
```

- `tools`: comma-separated pi tool allowlist passed as `--tools`.
- `extensions`: comma-separated extension file or directory paths loaded with `-e`.
- `skills`: comma-separated skill file or directory paths loaded with `--skill`.
- `isolate-extensions`: when `true`, passes `--no-extensions` before explicitly loading `extensions`.
- `isolate-skills`: when `true`, passes `--no-skills` before explicitly loading `skills`.
- `context-token-limit`: optional positive finite integer soft limit for the child's current context occupancy. It defaults to `120000` when neither the profile nor invocation supplies a limit.

## Git operator model override

Set `PI_GIT_OPERATOR_MODEL` to override the configured model only for the agent named exactly `git-operator`. Empty or whitespace-only values are ignored, and all other agents retain their profile model. For example: `PI_GIT_OPERATOR_MODEL=openai/gpt-5.6-luna`.

If an isolation field is omitted or `false`, normal pi discovery remains enabled and declared resources are additive. Setting isolation to `true` with no corresponding resources creates a child with none of that resource type. The subagent context limiter is always explicitly loaded, including for isolated extension profiles.

## Context limits

Pass `contextTokenLimit` (a positive finite integer) on a single invocation, or on each parallel task / chain step. The precedence is invocation item, selected profile's `context-token-limit`, then `120000`.

```json
{"agent":"example","task":"Inspect the renderer","contextTokenLimit":90000}
```

```json
{"tasks":[{"agent":"example","task":"Review A","contextTokenLimit":60000},{"agent":"example","task":"Review B"}]}
```

The child checks `ctx.getContextUsage().tokens` before each model request. At 50%, 75%, and 90% it receives one ephemeral warning with its percentage consumed. At 100% or higher it receives one final instruction to wrap up immediately and start no new work. If a request crosses multiple thresholds, only the strongest warning is injected. These messages are request-local context-event injections: they do not persist in the child session or interrupt tool execution.

Each warning that actually fires is also shown chronologically in that child's expanded Output section (including each expanded parallel or chain child), with warning styling at 50/75% and error styling at 90/100%. Warnings are omitted from collapsed rows and aggregate summaries. The child sends these diagnostics over stderr using a versioned JSON marker; valid marker lines are removed from displayed stderr, while ordinary, malformed, and partial stderr remains available for failure diagnostics. Because stdout and stderr are separate pipes, ordering is best-effort at the parent receive boundary.

Child-specific footers show current context as `26.0k/120k`, colored by context pressure (normal through 50%, warning above 50%, error above 80%). This is a current-context reading, not cumulative token billing, and is not capped at 100%. Parallel and chain aggregate summaries intentionally continue to show their existing summed context without `/limit`.

The parent receives context usage from completed child JSON `message_end` usage records, so live updates can lag until a child completes a model response; it does not claim a separate exact live reading.

## Path resolution

Relative extension and skill paths resolve from the directory containing the agent profile, not from the child process working directory.

For example, this project profile:

```text
project/.pi/agents/serve-docker-runner.md
```

can load:

```yaml
skills: ../restricted-skills/serve-docker/SKILL.md
```

which resolves to:

```text
project/.pi/restricted-skills/serve-docker/SKILL.md
```

Absolute paths are supported and remain absolute. All configured resources must exist when the agent is invoked; otherwise the subagent returns an error containing the missing resolved path.

## Restricted resource locations

`restricted-extensions` and `restricted-skills` are organizational conventions. Pi does not auto-discover these directory names.

Recommended global layout:

```text
~/.pi/agent/
├── agents/
│   └── online-researcher.md
└── restricted-extensions/
    └── web-search.ts
```

Recommended project layout:

```text
project/.pi/
├── agents/
│   └── serve-docker-runner.md
└── restricted-skills/
    └── serve-docker/
        ├── SKILL.md
        └── playwright.md
```

Do not add a restricted directory to pi's global or project skill/extension settings. Doing so makes its contents auto-discoverable again.

## Examples

A web-only researcher:

```yaml
extensions: ../restricted-extensions/web-search.ts
isolate-extensions: true
isolate-skills: true
tools: web_search, web_fetch, read
```

Pi receives arguments equivalent to:

```text
--tools web_search,web_fetch,read --no-extensions -e <web-search-path> --no-skills
```

A project Docker runner:

```yaml
skills: ../restricted-skills/serve-docker/SKILL.md
isolate-extensions: true
isolate-skills: true
tools: read, grep, find, ls, bash
```

Pi receives arguments equivalent to:

```text
--tools read,grep,find,ls,bash --no-extensions --no-skills --skill <serve-docker-path>
```

## Adding a restricted resource

1. Place the extension or skill outside pi's auto-discovered `extensions/` or `skills/` directories.
2. Add its relative or absolute path to the intended agent profile.
3. Enable the applicable isolation field when the child should not inherit other resources.
4. Keep every tool required by the resource in the profile's `tools` allowlist.
5. Invoke the agent from a fresh parent pi process after changing extension code or resource locations.
6. Verify the main process does not advertise the resource and the intended child can load it.

## Tests

Run the subagent tests with:

```bash
bun test pi_files/agent/extensions/subagent/test
```

The tests cover frontmatter parsing, relative and absolute paths, isolation arguments, backward compatibility, and missing-resource errors.

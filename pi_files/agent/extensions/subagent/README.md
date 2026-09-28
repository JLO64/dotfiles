# Subagent Resources

The subagent extension launches each agent in a separate pi process. Agent profiles can control which tools, extensions, and skills that child process receives. This keeps specialized resources out of unrelated agent contexts; it is not a filesystem security boundary.

## Persistent private sessions and Continue

Every subagent invocation creates a persistent session in `~/.pi/agent/subagent-sessions/sessions/`, outside Pi's normal project session directories and default `/resume` listings. The tool returns a random opaque **Session handle** in progress and final text (each parallel task has its own handle). Handles and session files are private to the current OS user. If the parent agent is interrupted before it returns a tool result, recover the handle from `owner.json` filenames in that directory; the handle is the UUID-named parent directory.

Continue an existing subagent with the same session handle and a new prompt:

```json
{"continueHandle":"<session handle>","task":"Continue the investigation and report the remaining issue."}
```

Continue reuses the original working directory, agent profile, and context-token limit. A missing or changed profile is rejected rather than silently switching identity. Session histories are not replayed as new prompts, so previous tool calls are not automatically rerun. If a process is interrupted during a tool operation, inspect the persisted conversation and workspace before continuing because the operation's completion may be uncertain. All runs, including initial single/parallel runs, and Continue requests are serialized with a private per-session lock. Sessions found active after an interrupted parent are marked uncertain, and the next prompt receives an explicit warning to inspect effects before proceeding. Before Continue, the extension scans the persisted session transcript for tool calls without results; if any are found (or the transcript cannot be read), it refuses to prompt rather than attempting an unsafe replay or synthesizing a result. This does not repair the transcript: inspect its tool effects manually before deciding how to proceed.

## Agent profile fields

Public agent profiles are Markdown files under `~/.pi/agent/agents/` or a project's `.pi/agents/` directory. Restricted agent profiles use the parallel `restricted-agents/` directory described below.

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

Pass `contextTokenLimit` (a positive finite integer) on a single invocation or on each parallel task. The precedence is invocation item, selected profile's `context-token-limit`, then `120000`.

```json
{"agent":"example","task":"Inspect the renderer","contextTokenLimit":90000}
```

```json
{"tasks":[{"agent":"example","task":"Review A","contextTokenLimit":60000},{"agent":"example","task":"Review B"}]}
```

The child checks `ctx.getContextUsage().tokens` before each model request. At 50%, 75%, and 90% it receives one ephemeral warning with its percentage consumed. At 100% or higher it receives one final instruction to wrap up immediately and start no new work. If a request crosses multiple thresholds, only the strongest warning is injected. These messages are request-local context-event injections: they do not persist in the child session or interrupt tool execution.

Each warning that actually fires is also shown chronologically in that child's expanded Output section (including each expanded parallel child), with warning styling at 50/75% and error styling at 90/100%. Warnings are omitted from collapsed rows and aggregate summaries. The child sends these diagnostics over stderr using a versioned JSON marker; valid marker lines are removed from displayed stderr, while ordinary, malformed, and partial stderr remains available for failure diagnostics. Because stdout and stderr are separate pipes, ordering is best-effort at the parent receive boundary.

Child-specific footers show current context as `26.0k/120k`, colored by context pressure (normal through 50%, warning above 50%, error above 80%). This is a current-context reading, not cumulative token billing, and is not capped at 100%. Parallel aggregate summaries intentionally continue to show summed context without `/limit`.

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

## Restricted agents

Restricted agents are profiles that remain absent from normal agent discovery and model-facing agent lists. Store them as:

```text
~/.pi/agent/restricted-agents/<name>.md
project/.pi/restricted-agents/<name>.md
```

The filename must exactly match the profile's `name` frontmatter. Restricted names must contain only letters, numbers, `.`, `_`, and `-`, and must begin with a letter or number.

The subagent tool resolves a restricted profile only when invoked with its exact name. It does not scan or enumerate restricted profiles to the model. The normal `agentScope` rules apply: `"user"` checks only the global directory, `"project"` checks only the nearest project directory, and `"both"` prefers the project profile within the restricted category. Public profiles are resolved first, so any public profile takes precedence over any restricted profile with the same name, regardless of source.

Pi-vim includes restricted agents in its user-facing `#` autocomplete. Selecting one inserts only `#<name>` into the editor; it does not inject the profile or automatically invoke the subagent. The user must tell the main agent to use that exact name.

Restricted-agent handling limits model discovery; it is not a filesystem security boundary. A process with suitable filesystem tools and permissions may still inspect the profile files.

## Restricted resource locations

`restricted-extensions` and `restricted-skills` are organizational conventions. Pi does not auto-discover these directory names.

Recommended global layout:

```text
~/.pi/agent/
├── agents/
│   └── public-researcher.md
├── restricted-agents/
│   └── online-researcher.md
└── restricted-extensions/
    └── web-search.ts
```

Recommended project layout:

```text
project/.pi/
├── restricted-agents/
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

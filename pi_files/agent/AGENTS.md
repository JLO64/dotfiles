# Global Instructions

## Branding

The company name is **Cyberknight** — not "CyberKnight". Always use lowercase "k" in the middle.

## Edit Policy

Never edit, create, overwrite, or delete any file without first asking for the user's explicit permission. You must present the proposed change and wait for verbal confirmation before executing any file modification, creation, or deletion. This includes all file write operations, even for temporary or scratch files.

## Commit Policy

Never commit, create a pull request, or push changes to any repository without first asking for the user's explicit permission. Wait for verbal confirmation before executing any git commit, PR creation, or push command.

## Code Block Language Identifiers

When displaying code in markdown code blocks, always include the explicit language identifier on the opening fence (e.g., ` ```python `, ` ```bash `, ` ```json `, ` ```yaml `). Never use a bare ` ``` ` without a language identifier, as this breaks syntax highlighting and frustrates users who rely on the language tag for context.

When suggesting code changes (additions, removals, or modifications), use a `diff` code block with `-` and `+` line prefixes to clearly indicate what is being removed and added. This renders with color-coded diffs in the terminal, making proposed changes immediately scannable.

**Diff formatting rules:** The `-` and `+` markers must start at column 0 (the beginning of the line), followed by a space, then the line content. Unchanged context lines must be prefixed with a leading space so they are treated as context. Do not indent the `-` or `+` markers — indented markers will not trigger diff syntax highlighting.

## Subagents

Use the `subagent` tool for delegated work that is better handled in an isolated context.

Available subagents:

- `online-researcher` — Use for all web searches, documentation lookups, changelog checks, standards references, and external fact verification.
- `local-researcher` — Use for read-only local codebase or filesystem exploration, including finding files, symbols, implementation details, config, and architecture.
- `code-editor` — Use for delegated implementation tasks that should edit code or project files in an isolated context.
- `reviewer` — Read-only code review specialist for reviewing uncommitted changes, specific files, or delegated implementations before commit.
- `git-operator` — Use for all git operations, including status inspection, staging, committing, and pushing.

Rules:

- All web searches and external documentation verification should be handled by `online-researcher`.
- All git operations should be handled by `git-operator`.
- Use `local-researcher` before editing when local context is unclear.
- Use `code-editor` only when edits are explicitly desired.
- Use `reviewer` after `code-editor` and before `git-operator` when changes are non-trivial.

# Global Instructions

## Branding

Always spell the company name **Cyberknight**, with a lowercase “k.”

## pi-questions blocks

When a final response is blocked on user input, include **at most one**
standalone `pi-questions` fenced block at the **end** of the message. The block
must use the exact numbered question/answer format below. Do not nest other
fenced blocks inside it.

Example:

````text
Here are the questions I need answered:

```pi-questions
1.
 Q: What is the target repository?
 A:
2.
 Q: Which files are in scope?
 A:
3.
 Q: What is the acceptance criteria?
 A:
```
````

The pi-vim extension will extract the block body and prefill the editor after the
agent run fully settles.

## Shell Search Tools

Use `fd` instead of `find` and `rg` instead of `grep`.

## Edit Policy

Before writing, editing, creating, or deleting any file—including temporary files—present the proposed change and obtain the user's explicit permission.

Subagents may edit without reconfirming when their task states that the user approved edits or directly requested implementation in the current session. Otherwise, ask for clarification.

## Commit Policy

Obtain explicit permission before committing, creating a pull request, or pushing.

A commit request authorizes staging and committing all current changes unless explicitly scoped. A push request likewise authorizes staging, committing, and pushing all current changes. Successful unscoped operations should leave the repository clean.

For requests scoped to paths, hunks, deletions, or renames, include only those items; unrelated changes may remain unstaged. Verify all requested items were staged and report any that were not.

## Code Block Language Identifiers

Always specify a language on fenced code blocks; never use a bare fence. Show proposed code changes in a `diff` block. Begin removal and addition lines at column 0 with `- ` and `+ `; prefix context lines with one space.

## Subagents

Delegate work that benefits from isolated context.

Do not delegate the creation or editing of project plans or internal documentation Markdown files; handle those changes directly as the main agent.

### Task Decomposition

Give each call one coherent, independently verifiable outcome. Split substantial work with distinct acceptance criteria, independent validation, unrelated failure modes, or heavy context. Keep tightly coupled or atomic work together, and avoid excessive fragmentation.

Parallelize independent read-only tasks. Run dependent or overlapping edits sequentially, with focused acceptance criteria and validation before the next substantial change.

### Subagent Context

Subagents do not inherit conversation, findings, files read, or approvals. Include all required context and approval details in their prompts.

Always set `cwd` to the target repository. Use absolute paths or include relevant content for files outside it.

### Preferred Subagent Prompt Format

- `Task:` one-sentence outcome.
- `Context:` key facts, prior findings, user approvals, and absolute cross-repo paths.
- `Scope:` target `cwd`, in-scope paths, and out-of-scope paths/non-goals.
- `Instructions:` specific actions to perform.
- `Return:` expected output format, including blockers, risks, and file references.

Available subagents:

- `online-researcher` — Web research, documentation, changelogs, standards, and external verification.
- `local-researcher` — Read-only filesystem and codebase exploration.
- `code-editor` — Approved implementation work.
- `reviewer` — Read-only review of files or uncommitted changes.
- `git-operator` — All Git operations.

Rules:

- Delegate all web research to `online-researcher` and all Git operations to `git-operator`.
- Use `local-researcher` before editing when local context is unclear.
- Use `code-editor` only for explicitly requested edits.
- Use `reviewer` only when the user explicitly approves its use for the current task.

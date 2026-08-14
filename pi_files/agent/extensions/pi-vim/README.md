# pi-vim

`pi-vim` adds Vim-style modal editing to Pi's prompt editor.

## Agent and skill references

In insert mode, type `#` to fuzzy-search installed subagents or `$` to
fuzzy-search available skills. Select a result with Pi's normal autocomplete
controls (for example, Tab); pi-vim inserts only the corresponding plain-text
reference, such as `#local-researcher` or `$html-visualization`. Picker rows
show names only.

These references do not load a skill or dispatch a subagent. They remain part
of your prompt for the main agent to interpret, so they can be used naturally:

```text
Dispatch a #local-researcher agent to inspect the editor using the $html-visualization skill.
```

The `#` picker reads user agents from `~/.pi/agent/agents/` and project agents
from the nearest `.pi/agents/` directory; project definitions override user
ones with the same name. The `$` picker uses Pi's resolved active skill
commands, including skills supplied through project settings, packages, and
extensions. Existing `@` file references and slash-command completion are
unchanged.

## Shell input and history suggestions

Input whose first character is `!` uses shell mode. The editor border and status
label change to `SHELL`; `!!` keeps Pi's existing behavior of excluding the
command and result from model context.

In insert mode, a single-line shell command can show a dim inline suggestion
from Zsh history when the cursor is at the end of the line. Press Tab to accept
the suggestion. If no suggestion is eligible, Tab does nothing. Shift+Tab
cycles Pi's thinking level through the global `app.thinking.cycle` binding in
[`../../keybindings.json`](../../keybindings.json); when a Pi autocomplete picker
is active, Tab accepts its selected item instead.

History is resolved from `ZSH_HISTORY_FILE`, then `HISTFILE`, then
`~/.zsh_history`. The extension keeps history only in local memory, filters
secret-like and unsafe entries, and also remembers commands run through Pi's
`!` and `!!` paths for the current Pi session. It never writes Pi commands back
to the Zsh history file.

Zsh does not necessarily update its history file until an interactive shell
exits. With the current dotfiles configuration, commands entered in an already
running external Zsh may therefore be unavailable to Pi until that shell exits.
A separate, optional Zsh configuration change can make new commands available
incrementally:

```zsh
setopt INC_APPEND_HISTORY
```

This extension does not change `.zshrc` automatically.

## Working scanner and input lock

While the agent is running, the editor is locked and displayed as a framed
streaming state. The locked output is three rows: a top border, a single inner
content row containing the accent-colored pill scanner `████████`, and a bottom
border. The frame and pill are tinted in the streaming truecolor `#ea9a97`
(RGB 234,154,151), and the bottom-right border label reads `STREAMING`. The pill
travels one-way left-to-right across the inner content width over 2.4 seconds,
then restarts at the left. Because the scanner replaces Pi's built-in working
indicator, pi-vim hides the built-in `⠇ Working...` row while the extension is
active.

- All typing, Vim commands, submission, steering, and follow-up input is
  swallowed while the streaming frame is visible.
- The `app.tools.expand` action (default **Ctrl+O**) is forwarded to allow
  expanding tool output while the agent is working; the actual key is resolved
  through the active keybindings, not hard-coded.
- Press **Esc** to abort the running agent, consistent with Pi's existing
  interrupt behavior.
- When the agent fully settles, the lock is released and the underlying editor
  state is preserved. If the final assistant message contains a valid
  `pi-questions` fenced block with three or more questions, its body is prefilled
  into the editor.

## Prefilling questions with `pi-questions`

When the final assistant message is blocked on three or more questions, include
exactly one `pi-questions` fenced block at the **end** of the message. For one or
two questions, ask them in normal prose. The block must use this exact numbered
Q/A shape:

````text
```pi-questions
1. Q: What is the target repository?
   A:
2. Q: Which files are in scope?
   A:
3. Q: What is the acceptance criteria?
   A:
```
````

pi-vim will extract the block body and place it into the editor after the run
settles, ready for the user to edit and submit. The `pi-questions` block is
visible while the response is streaming, but it is removed from the finalized
assistant message so only the prose response remains.

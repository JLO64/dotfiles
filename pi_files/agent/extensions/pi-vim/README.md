# pi-vim

`pi-vim` adds Vim-style modal editing to Pi's prompt editor.

## Shell input and history suggestions

Input whose first character is `!` uses shell mode. The editor border and status
label change to `SHELL`; `!!` keeps Pi's existing behavior of excluding the
command and result from model context.

In insert mode, a single-line shell command can show a dim inline suggestion
from Zsh history when the cursor is at the end of the line. Press Tab to accept
the suggestion. If no suggestion is eligible, Tab is passed unchanged to Pi's
normal path/autocomplete handling.

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

While the agent is running, the editor is locked and shows a bouncing
Knight-Rider-style scanner bar, a concise working message, and an abort hint.
The scanner and border use the same accent color as pi-vim insert mode.

- All typing, Vim commands, submission, steering, and follow-up input is
  swallowed while the scanner is visible.
- Press **Esc** to abort the running agent, consistent with Pi's existing
  interrupt behavior.
- When the agent fully settles, the lock is released. If the final assistant
  message contains a valid `pi-questions` fenced block, its body is prefilled
  into the editor unconditionally.

## Prefilling questions with `pi-questions`

When the final assistant message is blocked on user input, include exactly one
`pi-questions` fenced block at the **end** of the message. The block must use
this exact numbered Q/A shape:

````text
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

pi-vim will extract the block body and place it into the editor after the run
settles, ready for the user to edit and submit.

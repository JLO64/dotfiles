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

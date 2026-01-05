# dotfiles

## Terminal Start Test

To test the startup time of the terminal, run the following command:

```bash
for i in $(seq 1 10); do /usr/bin/time $SHELL -i -c exit; done ;
```

### Dependencies

## Ghostty

Be sure to download/install `JetBrains Mono` from [nerdfonts.com](https://www.nerdfonts.com/font-downloads)

## .zshrc

- For `git_make_commit_message` you'll need to install `llm` and it's LM Studio plugin via `llm install llm-lmstudio`
- For `check_git_fetch` you'll need to install `bc`

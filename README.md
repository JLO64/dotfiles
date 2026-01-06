# dotfiles

## Terminal Start Test

To test the startup time of the terminal, run the following command:

```bash
for i in $(seq 1 10); do /usr/bin/time $SHELL -i -c exit; done ;
```

## Dependencies

### Ghostty

Be sure to download/install `JetBrains Mono` from [nerdfonts.com](https://www.nerdfonts.com/font-downloads)

### .zshrc

- For `git_make_commit_message` you'll need to install `llm` and it's LM Studio plugin via `llm install llm-lmstudio`
- For `check_git_fetch` you'll need to install `bc`

## Claude Status Line
To test the status line run the following command:
```bash
echo '{
    "hook_event_name": "Status",
    "session_id": "f7d9e2a1-4b3c-8d6f-9e2a-1c5b7d8f3e4a",
    "transcript_path": "/Users/64julianlopez/.claude/transcripts/2026-01-05-session.json",
    "cwd": "/Users/64julianlopez/Documents/GitHub/dotfiles/claude",
    "model": {
      "id": "claude-sonnet-4-5-20250929",
      "display_name": "Sonnet 4.5"
    },
    "workspace": {
      "current_dir": "/Users/64julianlopez/Documents/GitHub/dotfiles/claude",
      "project_dir": "/Users/64julianlopez/Documents/GitHub/dotfiles"
    },
    "cost": {
      "total_cost_usd": 0.02156,
      "total_duration_ms": 67500,
      "total_api_duration_ms": 3450,
      "total_lines_added": 234,
      "total_lines_removed": 45
    },
    "context_window": {
      "total_input_tokens": 21489,
      "total_output_tokens": 6823,
      "context_window_size": 200000,
      "current_usage": {
        "input_tokens": 12300,
        "output_tokens": 2150,
        "cache_creation_input_tokens": 8000,
        "cache_read_input_tokens": 3500
      }
    }
  }' | ./statusline-command.sh;
```

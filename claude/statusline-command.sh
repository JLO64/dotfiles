#!/bin/zsh

# This script generates the status line for Claude Code
# Input: JSON with workspace info (piped via stdin)
# Output: A single line of text that will be displayed in the status bar

# Read the JSON input from Claude Code
##input=$(cat)

# Extract the current working directory from the JSON
# You can also access: .workspace.name, .workspace.git_branch, etc.
##cwd=$(echo "$input" | jq -r '.workspace.current_dir')

# Get the directory name (last part of the path)
dir_name=$(basename "$cwd")

# Build and output the status line
# Tip: Use nerd font icons for a better look (https://www.nerdfonts.com/cheat-sheet)
# printf " %s%s" "$dir_name" "$git_branch"

claude_code_prompt="╭─\033[38;5;40m${OS_NAME} $(whoami)\033[0m \033[38;5;239min\033[0m \033[1m\033[38;5;226m${PWD/#$HOME/~}\033[0m\033[22m \033[38;5;239mat\033[0m 󰥔$(date +%H:%M:%S)"

echo "$claude_code_prompt"

# Examples of what you can add:
# - Current time: $(date +%H:%M:%S)
# - Username: $(whoami)
# - Git status: changed files count, ahead/behind indicators
# - Virtual environment: $CONDA_DEFAULT_ENV or basename of $VIRTUAL_ENV
# - Custom icons and colors (Claude Code supports ANSI color codes)

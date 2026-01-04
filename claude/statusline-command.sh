#!/bin/bash

# This script generates the status line for Claude Code
# Input: JSON with workspace info (piped via stdin)
# Output: A single line of text that will be displayed in the status bar

# Read the JSON input from Claude Code
input=$(cat)

# Extract the current working directory from the JSON
# You can also access: .workspace.name, .workspace.git_branch, etc.
cwd=$(echo "$input" | jq -r '.workspace.current_dir')

# Get the directory name (last part of the path)
dir_name=$(basename "$cwd")

# Get git branch if in a git repository
git_branch=""
if git -C "$cwd" rev-parse --git-dir &>/dev/null 2>&1; then
    git_branch=$(git -C "$cwd" branch 2>/dev/null | grep '^*' | cut -d' ' -f2-)
    if [[ -n $git_branch ]]; then
        git_branch=" on  $git_branch"
    fi
fi

# Build and output the status line
# Tip: Use nerd font icons for a better look (https://www.nerdfonts.com/cheat-sheet)
printf " %s%s" "$dir_name" "$git_branch"

# Examples of what you can add:
# - Current time: $(date +%H:%M:%S)
# - Username: $(whoami)
# - Git status: changed files count, ahead/behind indicators
# - Virtual environment: $CONDA_DEFAULT_ENV or basename of $VIRTUAL_ENV
# - Custom icons and colors (Claude Code supports ANSI color codes)

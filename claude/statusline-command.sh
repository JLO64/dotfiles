#!/bin/zsh

# Read the JSON input from Claude Code
# input=$(cat)

# Extract the current working directory from the JSON
# You can also access: .workspace.name, .workspace.git_branch, etc.
# cwd=$(echo "$input" | jq -r '.workspace.current_dir')

function claude_git_branch_info {
  local branch=$(git branch 2>/dev/null | grep '^*' | cut -d' ' -f2-)
  if [[ -n $branch ]]; then
    local changed_files=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

    # Calculate ahead/behind (fails silently if no upstream)
    local ahead=$(git rev-list --count @{upstream}..HEAD 2>/dev/null)
    local behind=$(git rev-list --count HEAD..@{upstream} 2>/dev/null)

    # Build tracking indicator
    local tracking_info=""
    if [[ -n $ahead ]] && [[ -n $behind ]]; then
      [[ $ahead -gt 0 ]] && tracking_info+="↑${ahead}"
      [[ $behind -gt 0 ]] && tracking_info+="↓${behind}"
    fi

    if [[ $changed_files -eq 0 ]]; then
      echo "\033[38;5;239mon\033[0m \033[1m\033[38;5;208m󰊢 $branch${tracking_info:+ $tracking_info}\033[0m" # orange for clean with git icon
    else
      echo "\033[38;5;239mon\033[0m \033[1m\033[38;5;208m󰊢 $branch($changed_files)${tracking_info:+ $tracking_info}\033[0m" # orange for dirty with count and git icon
    fi
  fi
}

dir_name=$(basename "$cwd")
# claude_code_prompt="\033[38;5;208m Claude\033[0m in \033[1m\033[38;5;226m ${PWD/#$HOME/~}\033[0m\033[22m \033[38;5;239m$(claude_git_branch_info) at\033[0m 󰥔$(date +%H:%M:%S)"
claude_code_prompt="\033[38;5;208m Claude\033[0m in \033[1m\033[38;5;226m ${PWD/#$HOME/~}\033[0m\033[22m \033[38;5;239m$(claude_git_branch_info) at\033[0m 󰥔 $(date +"%I:%M%p")
"

echo "$claude_code_prompt"

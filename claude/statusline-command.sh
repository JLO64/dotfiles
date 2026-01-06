#!/bin/zsh

# Read the JSON input from Claude Code
input=$(cat)

# Extract the current working directory from the JSON
# You can also access: .workspace.name, .workspace.git_branch, etc.
# cwd=$(echo "$input" | jq -r '.workspace.current_dir')

get_model_name() { echo "$input" | jq -r '.model.display_name'; }
MODEL=$(get_model_name)
CONTEXT_SIZE=$(echo "$input" | jq -r '.context_window.context_window_size')
USAGE=$(echo "$input" | jq '.context_window.current_usage')

if [ "$USAGE" != "null" ]; then
    # Calculate current context from current_usage fields
    CURRENT_TOKENS=$(echo "$USAGE" | jq '.input_tokens + .cache_creation_input_tokens + .cache_read_input_tokens')
    PERCENT_USED=$((CURRENT_TOKENS * 100 / CONTEXT_SIZE))
else
    PERCENT_USED=$(echo "0")
fi

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
      echo "\033[38;5;239mon\033[0m \033[1m\033[38;5;202m󰊢 $branch${tracking_info:+ $tracking_info}\033[0m" # orange for clean with git icon
    else
      echo "\033[38;5;239mon\033[0m \033[1m\033[38;5;202m󰊢 $branch($changed_files)${tracking_info:+ $tracking_info}\033[0m" # orange for dirty with count and git icon
    fi
  fi
}

dir_name=$(basename "$cwd")
claude_code_prompt="\033[38;5;208m $MODEL (${PERCENT_USED}%)\033[0m \033[38;5;239min\033[0m \033[1m\033[38;5;226m ${PWD/#$HOME/~}\033[0m\033[22m \033[38;5;239m$(claude_git_branch_info) \033[38;5;239mat\033[0m \033[0m󰥔 $(date +"%I:%M%p")
"

echo "$claude_code_prompt"

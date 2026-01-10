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

function get_claude_five_hour_usage {
  # Retrieve access token from macOS Keychain
  local token=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null | jq -r '.claudeAiOauth.accessToken' 2>/dev/null)

  if [[ -z "$token" || "$token" == "null" ]]; then
    echo "0"
    return
  fi

  # Query the Claude usage API
  local response=$(curl -s -H "Authorization: Bearer $token" \
    -H "Accept: application/json" \
    -H "Content-Type: application/json" \
    -H "anthropic-beta: oauth-2025-04-20" \
    "https://api.anthropic.com/api/oauth/usage" 2>/dev/null)

  # Extract five_hour utilization percentage and convert to integer
  local utilization=$(echo "$response" | jq -r '.five_hour.utilization // 0' 2>/dev/null)

  printf "%.0f" "$utilization"
}


function claude_time_remaining {
    # Get access token from macOS Keychain
    local credentials=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null)

    if [ -z "$credentials" ]; then
        echo "Error: Not logged in to Claude Code"
        return 1
    fi

    # Extract access token from JSON
    local access_token=$(echo "$credentials" | jq -r '.claudeAiOauth.accessToken' 2>/dev/null)

    if [ -z "$access_token" ] || [ "$access_token" = "null" ]; then
        echo "Error: Could not extract access token"
        return 1
    fi

    # Call Anthropic API
    local response=$(curl -s -H "Accept: application/json" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $access_token" \
        -H "anthropic-beta: oauth-2025-04-20" \
        "https://api.anthropic.com/api/oauth/usage")

    # Extract resets_at timestamp
    local resets_at=$(echo "$response" | jq -r '.five_hour.resets_at' 2>/dev/null)

    if [ -z "$resets_at" ] || [ "$resets_at" = "null" ]; then
        echo "Error: Could not get reset time from API"
        return 1
    fi

    # Convert ISO8601 timestamp to epoch time
    # Remove fractional seconds and timezone for parsing
    local clean_timestamp=$(echo "$resets_at" | sed -E 's/\.[0-9]+\+00:00$/Z/' | sed -E 's/\+00:00$/Z/')

    # Parse as UTC using -u flag
    local reset_epoch=$(date -ju -f "%Y-%m-%dT%H:%M:%SZ" "$clean_timestamp" "+%s" 2>/dev/null)

    if [ -z "$reset_epoch" ]; then
        echo "Error: Could not parse reset time"
        return 1
    fi

    # Get current time
    local now_epoch=$(date "+%s")

    # Calculate difference in seconds
    local diff=$((reset_epoch - now_epoch))

    if [ $diff -le 0 ]; then
        echo "soon"
        return 0
    fi

    # Convert to hours and minutes
    local hours=$((diff / 3600))
    local minutes=$(((diff % 3600) / 60))

    # Format output
    if [ $hours -gt 0 ]; then
        echo "${hours}h${minutes}m"
    else
        echo "${minutes}m"
    fi
}


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
claude_code_prompt="\033[38;5;208m$MODEL (󰧑 ${PERCENT_USED}%,  $(get_claude_five_hour_usage)%)\033[0m \033[38;5;239min\033[0m \033[1m\033[38;5;226m ${PWD/#$HOME/~}\033[0m\033[22m \033[38;5;239m$(claude_git_branch_info) \033[38;5;239mat\033[0m \033[0m󰥔 $(date +"%I:%M%p") ($(claude_time_remaining))
"

echo "$claude_code_prompt"

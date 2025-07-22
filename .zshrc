# Add this to the TOP of your .zshrc to enable profiling
# zmodload zsh/zprof

# delete this file to clear the zsh cache for speed up
# rm .zcompdump

DISABLE_AUTO_UPDATE="true"
DISABLE_MAGIC_FUNCTIONS="true"
DISABLE_COMPFIX="true"


# my custom zsh theme, based off of bira and fino-time

function virtualenv_info {
    [ $CONDA_DEFAULT_ENV ] && echo "($CONDA_DEFAULT_ENV) "
    [ $VIRTUAL_ENV ] && echo '('`basename $VIRTUAL_ENV`') '
}


ZSH_THEME_GIT_PROMPT_PREFIX=" %F{239}on%f %F{255}"
ZSH_THEME_GIT_PROMPT_SUFFIX="%f"
ZSH_THEME_GIT_PROMPT_DIRTY="%F{202}✘✘✘"
ZSH_THEME_GIT_PROMPT_CLEAN="%F{40}✔"
function git_branch_info {
    local branch=$(git branch 2>/dev/null | grep '^*' | cut -d' ' -f2-)
    if [[ -n $branch ]]; then
        local changed_files=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
        if [[ $changed_files -eq 0 ]]; then
            echo " %F{239}on%f %B%F{202}󰊢 $branch%f%b"  # orange for clean with git icon
        else
            echo " %F{239}on%f %B%F{202}󰊢 $branch($changed_files)%f%b"  # orange for dirty with count and git icon
        fi
    fi
}
ZSH_THEME_RUBY_PROMPT_PREFIX=" %F{239}using%F{243} ‹"
ZSH_THEME_RUBY_PROMPT_SUFFIX="›%f"

PROMPT="╭─%F{40} %n%f %F{239}within%f %F{33}󰌢 %m%f %F{239}in%f %B%F{226} %~%f%b\$(git_branch_info)\$(ruby_prompt_info) %F{239}at%f 󰥔%t 
╰─\$(virtualenv_info)○ "


# If you come from bash you might have to change your $PATH.
# export PATH=$HOME/bin:$HOME/.local/bin:/usr/local/bin:$PATH

# Path to your Oh My Zsh installation.
export ZSH="$HOME/.oh-my-zsh"

# Set name of the theme to load --- if set to "random", it will
# load a random theme each time Oh My Zsh is loaded, in which case,
# to know which specific one was loaded, run: echo $RANDOM_THEME
# See https://github.com/ohmyzsh/ohmyzsh/wiki/Themes
# ZSH_THEME="robbyrussell"
# ZSH_THEME="bira"
# ZSH_THEME="fino-time"

# Set list of themes to pick from when loading at random
# Setting this variable when ZSH_THEME=random will cause zsh to load
# a theme from this variable instead of looking in $ZSH/themes/
# If set to an empty array, this variable will have no effect.
# ZSH_THEME_RANDOM_CANDIDATES=( "robbyrussell" "agnoster" )

# Uncomment the following line to use case-sensitive completion.
# CASE_SENSITIVE="true"

# Uncomment the following line to use hyphen-insensitive completion.
# Case-sensitive completion must be off. _ and - will be interchangeable.
# HYPHEN_INSENSITIVE="true"

# Uncomment one of the following lines to change the auto-update behavior
# zstyle ':omz:update' mode disabled  # disable automatic updates
# zstyle ':omz:update' mode auto      # update automatically without asking
# zstyle ':omz:update' mode reminder  # just remind me to update when it's time

# Uncomment the following line to change how often to auto-update (in days).
# zstyle ':omz:update' frequency 13

# Uncomment the following line if pasting URLs and other text is messed up.
# DISABLE_MAGIC_FUNCTIONS="true"

# Uncomment the following line to disable colors in ls.
# DISABLE_LS_COLORS="true"

# Uncomment the following line to disable auto-setting terminal title.
# DISABLE_AUTO_TITLE="true"

# Uncomment the following line to enable command auto-correction.
# ENABLE_CORRECTION="true"

# Uncomment the following line to display red dots whilst waiting for completion.
# You can also set it to another string to have that shown instead of the default red dots.
# e.g. COMPLETION_WAITING_DOTS="%F{yellow}waiting...%f"
# Caution: this setting can cause issues with multiline prompts in zsh < 5.7.1 (see #5765)
# COMPLETION_WAITING_DOTS="true"

# Uncomment the following line if you want to disable marking untracked files
# under VCS as dirty. This makes repository status check for large repositories
# much, much faster.
# DISABLE_UNTRACKED_FILES_DIRTY="true"

# Uncomment the following line if you want to change the command execution time
# stamp shown in the history command output.
# You can set one of the optional three formats:
# "mm/dd/yyyy"|"dd.mm.yyyy"|"yyyy-mm-dd"
# or set a custom format using the strftime function format specifications,
# see 'man strftime' for details.
# HIST_STAMPS="mm/dd/yyyy"

# Would you like to use another custom folder than $ZSH/custom?
# ZSH_CUSTOM=/path/to/new-custom-folder

# Which plugins would you like to load?
# Standard plugins can be found in $ZSH/plugins/
# Custom plugins may be added to $ZSH_CUSTOM/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
# Add wisely, as too many plugins slow down shell startup.
plugins=(git)
plugins+=(zsh-vi-mode)

zstyle ':autocomplete:*complete*:*' insert-unambiguous yes 
zstyle ':autocomplete:*history*:*' insert-unambiguous yes
zstyle ':autocomplete:menu-search:*' insert-unambiguous yes
zstyle ':completion:*:*' matcher-list 'm:{[:lower:]-}={[:upper:]_}' '+r:|[.]=**'
# bindkey -M menuselect              '^I' insert-unambiguous-or-complete
# bindkey -M menuselect "$terminfo[kcbt]" insert-unambiguous-or-complete
bindkey              '^I'         menu-complete
bindkey "$terminfo[kcbt]" reverse-menu-complete

source $HOMEBREW_PREFIX/share/zsh-autocomplete/zsh-autocomplete.plugin.zsh

zstyle ':completion:*' completer _complete _complete:-fuzzy _correct _approximate _ignored _expand

source $ZSH/oh-my-zsh.sh

# User configuration

# export MANPATH="/usr/local/man:$MANPATH"

# You may need to manually set your language environment
# export LANG=en_US.UTF-8

# Preferred editor for local and remote sessions
# if [[ -n $SSH_CONNECTION ]]; then
#   export EDITOR='vim'
# else
#   export EDITOR='nvim'
# fi

# Compilation flags
# export ARCHFLAGS="-arch $(uname -m)"

# Set personal aliases, overriding those provided by Oh My Zsh libs,
# plugins, and themes. Aliases can be placed here, though Oh My Zsh
# users are encouraged to define aliases within a top-level file in
# the $ZSH_CUSTOM folder, with .zsh extension. Examples:
# - $ZSH_CUSTOM/aliases.zsh
# - $ZSH_CUSTOM/macos.zsh
# For a full list of active aliases, run `alias`.
#
# Example aliases
# alias zshconfig="mate ~/.zshrc"
# alias ohmyzsh="mate ~/.oh-my-zsh"

# Old nvm setup
# export NVM_DIR="$HOME/.nvm"
# [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
# [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion
# source $(brew --prefix nvm)/nvm.sh

# New nvm setup
export NVM_DIR="$HOME/.nvm"
alias nvm='unalias nvm; [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"; nvm $@'

# Old pyenv setup
# export PYENV_ROOT="$HOME/.pyenv"
# export PATH="$PYENV_ROOT/bin:$PATH"
# eval "$(pyenv init -)"

# New pyenv setup
export PYENV_ROOT="$HOME/.pyenv"
export PATH="$PYENV_ROOT/bin:$PATH"
alias pyenv='eval "$(pyenv init -)"; pyenv $@'

# old chruby setup
# source /opt/homebrew/opt/chruby/share/chruby/chruby.sh
# source /opt/homebrew/opt/chruby/share/chruby/auto.sh
# chruby ruby-3.1.3

# new chruby setup
alias chruby='source /opt/homebrew/opt/chruby/share/chruby/chruby.sh; chruby $@'

# The following lines have been added by Docker Desktop to enable Docker CLI completions.
fpath=(/Users/64julianlopez/.docker/completions $fpath)
# autoload -Uz compinit
# compinit
# End of Docker CLI completions

# Load environment variables
[ -f ~/.env ] && source ~/.env

export EDITOR=nvim


# uncomment following line for profiling
# zprof

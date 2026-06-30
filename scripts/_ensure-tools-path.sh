#!/usr/bin/env bash
# _ensure-tools-path.sh - Bash version of _ensure-tools-path.mjs.
#
# Adds common CLI install dirs (Node.js, npm global, pnpm setup target,
# GitHub CLI, Homebrew, etc.) to PATH for the current shell session.
#
# Doesn't require `node` to run - so it works even when Claude Code was
# launched BEFORE the user installed Node.js via /start (typical case
# without a Claude Desktop restart).
#
# USAGE:
#   source "${CLAUDE_SKILL_DIR}/../../scripts/_ensure-tools-path.sh"
#   node "$SCRIPTS/bootstrap-init.mjs" ...   # now finds node, pnpm, gh, vercel
#
# Idempotent: only prepends dirs that exist AND aren't already in PATH.

_path_prepend_if_missing() {
  local dir="$1"
  [[ -z "$dir" ]] && return
  [[ ! -d "$dir" ]] && return
  # Check if already in PATH (with leading/trailing colons as anchors)
  case ":$PATH:" in
    *":$dir:"*) return ;;
  esac
  export PATH="$dir:$PATH"
}

# Convert a Windows path like "C:\Users\foo\bar" to Git Bash form "/c/Users/foo/bar".
_win_to_unix_path() {
  local p="$1"
  # Replace backslashes with forward slashes
  p="${p//\\//}"
  # Replace drive letter prefix (e.g., "C:") with "/c"
  if [[ "$p" =~ ^([A-Za-z]):(.*)$ ]]; then
    local drive="${BASH_REMATCH[1]}"
    local rest="${BASH_REMATCH[2]}"
    # Lowercase drive letter
    drive="$(echo "$drive" | tr '[:upper:]' '[:lower:]')"
    p="/$drive$rest"
  fi
  echo "$p"
}

# Detect OS
case "$(uname -s 2>/dev/null)" in
  Darwin)
    _path_prepend_if_missing "/opt/homebrew/bin"
    _path_prepend_if_missing "/usr/local/bin"
    _path_prepend_if_missing "$HOME/Library/pnpm"
    _path_prepend_if_missing "$HOME/.cargo/bin"
    ;;
  Linux)
    _path_prepend_if_missing "/usr/local/bin"
    _path_prepend_if_missing "/usr/bin"
    _path_prepend_if_missing "$HOME/.local/bin"
    _path_prepend_if_missing "$HOME/.local/share/pnpm"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    # Windows Git Bash
    _path_prepend_if_missing "/c/Program Files/nodejs"
    _path_prepend_if_missing "/c/Program Files/Git/cmd"
    _path_prepend_if_missing "/c/Program Files/GitHub CLI"
    # Windows env vars (APPDATA, LOCALAPPDATA) are inherited from Windows
    # in Git Bash with native (Windows) path format. Convert to Unix form.
    if [[ -n "$APPDATA" ]]; then
      _path_prepend_if_missing "$(_win_to_unix_path "$APPDATA")/npm"
    fi
    if [[ -n "$LOCALAPPDATA" ]]; then
      _path_prepend_if_missing "$(_win_to_unix_path "$LOCALAPPDATA")/pnpm"
    fi
    ;;
  *)
    # Unknown OS - try a few generic dirs anyway
    _path_prepend_if_missing "/usr/local/bin"
    _path_prepend_if_missing "/usr/bin"
    ;;
esac

# Clean up internal helpers from the caller's environment
unset -f _path_prepend_if_missing _win_to_unix_path 2>/dev/null || true

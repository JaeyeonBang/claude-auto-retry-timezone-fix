#!/usr/bin/env bash
# Apply local fixes to an installed claude-auto-retry.
# Safe to run multiple times — detects if the patches are already applied.
#
# Patches included:
#   1. Day-boundary timezone bug fix (time-parser.js)
#   2. Pre-action Enter to dismiss Claude's "wait/upgrade/restart" prompt
#      (config.js + tmux.js + monitor.js)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_FILE="$SCRIPT_DIR/fix.patch"

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm not found in PATH" >&2
  exit 1
fi

NPM_PREFIX="$(npm prefix -g)"
PKG_DIR="$NPM_PREFIX/lib/node_modules/claude-auto-retry"
TIME_PARSER="$PKG_DIR/src/time-parser.js"
CONFIG="$PKG_DIR/src/config.js"

if [ ! -d "$PKG_DIR" ]; then
  echo "ERROR: claude-auto-retry not installed at $PKG_DIR" >&2
  echo "Install first: npm i -g claude-auto-retry" >&2
  exit 1
fi

# Idempotency check: are both patches already applied?
HAS_TIMEZONE_FIX=0
HAS_PRE_ACTION_FIX=0
grep -q "Normalize to the nearest occurrence at or after" "$TIME_PARSER" && HAS_TIMEZONE_FIX=1
grep -q "preActionEnterDelaySeconds" "$CONFIG" && HAS_PRE_ACTION_FIX=1

if [ "$HAS_TIMEZONE_FIX" = "1" ] && [ "$HAS_PRE_ACTION_FIX" = "1" ]; then
  echo "All patches already applied to $PKG_DIR"
  exit 0
fi

if [ "$HAS_TIMEZONE_FIX" = "1" ] || [ "$HAS_PRE_ACTION_FIX" = "1" ]; then
  echo "ERROR: partial patch state detected. Reinstall claude-auto-retry first:" >&2
  echo "  npm i -g claude-auto-retry" >&2
  echo "Then re-run this script." >&2
  exit 1
fi

# Dry-run check
if ! patch --dry-run -p1 -d "$PKG_DIR" < "$PATCH_FILE" >/dev/null 2>&1; then
  echo "ERROR: patch does not apply cleanly. Upstream may have changed." >&2
  echo "Check version: $(node -p "require('$PKG_DIR/package.json').version" 2>/dev/null || echo unknown)" >&2
  exit 1
fi

# Apply
patch -p1 -d "$PKG_DIR" < "$PATCH_FILE"
echo "Patches applied to $PKG_DIR"

# Run tests if node + tmux available
if command -v node >/dev/null 2>&1; then
  echo ""
  echo "Running tests..."
  node "$SCRIPT_DIR/test-time-parser.mjs" 2>&1 | tail -3
  node "$SCRIPT_DIR/test-pre-action-enter.mjs" 2>&1 | tail -3
fi

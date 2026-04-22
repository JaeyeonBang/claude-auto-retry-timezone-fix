#!/usr/bin/env bash
# Apply the timezone day-boundary fix to an installed claude-auto-retry.
# Safe to run multiple times — detects if the patch is already applied.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_FILE="$SCRIPT_DIR/time-parser-fix.patch"

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm not found in PATH" >&2
  exit 1
fi

NPM_PREFIX="$(npm prefix -g)"
TARGET="$NPM_PREFIX/lib/node_modules/claude-auto-retry/src/time-parser.js"

if [ ! -f "$TARGET" ]; then
  echo "ERROR: claude-auto-retry not installed at $TARGET" >&2
  echo "Install first: npm i -g claude-auto-retry" >&2
  exit 1
fi

# Idempotency check: is the patch already applied?
if grep -q "Normalize to the nearest occurrence at or after" "$TARGET"; then
  echo "Patch already applied to $TARGET"
  exit 0
fi

# Dry-run check first
if ! patch --dry-run -p1 -d "$NPM_PREFIX/lib/node_modules/claude-auto-retry" < "$PATCH_FILE" >/dev/null 2>&1; then
  echo "ERROR: patch does not apply cleanly to $TARGET" >&2
  echo "The upstream file may have changed. Check manually." >&2
  exit 1
fi

# Apply
patch -p1 -d "$NPM_PREFIX/lib/node_modules/claude-auto-retry" < "$PATCH_FILE"
echo "Patch applied to $TARGET"

# Run tests if node is available
if command -v node >/dev/null 2>&1; then
  echo ""
  echo "Running tests..."
  node "$SCRIPT_DIR/test-time-parser.mjs" 2>&1 | tail -3
fi

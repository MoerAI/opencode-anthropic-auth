#!/bin/bash
# MoerAI/opencode-anthropic-auth installer
# Patches opencode's built-in anthropic auth to fix 429 token exchange errors

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CACHE_TARGET="$HOME/.cache/opencode/node_modules/opencode-anthropic-auth/index.mjs"
BUNDLE="$SCRIPT_DIR/index.mjs"

if [ ! -f "$BUNDLE" ]; then
  echo "ERROR: index.mjs not found in $SCRIPT_DIR"
  echo "Run: cd $SCRIPT_DIR && bun install && bun run script/bundle.ts && cp dist-bundle/index.js index.mjs"
  exit 1
fi

# Patch cache
mkdir -p "$(dirname "$CACHE_TARGET")"
cp -f "$BUNDLE" "$CACHE_TARGET"
echo "✓ Patched $CACHE_TARGET"

# Add auto-patch to zshrc if not already present
SHELL_RC="$HOME/.zshrc"
[ -f "$HOME/.bashrc" ] && [ ! -f "$HOME/.zshrc" ] && SHELL_RC="$HOME/.bashrc"

MARKER="# auto-patch anthropic auth"
if ! grep -q "$MARKER" "$SHELL_RC" 2>/dev/null; then
  cat >> "$SHELL_RC" << 'PATCH'

# auto-patch anthropic auth on every shell start
if [ -f "$HOME/.config/opencode/opencode-anthropic-auth/index.mjs" ]; then
  cp -f "$HOME/.config/opencode/opencode-anthropic-auth/index.mjs" \
    "$HOME/.cache/opencode/node_modules/opencode-anthropic-auth/index.mjs" 2>/dev/null
fi
PATCH
  echo "✓ Added auto-patch to $SHELL_RC"
else
  echo "✓ Auto-patch already in $SHELL_RC"
fi

echo ""
echo "Done! Run: opencode auth login → Anthropic → Claude Pro/Max"

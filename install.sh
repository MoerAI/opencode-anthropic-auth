#!/bin/bash
# MoerAI/opencode-anthropic-auth installer
# Patches opencode's built-in anthropic auth to fix 429 token exchange errors
# Supports: macOS, Ubuntu/Linux

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUNDLE="$SCRIPT_DIR/index.mjs"

# Detect OS
OS="$(uname -s)"
case "$OS" in
  Darwin) PLATFORM="macOS" ;;
  Linux)  PLATFORM="Linux" ;;
  *)      echo "ERROR: Unsupported OS: $OS (use install.ps1 for Windows)"; exit 1 ;;
esac

echo "Installing MoerAI/opencode-anthropic-auth for $PLATFORM..."

# Verify bundle exists
if [ ! -f "$BUNDLE" ]; then
  echo "ERROR: index.mjs not found in $SCRIPT_DIR"
  echo "Run: cd $SCRIPT_DIR && bun install && bun run script/bundle.ts && cp dist-bundle/index.js index.mjs"
  exit 1
fi

# Determine cache path
# macOS: ~/.cache/opencode/node_modules/...
# Linux: ~/.cache/opencode/node_modules/... (same XDG default)
CACHE_DIR="$HOME/.cache/opencode/node_modules/opencode-anthropic-auth"
if [ -n "$XDG_CACHE_HOME" ]; then
  CACHE_DIR="$XDG_CACHE_HOME/opencode/node_modules/opencode-anthropic-auth"
fi
CACHE_TARGET="$CACHE_DIR/index.mjs"

# Patch cache
mkdir -p "$CACHE_DIR"
cp -f "$BUNDLE" "$CACHE_TARGET"
echo "  [OK] Patched $CACHE_TARGET"

# Determine shell rc file
SHELL_RC=""
if [ -f "$HOME/.zshrc" ]; then
  SHELL_RC="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then
  SHELL_RC="$HOME/.bashrc"
elif [ "$PLATFORM" = "Linux" ]; then
  # Ubuntu defaults to bash
  SHELL_RC="$HOME/.bashrc"
  touch "$SHELL_RC"
else
  SHELL_RC="$HOME/.zshrc"
  touch "$SHELL_RC"
fi

# Add auto-patch to shell rc
MARKER="# auto-patch anthropic auth"
if ! grep -q "$MARKER" "$SHELL_RC" 2>/dev/null; then
  cat >> "$SHELL_RC" << 'PATCH'

# auto-patch anthropic auth on every shell start
_OC_AUTH_SRC="$HOME/.config/opencode/opencode-anthropic-auth/index.mjs"
_OC_AUTH_DST="${XDG_CACHE_HOME:-$HOME/.cache}/opencode/node_modules/opencode-anthropic-auth/index.mjs"
if [ -f "$_OC_AUTH_SRC" ]; then
  mkdir -p "$(dirname "$_OC_AUTH_DST")" 2>/dev/null
  cp -f "$_OC_AUTH_SRC" "$_OC_AUTH_DST" 2>/dev/null
fi
unset _OC_AUTH_SRC _OC_AUTH_DST
PATCH
  echo "  [OK] Added auto-patch to $SHELL_RC"
else
  echo "  [OK] Auto-patch already in $SHELL_RC"
fi

echo ""
echo "Done! Run: opencode auth login -> Anthropic -> Claude Pro/Max"
echo ""
echo "Note: Open a new terminal or run 'source $SHELL_RC' to activate auto-patch."

#!/usr/bin/env bash
# Local release build — mirrors the CI release workflow for your current platform.
# Produces installer artifacts in ./dist-local/
#
# Usage:
#   bash scripts/build-local.sh              # full build
#   bash scripts/build-local.sh --skip-deps  # skip sidecar download + npm ci

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/dist-local"
BUNDLE_DIR="$ROOT/src-tauri/target/release/bundle"

SKIP_DEPS=false
if [ "${1:-}" = "--skip-deps" ]; then
  SKIP_DEPS=true
fi

echo "========================================"
echo "  SoundsBored — local release build"
echo "========================================"
echo ""

# ── Step 1: sidecar binaries ──────────────────────────────────────────────────
if [ "$SKIP_DEPS" = false ]; then
  echo ">>> Downloading sidecar binaries (yt-dlp + ffmpeg)..."
  bash "$ROOT/scripts/download-yt-dlp.sh"
  echo ""
else
  echo ">>> Skipping sidecar download (--skip-deps)"
  echo ""
fi

# ── Step 2: JS dependencies ───────────────────────────────────────────────────
if [ "$SKIP_DEPS" = false ]; then
  echo ">>> Installing JS dependencies..."
  cd "$ROOT"
  npm ci
  echo ""
else
  echo ">>> Skipping npm ci (--skip-deps)"
  echo ""
fi

# ── Step 3: Tauri build ───────────────────────────────────────────────────────
echo ">>> Building Tauri app..."
cd "$ROOT"
npm run tauri build
echo ""

# ── Step 4: Collect artifacts ─────────────────────────────────────────────────
echo ">>> Collecting artifacts into $OUT_DIR ..."
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# Windows
find "$BUNDLE_DIR/nsis"  -name "*.exe" -exec cp {} "$OUT_DIR/" \; 2>/dev/null || true
find "$BUNDLE_DIR/msi"   -name "*.msi" -exec cp {} "$OUT_DIR/" \; 2>/dev/null || true
# macOS
find "$BUNDLE_DIR/dmg"   -name "*.dmg" -exec cp {} "$OUT_DIR/" \; 2>/dev/null || true
find "$BUNDLE_DIR/macos" -name "*.app.tar.gz" -exec cp {} "$OUT_DIR/" \; 2>/dev/null || true
# Linux
find "$BUNDLE_DIR/appimage" -name "*.AppImage" -exec cp {} "$OUT_DIR/" \; 2>/dev/null || true
find "$BUNDLE_DIR/deb"      -name "*.deb"      -exec cp {} "$OUT_DIR/" \; 2>/dev/null || true

echo ""
echo "========================================"
echo "  Build complete! Artifacts in dist-local/"
echo "========================================"
ls -lh "$OUT_DIR"

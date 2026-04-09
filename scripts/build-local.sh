#!/usr/bin/env bash
# Local release build — mirrors the CI release workflow for your current platform.
# Produces installer artifacts (+ updater .sig files) in ./dist-local/
#
# Usage:
#   bash scripts/build-local.sh                         # build, no version bump
#   bash scripts/build-local.sh --version 1.5.0        # bump version then build
#   bash scripts/build-local.sh --skip-deps             # skip sidecar download + npm ci
#   bash scripts/build-local.sh --version 1.5.0 --skip-deps

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/dist-local"
BUNDLE_DIR="$ROOT/src-tauri/target/release/bundle"

SKIP_DEPS=false
NEW_VERSION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-deps) SKIP_DEPS=true; shift ;;
    --version)   NEW_VERSION="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

echo "========================================"
echo "  SoundsBored — local release build"
echo "========================================"
echo ""

# ── Step 1: Version bump ──────────────────────────────────────────────────────
if [ -n "$NEW_VERSION" ]; then
  echo ">>> Bumping version to $NEW_VERSION ..."
  cd "$ROOT"

  node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    p.version = process.env.VERSION;
    fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
  " VERSION="$NEW_VERSION"

  node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
    p.version = process.env.VERSION;
    fs.writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(p, null, 2) + '\n');
  " VERSION="$NEW_VERSION"

  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/^version = \".*\"/version = \"$NEW_VERSION\"/" "$ROOT/src-tauri/Cargo.toml"
  else
    sed -i "s/^version = \".*\"/version = \"$NEW_VERSION\"/" "$ROOT/src-tauri/Cargo.toml"
  fi

  echo "    package.json, tauri.conf.json, Cargo.toml → $NEW_VERSION"
  echo ""
else
  echo ">>> Skipping version bump (pass --version X.Y.Z to bump)"
  echo ""
fi

# ── Step 2: Signing key check ─────────────────────────────────────────────────
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  echo ">>> WARNING: TAURI_SIGNING_PRIVATE_KEY is not set."
  echo "    Updater .sig files and latest.json will NOT be generated."
  echo "    Export the key before running to produce a complete release build."
  echo ""
else
  echo ">>> Signing key detected — updater artifacts will be generated."
  echo ""
fi

# ── Step 3: Sidecar binaries ──────────────────────────────────────────────────
if [ "$SKIP_DEPS" = false ]; then
  echo ">>> Downloading sidecar binaries (yt-dlp + ffmpeg)..."
  bash "$ROOT/scripts/download-yt-dlp.sh"
  echo ""
else
  echo ">>> Skipping sidecar download (--skip-deps)"
  echo ""
fi

# ── Step 4: JS dependencies ───────────────────────────────────────────────────
if [ "$SKIP_DEPS" = false ]; then
  echo ">>> Installing JS dependencies..."
  cd "$ROOT"
  npm ci
  echo ""
else
  echo ">>> Skipping npm ci (--skip-deps)"
  echo ""
fi

# ── Step 5: Tauri build ───────────────────────────────────────────────────────
echo ">>> Building Tauri app..."
cd "$ROOT"
npm run tauri build
echo ""

# ── Step 6: Collect artifacts ─────────────────────────────────────────────────
echo ">>> Collecting artifacts into $OUT_DIR ..."
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# Windows installers + signatures
find "$BUNDLE_DIR/nsis"  -name "*.exe"         -exec cp {} "$OUT_DIR/" \; 2>/dev/null || true
find "$BUNDLE_DIR/nsis"  -name "*.exe.sig"     -exec cp {} "$OUT_DIR/" \; 2>/dev/null || true
find "$BUNDLE_DIR/nsis"  -name "*.nsis.zip"    -exec cp {} "$OUT_DIR/" \; 2>/dev/null || true
find "$BUNDLE_DIR/nsis"  -name "*.nsis.zip.sig" -exec cp {} "$OUT_DIR/" \; 2>/dev/null || true
find "$BUNDLE_DIR/msi"   -name "*.msi"         -exec cp {} "$OUT_DIR/" \; 2>/dev/null || true
find "$BUNDLE_DIR/msi"   -name "*.msi.zip"     -exec cp {} "$OUT_DIR/" \; 2>/dev/null || true
find "$BUNDLE_DIR/msi"   -name "*.msi.zip.sig" -exec cp {} "$OUT_DIR/" \; 2>/dev/null || true
# macOS installers + signatures
find "$BUNDLE_DIR/dmg"   -name "*.dmg"         -exec cp {} "$OUT_DIR/" \; 2>/dev/null || true
find "$BUNDLE_DIR/macos" -name "*.app.tar.gz"  -exec cp {} "$OUT_DIR/" \; 2>/dev/null || true
find "$BUNDLE_DIR/macos" -name "*.app.tar.gz.sig" -exec cp {} "$OUT_DIR/" \; 2>/dev/null || true
# Linux installers + signatures
find "$BUNDLE_DIR/appimage" -name "*.AppImage"      -exec cp {} "$OUT_DIR/" \; 2>/dev/null || true
find "$BUNDLE_DIR/appimage" -name "*.AppImage.sig"  -exec cp {} "$OUT_DIR/" \; 2>/dev/null || true
find "$BUNDLE_DIR/appimage" -name "*.AppImage.tar.gz"     -exec cp {} "$OUT_DIR/" \; 2>/dev/null || true
find "$BUNDLE_DIR/appimage" -name "*.AppImage.tar.gz.sig" -exec cp {} "$OUT_DIR/" \; 2>/dev/null || true
find "$BUNDLE_DIR/deb"      -name "*.deb"            -exec cp {} "$OUT_DIR/" \; 2>/dev/null || true

echo ""
echo "========================================"
echo "  Build complete! Artifacts in dist-local/"
echo "========================================"
ls -lh "$OUT_DIR"

#!/usr/bin/env bash
# Downloads yt-dlp and ffmpeg binaries into src-tauri/binaries/ with Tauri sidecar naming.
# By default downloads for the current platform only.
# Pass --all to download all supported platforms (useful for CI cross-compilation).
#
# Sources:
#   yt-dlp  — github.com/yt-dlp/yt-dlp (latest release)
#   ffmpeg  — Windows: github.com/BtbN/FFmpeg-Builds
#             macOS:   evermeet.cx/ffmpeg
#             Linux:   johnvansickle.com/ffmpeg (static build)
#
# Requirements: curl, tar (for Linux/zip on Windows 10+), unzip (macOS/Linux)
#
# Usage:
#   bash scripts/download-yt-dlp.sh          # current platform
#   bash scripts/download-yt-dlp.sh --all    # all platforms

set -euo pipefail

BINARIES_DIR="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/binaries"
TMPDIR_LOCAL="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_LOCAL"' EXIT

mkdir -p "$BINARIES_DIR"

# ── yt-dlp ────────────────────────────────────────────────────────────────────

echo "Fetching latest yt-dlp release..."
# grep -o extracts the key+value pair regardless of whitespace around the colon
# Pass Authorization header if GITHUB_TOKEN is set (avoids 403 rate-limit in CI)
YTDLP_VERSION=$(curl -sSfL \
  ${GITHUB_TOKEN:+-H "Authorization: token $GITHUB_TOKEN"} \
  "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest" \
  | grep -o '"tag_name"\s*:\s*"[^"]*"' \
  | grep -o '"[^"]*"$' \
  | tr -d '"')

if [ -z "$YTDLP_VERSION" ]; then
  echo "ERROR: Could not determine latest yt-dlp version."
  exit 1
fi

echo "yt-dlp $YTDLP_VERSION"
YTDLP_BASE="https://github.com/yt-dlp/yt-dlp/releases/download/$YTDLP_VERSION"

download_ytdlp() {
  local remote="$1" local_name="$2"
  echo "  yt-dlp: $remote -> $local_name"
  curl -sSfL "$YTDLP_BASE/$remote" -o "$BINARIES_DIR/$local_name"
  chmod +x "$BINARIES_DIR/$local_name"
}

# ── ffmpeg ────────────────────────────────────────────────────────────────────

# Windows x64 — BtbN GPL static build
# Use PowerShell's Expand-Archive (always available on Windows 10+)
download_ffmpeg_windows() {
  local dest="$BINARIES_DIR/ffmpeg-x86_64-pc-windows-msvc.exe"
  echo "  ffmpeg: BtbN win64-gpl -> ffmpeg-x86_64-pc-windows-msvc.exe"
  local zip="$TMPDIR_LOCAL/ffmpeg-win64.zip"
  curl -sSfL \
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip" \
    -o "$zip"
  local extract_dir="$TMPDIR_LOCAL/ffmpeg-win64"
  # Convert MSYS path to Windows path for PowerShell
  local zip_win extract_dir_win dest_win
  zip_win=$(cygpath -w "$zip")
  extract_dir_win=$(cygpath -w "$extract_dir")
  dest_win=$(cygpath -w "$dest")
  powershell.exe -NoProfile -Command \
    "Expand-Archive -Path '$zip_win' -DestinationPath '$extract_dir_win' -Force; \
     Copy-Item '$extract_dir_win\ffmpeg-master-latest-win64-gpl\bin\ffmpeg.exe' '$dest_win'"
  chmod +x "$dest"
}

# macOS — Homebrew (most reliable in CI; works for both arm64 and x86_64)
download_ffmpeg_macos() {
  local arch="$1" triple="$2"
  local dest="$BINARIES_DIR/ffmpeg-$triple"
  echo "  ffmpeg: homebrew -> ffmpeg-$triple"
  brew install --quiet ffmpeg 2>/dev/null || true
  cp "$(brew --prefix)/bin/ffmpeg" "$dest"
  chmod +x "$dest"
}

# Linux x64 — John Van Sickle static build (tar.xz)
download_ffmpeg_linux() {
  local dest="$BINARIES_DIR/ffmpeg-x86_64-unknown-linux-gnu"
  echo "  ffmpeg: johnvansickle.com amd64-static -> ffmpeg-x86_64-unknown-linux-gnu"
  local tarball="$TMPDIR_LOCAL/ffmpeg-linux.tar.xz"
  curl -sSfL \
    "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz" \
    -o "$tarball"
  tar -xJf "$tarball" -C "$TMPDIR_LOCAL" --wildcards "*/ffmpeg" --strip-components=1
  mv "$TMPDIR_LOCAL/ffmpeg" "$dest"
  chmod +x "$dest"
}

# ── Platform dispatch ─────────────────────────────────────────────────────────

download_all() {
  echo ""
  echo "=== yt-dlp ==="
  download_ytdlp "yt-dlp.exe"    "yt-dlp-x86_64-pc-windows-msvc.exe"
  download_ytdlp "yt-dlp_macos"  "yt-dlp-aarch64-apple-darwin"
  download_ytdlp "yt-dlp_macos"  "yt-dlp-x86_64-apple-darwin"
  download_ytdlp "yt-dlp"        "yt-dlp-x86_64-unknown-linux-gnu"

  echo ""
  echo "=== ffmpeg ==="
  download_ffmpeg_windows
  download_ffmpeg_macos "arm64" "aarch64-apple-darwin"
  download_ffmpeg_macos "x64"   "x86_64-apple-darwin"
  download_ffmpeg_linux
}

download_current() {
  local os arch
  os=$(uname -s)
  arch=$(uname -m)

  echo ""
  echo "=== yt-dlp ==="
  case "$os" in
    Linux*)
      download_ytdlp "yt-dlp" "yt-dlp-x86_64-unknown-linux-gnu"
      ;;
    Darwin*)
      if [ "$arch" = "arm64" ]; then
        download_ytdlp "yt-dlp_macos" "yt-dlp-aarch64-apple-darwin"
      else
        download_ytdlp "yt-dlp_macos" "yt-dlp-x86_64-apple-darwin"
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*)
      download_ytdlp "yt-dlp.exe" "yt-dlp-x86_64-pc-windows-msvc.exe"
      ;;
    *)
      echo "ERROR: Unsupported OS: $os"
      exit 1
      ;;
  esac

  echo ""
  echo "=== ffmpeg ==="
  case "$os" in
    Linux*)
      download_ffmpeg_linux
      ;;
    Darwin*)
      if [ "$arch" = "arm64" ]; then
        download_ffmpeg_macos "arm64" "aarch64-apple-darwin"
      else
        download_ffmpeg_macos "x64" "x86_64-apple-darwin"
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*)
      download_ffmpeg_windows
      ;;
  esac
}

# ── Main ──────────────────────────────────────────────────────────────────────

if [ "${1:-}" = "--all" ]; then
  echo "Downloading all platforms..."
  download_all
else
  echo "Downloading for current platform..."
  download_current
fi

echo ""
echo "Done. Binaries in src-tauri/binaries/:"
ls -lh "$BINARIES_DIR" | grep -E "yt-dlp|ffmpeg" || true

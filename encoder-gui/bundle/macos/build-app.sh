#!/usr/bin/env bash
# Build the HAP Encoder.app bundle for macOS.
#
# Prereqs:
#   cargo install cargo-bundle
#   ffmpeg, ffprobe on PATH (Homebrew install is fine — its dylibs get
#   bundled too).
#
# Output: encoder-gui/target/release/bundle/osx/HAP Encoder.app

set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CRATE_DIR=$(cd "$SCRIPT_DIR/../.." && pwd)

if ! command -v cargo-bundle >/dev/null 2>&1; then
  echo "cargo-bundle not found. Install with: cargo install cargo-bundle" >&2
  exit 1
fi

echo "==> Staging ffmpeg + dylibs"
"$SCRIPT_DIR/stage-ffmpeg.sh"

echo "==> Building release binary"
cd "$CRATE_DIR"
cargo bundle --release

APP_PATH="$CRATE_DIR/target/release/bundle/osx/HAP Encoder.app"
RES="$APP_PATH/Contents/Resources"
NESTED="$RES/bundle/macos/staging"

# cargo-bundle preserves source paths, so staged files land at
# Resources/bundle/macos/staging/. Flatten into Resources/ where the
# runtime sidecar lookup expects them.
if [[ -d "$NESTED" ]]; then
  echo "==> Flattening staged ffmpeg into Resources/"
  mv "$NESTED"/* "$RES"/
  rm -rf "$RES/bundle"
fi

if [[ -d "$APP_PATH" ]]; then
  echo
  echo "Built: $APP_PATH"
  size=$(du -sh "$APP_PATH" | awk '{print $1}')
  echo "Bundle size: $size"
fi

#!/usr/bin/env bash
# Build HanoiShow.app — a self-contained macOS app bundle of
# combined_landscape.ts.
#
# Layout:
#   HanoiShow.app/Contents/MacOS/hanoishow            # deno compile output
#   HanoiShow.app/Contents/Resources/lib*.dylib       # the 4 FFI dylibs + deps
#   HanoiShow.app/Contents/Resources/assets/*         # fonts, poem, tegaki data
#   HanoiShow.app/Contents/Info.plist
#
# Prereqs: deno on PATH, cargo on PATH, Xcode Command Line Tools (otool /
# install_name_tool / codesign).
#
# Output: HanoiShow.app in this directory.

set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
NOTEBOOKS_DIR=$(cd "$SCRIPT_DIR/../../../.." && pwd)        # apps/deno-notebooks
HANOI_DIR=$(cd "$SCRIPT_DIR/../.." && pwd)                  # examples/hanoiShow
REPO_ROOT=$(cd "$NOTEBOOKS_DIR/../.." && pwd)               # avTools

APP_NAME="HanoiShow"
APP_PATH="$SCRIPT_DIR/$APP_NAME.app"
EXEC_NAME="hanoishow"
ENTRY="$HANOI_DIR/combined_landscape.ts"
BUNDLE_ID="com.avneesh.hanoishow"

# ────────────────────────────────────────────────────────────────
# 1. Build & stage the 4 FFI dylibs (with their dep chains).
# ────────────────────────────────────────────────────────────────
"$SCRIPT_DIR/stage-libs.sh"
STAGED_LIBS="$SCRIPT_DIR/staging"

# ────────────────────────────────────────────────────────────────
# 2. Stage runtime assets (fonts, poem, tegaki bundle, system fonts).
# ────────────────────────────────────────────────────────────────
STAGED_ASSETS="$SCRIPT_DIR/staging_assets"
rm -rf "$STAGED_ASSETS"
mkdir -p "$STAGED_ASSETS"

echo "==> Staging assets"

# hanoiShow-local assets — bundle_paths.ts resolveAsset() flattens to basename
# in compiled mode, so we copy them flat.
cp "$HANOI_DIR/poem.txt"               "$STAGED_ASSETS/"
cp "$HANOI_DIR/TorsilpYingyai.ttf"     "$STAGED_ASSETS/"
cp "$HANOI_DIR/SOV_sannoga2467.ttf"    "$STAGED_ASSETS/"
cp "$HANOI_DIR/SOV_sorm2496.ttf"       "$STAGED_ASSETS/"

# Tegaki bundle from the cloned companion repo.
TEGAKI_DIR="$REPO_ROOT/clonedCompanionRepos/tegaki/packages/renderer/fonts/charmonman"
if [[ -d "$TEGAKI_DIR" ]]; then
  cp "$TEGAKI_DIR/charmonman.ttf"  "$STAGED_ASSETS/"
  cp "$TEGAKI_DIR/glyphData.json"  "$STAGED_ASSETS/"
else
  echo "warning: tegaki bundle not found at $TEGAKI_DIR — tegaki scene will fail at runtime" >&2
fi

# System fonts that text_engine auto-loads. resolveAssetDir maps the dir to
# Contents/Resources/assets/, so we drop them flat here too.
SYSTEM_FONTS_DIR="$NOTEBOOKS_DIR/assets/fonts"
if [[ -d "$SYSTEM_FONTS_DIR" ]]; then
  find "$SYSTEM_FONTS_DIR" -maxdepth 1 -type f \( -name "*.ttf" -o -name "*.otf" -o -name "*.woff" -o -name "*.woff2" \) \
    -exec cp {} "$STAGED_ASSETS/" \;
fi

# Tweakpane + perf-pane web-component bundles used by the on-window panels.
# panel_html.ts and perf_shell_html.ts read these via Deno.readTextFileSync.
for bundle in \
  "$REPO_ROOT/webcomponents/tweakpane/dist/tweakpane-client.js" \
  "$REPO_ROOT/webcomponents/perf-pane/dist/perf-pane.js"; do
  if [[ -f "$bundle" ]]; then
    cp "$bundle" "$STAGED_ASSETS/"
  else
    echo "warning: missing web bundle $bundle — panel rendering will fail" >&2
  fi
done

asset_count=$(ls "$STAGED_ASSETS" | wc -l | tr -d ' ')
echo "Staged $asset_count asset files"

# ────────────────────────────────────────────────────────────────
# 3. deno compile the entry script into a standalone binary.
# ────────────────────────────────────────────────────────────────
STAGED_BIN="$SCRIPT_DIR/staging_bin"
rm -rf "$STAGED_BIN"
mkdir -p "$STAGED_BIN"

echo "==> deno compile $ENTRY"
# Compile from the workspace root so `--exclude` patterns (which are CWD-
# relative) line up with where node_modules actually lives in the bundle.
cd "$REPO_ROOT"

# Auto-derive exclude flags by walking the actual import graph from
# `deno info --json`, expanding through each reachable package's
# package.json dependencies. Everything in node_modules/.deno/ that isn't
# reachable from the entry script gets excluded — no hand-curated list.
# See gen_npm_excludes.py for the resolver logic.
echo "==> Computing npm exclude set from import graph"
EXCLUDE_FILE="$SCRIPT_DIR/.npm_excludes"
"$SCRIPT_DIR/gen_npm_excludes.py" "$REPO_ROOT" "$ENTRY" > "$EXCLUDE_FILE"
excl_count=$(wc -l < "$EXCLUDE_FILE" | tr -d ' ')
echo "    excluding $excl_count npm packages not reachable from $EXEC_NAME"

# Pass the excludes as @-prefixed argfile to dodge ARG_MAX.
deno compile \
  --allow-all \
  --unstable-webgpu \
  --unstable-ffi \
  $(< "$EXCLUDE_FILE") \
  --output "$STAGED_BIN/$EXEC_NAME" \
  "$ENTRY"

# ────────────────────────────────────────────────────────────────
# 4. Construct the .app shell.
# ────────────────────────────────────────────────────────────────
rm -rf "$APP_PATH"
mkdir -p "$APP_PATH/Contents/MacOS"
mkdir -p "$APP_PATH/Contents/Resources/assets"

cp "$STAGED_BIN/$EXEC_NAME" "$APP_PATH/Contents/MacOS/$EXEC_NAME"
chmod +x "$APP_PATH/Contents/MacOS/$EXEC_NAME"

cp "$STAGED_LIBS"/* "$APP_PATH/Contents/Resources/"
cp "$STAGED_ASSETS"/* "$APP_PATH/Contents/Resources/assets/"

# Syphon.framework needs to live next to libsyphon_bridge.dylib at
# Contents/Resources/frameworks/Syphon.framework — that's the first
# candidate path syphon_bridge's dlopen logic searches when dlib_directory
# is queryable, and it's the only one that works when the app is launched
# via Finder/`open` (where CWD-based fallbacks resolve to /).
SYPHON_FRAMEWORK_SRC="$NOTEBOOKS_DIR/native/syphon_bridge/frameworks/Syphon.framework"
if [[ -d "$SYPHON_FRAMEWORK_SRC" ]]; then
  mkdir -p "$APP_PATH/Contents/Resources/frameworks"
  cp -R "$SYPHON_FRAMEWORK_SRC" "$APP_PATH/Contents/Resources/frameworks/"
else
  echo "warning: Syphon.framework not found at $SYPHON_FRAMEWORK_SRC — Syphon output will fail" >&2
fi

cat > "$APP_PATH/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleExecutable</key><string>$EXEC_NAME</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleVersion</key><string>0.1.0</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# ────────────────────────────────────────────────────────────────
# 5. Ad-hoc sign so the kernel will launch the binary on Apple Silicon.
# ────────────────────────────────────────────────────────────────
codesign --force --sign - "$APP_PATH/Contents/MacOS/$EXEC_NAME"

size=$(du -sh "$APP_PATH" | awk '{print $1}')
echo
echo "Built: $APP_PATH ($size)"
echo "Run with: open \"$APP_PATH\""

#!/usr/bin/env bash

# =============================================================================
# avTools bootstrap
# =============================================================================
# Goal: after cloning, run this script once and be ready to open .ipynb files
# under apps/deno-notebooks with the Deno (avtools unstable) kernel.
#
# This script:
#   1) Installs missing toolchains (Rust, Deno, uv)
#   2) Builds native Rust/FFI helpers
#   3) Caches Deno dependencies
#   4) Creates a uv-managed Python venv and installs Jupyter
#   5) Installs the custom Deno Jupyter kernelspec
#   6) Installs browser-projections npm dependencies and builds piano-roll
#      web component assets
#   7) Installs livecode-tldraw npm dependencies
#
# Run: ./setup.sh
# =============================================================================

set -euo pipefail
IFS=$'\n\t'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOTEBOOK_DIR="$ROOT_DIR/apps/deno-notebooks"
BROWSER_PROJECTIONS_DIR="$ROOT_DIR/apps/browser-projections"
LIVECODE_TLDRAW_DIR="$ROOT_DIR/apps/livecode-tldraw"

echo "================================================"
echo "avTools Setup"
echo "================================================"
echo "Repo root: $ROOT_DIR"
echo ""

ensure_in_path() {
  local bin="$1"
  if ! command -v "$bin" >/dev/null 2>&1; then
    return 1
  fi
  return 0
}

node_major_version() {
  if ! ensure_in_path node; then
    return 1
  fi
  node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null
}

node_supports_browser_apps() {
  local major
  major="$(node_major_version)" || return 1
  [ "$major" -ge 20 ]
}

confirm_toolchain_install() {
  local response
  echo "Missing toolchains can be installed automatically."
  echo "Install missing toolchains now? (y/N)"
  read -r response
  case "${response,,}" in
    y|yes) return 0 ;;
    *) return 1 ;;
  esac
}

warn_toolchain_missing() {
  local missing=("$@")
  echo ""
  echo "Toolchain install was skipped. Missing components:"
  for item in "${missing[@]}"; do
    echo "  - $item"
  done
  echo ""
  echo "Impact (fill in as needed):"
  if printf '%s\n' "${missing[@]}" | grep -q "Rust"; then
    echo "  - Rust: Prevents use of MIDI features, Syphon features, and the ability to spawn windows for graphics tasks"
  fi
  if printf '%s\n' "${missing[@]}" | grep -q "Deno"; then
    echo "  - Deno: Prevents use of any non-browser scripts or interactive notebooks"
  fi
  if printf '%s\n' "${missing[@]}" | grep -q "uv"; then
    echo "  - uv/Python: Prevents use of any interactive notebooks (commandline scripts still work)"
  fi
  if printf '%s\n' "${missing[@]}" | grep -q "Node.js"; then
    echo "  - Node/npm: Prevents building browser pages"
  fi
  echo ""
}

install_rust() {
  echo "[toolchain] Installing Rust via rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
  echo "Rust $(rustc --version) installed."
}

install_deno() {
  echo "[toolchain] Installing Deno..."
  curl -fsSL https://deno.land/install.sh | sh
  export DENO_INSTALL="${DENO_INSTALL:-$HOME/.deno}"
  export PATH="$DENO_INSTALL/bin:$PATH"
  echo "Deno $(deno --version | head -n1) installed."
}

install_uv() {
  echo "[toolchain] Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
  echo "uv $(uv --version) installed."
}

install_node() {
  echo "[toolchain] Installing Node.js via nvm..."
  if [ ! -d "$HOME/.nvm" ]; then
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

  if ! command -v nvm >/dev/null 2>&1; then
    echo "nvm is not available after installation. Aborting."
    exit 1
  fi

  nvm install 24
  nvm use 24
  nvm alias default 24
  echo "Node $(node --version) installed."
  echo "npm $(npm --version) installed."
}

# Syphon.framework in this repo follows Apple's canonical framework layout, where:
#   Syphon.framework/Syphon            -> Versions/Current/Syphon
#   Syphon.framework/Resources         -> Versions/Current/Resources
#   Syphon.framework/Versions/Current  -> A
# Some archive/download flows can materialize these links as plain files/dirs,
# which can break framework discovery/loading behavior. We normalize the layout
# during setup so the bundled framework is always in a known-good state.
ensure_syphon_framework_links() {
  local framework_root="$NOTEBOOK_DIR/native/syphon_bridge/frameworks/Syphon.framework"

  if [ ! -d "$framework_root" ]; then
    echo "Syphon.framework bundle not found at $framework_root (skipping framework link repair)."
    return 0
  fi

  if [ ! -d "$framework_root/Versions/A" ]; then
    echo "Syphon.framework is missing Versions/A (skipping framework link repair)."
    return 0
  fi

  repair_link() {
    local link_path="$1"
    local link_target="$2"
    local current_target=""

    if [ -L "$link_path" ]; then
      current_target="$(readlink "$link_path")"
      if [ "$current_target" = "$link_target" ]; then
        return 0
      fi
      rm -f "$link_path"
    elif [ -e "$link_path" ]; then
      if [ -d "$link_path" ]; then
        rm -rf "$link_path"
      else
        rm -f "$link_path"
      fi
    fi

    ln -s "$link_target" "$link_path"
  }

  repair_link "$framework_root/Syphon" "Versions/Current/Syphon"
  repair_link "$framework_root/Resources" "Versions/Current/Resources"
  repair_link "$framework_root/Versions/Current" "A"

  echo "Syphon.framework links verified/repaired."
}

echo "[1/7] Ensuring toolchains are installed..."

want_install_toolchains=true
if ! confirm_toolchain_install; then
  want_install_toolchains=false
fi

missing_toolchains=()

if ! ensure_in_path rustc || ! ensure_in_path cargo; then
  if [ "$want_install_toolchains" = true ]; then
    install_rust
  else
    missing_toolchains+=("Rust (rustc/cargo)")
  fi
else
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env" || true
  echo "Rust already installed: $(rustc --version)"
fi

if ! ensure_in_path deno; then
  if [ "$want_install_toolchains" = true ]; then
    install_deno
  else
    missing_toolchains+=("Deno")
  fi
else
  echo "Deno already installed: $(deno --version | head -n1)"
fi

if ! ensure_in_path uv; then
  if [ "$want_install_toolchains" = true ]; then
    install_uv
  else
    missing_toolchains+=("uv (Python package manager)")
  fi
else
  echo "uv already installed: $(uv --version)"
fi

if ! ensure_in_path node || ! ensure_in_path npm || ! node_supports_browser_apps; then
  if [ "$want_install_toolchains" = true ]; then
    install_node
  else
    missing_toolchains+=("Node.js 20+ + npm")
  fi
else
  echo "Node already installed: $(node --version)"
  echo "npm already installed: $(npm --version)"
fi

if [ "${#missing_toolchains[@]}" -gt 0 ]; then
  warn_toolchain_missing "${missing_toolchains[@]}"
fi

echo ""

echo "[2/7] Building native Rust/FFI helpers..."

# One-liners for rebuilding specific FFI pieces (run from repo root):
#   cargo build --release --manifest-path apps/deno-notebooks/native/fastsleep/Cargo.toml
#   cargo build --release --manifest-path apps/deno-notebooks/native/deno_window/Cargo.toml
#   bash apps/deno-notebooks/scripts/build_syphon_bridge.sh
#   bash apps/deno-notebooks/scripts/build_midi_bridge.sh
#   bash apps/deno-notebooks/scripts/build_text_engine.sh
#   bash apps/deno-notebooks/scripts/build_hap_decoder.sh

if ensure_in_path cargo; then
  ensure_syphon_framework_links
  cargo build --release --manifest-path "$NOTEBOOK_DIR/native/fastsleep/Cargo.toml"
  cargo build --release --manifest-path "$NOTEBOOK_DIR/native/deno_window/Cargo.toml"
  bash "$NOTEBOOK_DIR/scripts/build_syphon_bridge.sh"
  bash "$NOTEBOOK_DIR/scripts/build_midi_bridge.sh"
  bash "$NOTEBOOK_DIR/scripts/build_text_engine.sh"
  bash "$NOTEBOOK_DIR/scripts/build_hap_decoder.sh"
else
  echo "Cargo not available; skipping native builds."
fi

echo "Native helpers built."
echo ""

echo "[3/7] Caching Deno dependencies..."

shopt -s nullglob
cache_targets=(
  "$NOTEBOOK_DIR/libraryIntegrationTetsts/"*.ts
  "$NOTEBOOK_DIR/libraryIntegrationTetsts/"*.tsx
  "$NOTEBOOK_DIR/examples/"*.ts
  "$NOTEBOOK_DIR/tools/"*.ts
  "$NOTEBOOK_DIR/tools/p5gpu_text/"*.ts
  "$NOTEBOOK_DIR/window/"*.ts
  "$NOTEBOOK_DIR/midi/"*.ts
  "$NOTEBOOK_DIR/misc/"*.ts
)
shopt -u nullglob

if ensure_in_path deno; then
  if [ "${#cache_targets[@]}" -gt 0 ]; then
    deno cache --unstable-webgpu --config "$NOTEBOOK_DIR/deno.json" "${cache_targets[@]}"
  else
    echo "No Deno cache targets found (skipping)."
  fi
else
  echo "Deno not available; skipping dependency cache."
fi

echo "Deno dependencies cached."

# ── Patch react-reconciler for Deno compatibility ──────────────────────────
# @pixi/react imports 'react-reconciler/constants' (no .js extension), but
# react-reconciler's package.json has no "exports" field, so Deno's strict
# ESM resolution can't find it. We patch the package.json to add the missing
# exports map. This is safe and idempotent.
RECONCILER_PKG="$ROOT_DIR/node_modules/.deno/react-reconciler@0.31.0/node_modules/react-reconciler/package.json"
if [ -f "$RECONCILER_PKG" ]; then
  if ! grep -q '"exports"' "$RECONCILER_PKG"; then
    echo "Patching react-reconciler package.json for Deno compatibility..."
    python3 -c "
import json, sys
pkg_path = sys.argv[1]
with open(pkg_path) as f:
    pkg = json.load(f)
pkg['exports'] = {
    '.': './index.js',
    './constants': './constants.js',
    './constants.js': './constants.js',
    './reflection': './reflection.js',
    './reflection.js': './reflection.js'
}
with open(pkg_path, 'w') as f:
    json.dump(pkg, f, indent=2)
    f.write('\n')
" "$RECONCILER_PKG"
    echo "react-reconciler patched."
  else
    echo "react-reconciler already patched."
  fi
else
  echo "react-reconciler not found in node_modules (skipping patch)."
fi
echo ""

echo "[4/7] Setting up Python venv with uv + Jupyter..."

if ! ensure_in_path uv; then
  echo "uv not found after install step. Aborting."
  exit 1
fi

uv python install 3.12

pushd "$NOTEBOOK_DIR" >/dev/null
if [ ! -d ".venv" ]; then
  uv venv --seed --python 3.12
fi
uv pip install jupyterlab
popd >/dev/null

echo "Python venv ready at $NOTEBOOK_DIR/.venv"
echo ""

echo "[5/7] Installing avtools Deno Jupyter kernel..."

if ensure_in_path deno; then
  export PATH="$NOTEBOOK_DIR/.venv/bin:$PATH"
  bash "$NOTEBOOK_DIR/scripts/install_avtools_kernel.sh"
else
  echo "Deno not available; skipping kernel install."
fi

echo ""
echo "[6/7] Installing browser-projections npm dependencies..."

if ensure_in_path npm; then
  pushd "$BROWSER_PROJECTIONS_DIR" >/dev/null
  npm install
  npm run buildPianoRoll
  popd >/dev/null
else
  echo "npm not available; skipping browser-projections install."
fi

echo ""
echo "[7/7] Installing livecode-tldraw npm dependencies..."

if ensure_in_path npm; then
  pushd "$LIVECODE_TLDRAW_DIR" >/dev/null
  npm install
  popd >/dev/null
else
  echo "npm not available; skipping livecode-tldraw install."
fi

echo ""
echo "================================================"
echo "Setup Complete"
echo "================================================"
echo ""
echo "Next steps:"
echo "1) Open this repo folder in VS Code."
echo "2) Open any .ipynb under apps/deno-notebooks."
echo "3) If prompted, pick the kernel: \"Deno (avtools unstable)\"."
echo ""
echo "VS Code should already point to the uv venv at:"
echo "  apps/deno-notebooks/.venv/bin/python"
echo ""

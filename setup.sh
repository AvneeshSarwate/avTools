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
#
# Run: ./setup.sh
# =============================================================================

set -euo pipefail
IFS=$'\n\t'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOTEBOOK_DIR="$ROOT_DIR/apps/deno-notebooks"

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
    echo "  - Rust: Prevents use of MIDI features in notebooks, and the ability to spawn windows for graphics tasks"
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

  nvm install 18
  nvm use 18
  nvm alias default 18
  echo "Node $(node --version) installed."
  echo "npm $(npm --version) installed."
}

echo "[1/6] Ensuring toolchains are installed..."

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

if ! ensure_in_path node || ! ensure_in_path npm; then
  if [ "$want_install_toolchains" = true ]; then
    install_node
  else
    missing_toolchains+=("Node.js + npm")
  fi
else
  echo "Node already installed: $(node --version)"
  echo "npm already installed: $(npm --version)"
fi

if [ "${#missing_toolchains[@]}" -gt 0 ]; then
  warn_toolchain_missing "${missing_toolchains[@]}"
fi

echo ""

echo "[2/6] Building native Rust/FFI helpers..."

# One-liners for rebuilding specific FFI pieces (run from repo root):
#   cargo build --release --manifest-path apps/deno-notebooks/native/fastsleep/Cargo.toml
#   cargo build --release --manifest-path apps/deno-notebooks/native/deno_window/Cargo.toml
#   bash apps/deno-notebooks/scripts/build_midi_bridge.sh

if ensure_in_path cargo; then
  cargo build --release --manifest-path "$NOTEBOOK_DIR/native/fastsleep/Cargo.toml"
  cargo build --release --manifest-path "$NOTEBOOK_DIR/native/deno_window/Cargo.toml"
  bash "$NOTEBOOK_DIR/scripts/build_midi_bridge.sh"
else
  echo "Cargo not available; skipping native builds."
fi

echo "Native helpers built."
echo ""

echo "[3/6] Caching Deno dependencies..."

shopt -s nullglob
cache_targets=(
  "$NOTEBOOK_DIR/libraryIntegrationTetsts/"*.ts
  "$NOTEBOOK_DIR/examples/"*.ts
  "$NOTEBOOK_DIR/tools/"*.ts
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
echo ""

echo "[4/6] Setting up Python venv with uv + Jupyter..."

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

echo "[5/6] Installing avtools Deno Jupyter kernel..."

if ensure_in_path deno; then
  export PATH="$NOTEBOOK_DIR/.venv/bin:$PATH"
  bash "$NOTEBOOK_DIR/scripts/install_avtools_kernel.sh"
else
  echo "Deno not available; skipping kernel install."
fi

echo ""
echo "[6/6] Installing browser-projections npm dependencies..."

if ensure_in_path npm; then
  pushd "$ROOT_DIR/apps/browser-projections" >/dev/null
  npm install
  popd >/dev/null
else
  echo "npm not available; skipping browser-projections install."
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

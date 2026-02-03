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

echo "[1/5] Ensuring toolchains are installed..."

if ! ensure_in_path rustc || ! ensure_in_path cargo; then
  install_rust
else
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env" || true
  echo "Rust already installed: $(rustc --version)"
fi

if ! ensure_in_path deno; then
  install_deno
else
  echo "Deno already installed: $(deno --version | head -n1)"
fi

if ! ensure_in_path uv; then
  install_uv
else
  echo "uv already installed: $(uv --version)"
fi

echo ""

echo "[2/5] Building native Rust/FFI helpers..."

# One-liners for rebuilding specific FFI pieces (run from repo root):
#   cargo build --release --manifest-path apps/deno-notebooks/native/fastsleep/Cargo.toml
#   cargo build --release --manifest-path apps/deno-notebooks/native/deno_window/Cargo.toml
#   bash apps/deno-notebooks/scripts/build_midi_bridge.sh

cargo build --release --manifest-path "$NOTEBOOK_DIR/native/fastsleep/Cargo.toml"
cargo build --release --manifest-path "$NOTEBOOK_DIR/native/deno_window/Cargo.toml"
bash "$NOTEBOOK_DIR/scripts/build_midi_bridge.sh"

echo "Native helpers built."
echo ""

echo "[3/5] Caching Deno dependencies..."

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

if [ "${#cache_targets[@]}" -gt 0 ]; then
  deno cache --unstable-webgpu --config "$NOTEBOOK_DIR/deno.json" "${cache_targets[@]}"
else
  echo "No Deno cache targets found (skipping)."
fi

echo "Deno dependencies cached."
echo ""

echo "[4/5] Setting up Python venv with uv + Jupyter..."

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

echo "[5/5] Installing avtools Deno Jupyter kernel..."

export PATH="$NOTEBOOK_DIR/.venv/bin:$PATH"
bash "$NOTEBOOK_DIR/scripts/install_avtools_kernel.sh"

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

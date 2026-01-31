#!/bin/bash

# =============================================================================
# Raspberry Pi Shared Setup Script
# =============================================================================
# This script installs all global tools needed across:
#   - browser_drawn_projections (Node.js/Vite project)
#   - oscClapHost (Rust/CLAP audio plugin host)
#   - denoMusicNotebook (Deno/Jupyter notebook project)
#
# Run with: chmod +x shared_setup.sh && ./shared_setup.sh
# =============================================================================

set -e  # Exit on any error

echo "================================================"
echo "Raspberry Pi Development Environment Setup"
echo "================================================"
echo ""

# Check architecture
ARCH=$(uname -m)
echo "Detected architecture: $ARCH"
echo ""

# -----------------------------------------------------------------------------
# 1. System packages (ALSA for audio, build essentials)
# -----------------------------------------------------------------------------
echo "[1/5] Installing system dependencies..."
sudo apt update
sudo apt install -y \
    build-essential \
    curl \
    wget \
    git \
    libasound2-dev \
    alsa-utils \
    pkg-config \
    libssl-dev

echo "System dependencies installed."
echo ""

# -----------------------------------------------------------------------------
# 2. Node.js via NVM
# -----------------------------------------------------------------------------
echo "[2/5] Installing Node.js via NVM..."

# Install NVM
if [ ! -d "$HOME/.nvm" ]; then
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

    # Load NVM for this session
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
else
    echo "NVM already installed, loading..."
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
fi

# Install Node.js 18 LTS (required by browser_drawn_projections)
nvm install 18
nvm use 18
nvm alias default 18

echo "Node.js $(node --version) installed."
echo "npm $(npm --version) installed."
echo ""

# -----------------------------------------------------------------------------
# 3. Rust via rustup
# -----------------------------------------------------------------------------
echo "[3/5] Installing Rust via rustup..."

if ! command -v rustc &> /dev/null; then
    # Note: For 32-bit OS on 64-bit hardware (Pi 4), you may need to select
    # "Custom installation" and enter "arm-unknown-linux-gnueabihf" as the
    # default host triple if the installer fails.
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y

    # Load cargo for this session
    source "$HOME/.cargo/env"
else
    echo "Rust already installed."
    source "$HOME/.cargo/env"
fi

echo "Rust $(rustc --version) installed."
echo "Cargo $(cargo --version) installed."
echo ""

# -----------------------------------------------------------------------------
# 4. Deno
# -----------------------------------------------------------------------------
echo "[4/5] Installing Deno..."

if ! command -v deno &> /dev/null; then
    # Official Deno install script - supports ARM64
    # Note: Requires 64-bit OS. For 32-bit, you'll need to build from source.
    curl -fsSL https://deno.land/install.sh | sh

    # Add deno to PATH for this session
    export DENO_INSTALL="$HOME/.deno"
    export PATH="$DENO_INSTALL/bin:$PATH"
else
    echo "Deno already installed."
fi

echo "Deno $(deno --version | head -n1) installed."
echo ""

# -----------------------------------------------------------------------------
# 5. uv (Python package manager)
# -----------------------------------------------------------------------------
echo "[5/5] Installing uv (Python package manager)..."

if ! command -v uv &> /dev/null; then
    curl -LsSf https://astral.sh/uv/install.sh | sh

    # Add uv to PATH for this session
    export PATH="$HOME/.local/bin:$PATH"
else
    echo "uv already installed."
fi

echo "uv $(uv --version) installed."
echo ""

# -----------------------------------------------------------------------------
# Shell configuration reminder
# -----------------------------------------------------------------------------
echo "================================================"
echo "Installation Complete!"
echo "================================================"
echo ""
echo "Please restart your shell or run:"
echo "  source ~/.bashrc"
echo ""
echo "To verify installations:"
echo "  node --version"
echo "  npm --version"
echo "  rustc --version"
echo "  cargo --version"
echo "  deno --version"
echo "  uv --version"
echo ""

# =============================================================================
# PROJECT-SPECIFIC SETUP COMMANDS
# =============================================================================
# After running this script, run the following commands in each project:
#
# -----------------------------------------------------------------------------
# browser_drawn_projections
# -----------------------------------------------------------------------------
#   cd browser_drawn_projections
#   npm install
#   npm run dev           # Start development server
#
# -----------------------------------------------------------------------------
# oscClapHost
# -----------------------------------------------------------------------------
#   cd oscClapHost
#   cargo build --release
#   # Binary will be at: target/release/clap-osc-host
#   # Usage: ./target/release/clap-osc-host --help
#
# -----------------------------------------------------------------------------
# denoMusicNotebook
# -----------------------------------------------------------------------------
#   cd denoMusicNotebook
#
#   # 1. Create Python virtual environment and install Jupyter
#   uv python install 3.12
#   uv venv --seed
#   uv pip install jupyterlab
#
#   # 2. (Optional) Build the Rust fast_sleep helper library
#   cargo build --release --manifest-path native/fastsleep/Cargo.toml
#
#   # 3. Build the MIDI bridge native library
#   ./scripts/build_midi_bridge.sh
#
#   # 4. Cache Deno dependencies
#   deno install
#   # OR: deno task install
#
#   # 5. Install the Deno Jupyter kernel
#   source .venv/bin/activate
#   deno jupyter --install
#
#   # 6. Run development task
#   deno task dev
#
# =============================================================================

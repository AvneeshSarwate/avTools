#!/bin/bash
# SessionStart hook: make `deno` available in Claude Code on the web.
#
# The remote container ships Node/npm/bun but no Deno, and the default egress
# policy blocks deno.land, so `curl https://deno.land/install.sh | sh` fails.
# This installs the same official binary from a reachable source instead:
#   1. npm registry  (package `deno`, which vendors the real binary)
#   2. GitHub releases (fallback)
#
# Local machines are left alone -- use ./setup.sh there, which also builds the
# Rust/FFI helpers and the Jupyter kernel that this hook deliberately skips.
set -euo pipefail

# Only run in Claude Code on the web.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

DENO_VERSION="${AVTOOLS_DENO_VERSION:-2.9.5}"
INSTALL_ROOT="${HOME}/.local/share/avtools-deno"
BIN_DIR="${HOME}/.local/bin"
DENO_BIN="${BIN_DIR}/deno"
export DENO_DIR="${DENO_DIR:-${HOME}/.cache/deno}"

mkdir -p "$BIN_DIR" "$DENO_DIR"

log() { echo "[deno-setup] $*"; }

installed_version() {
  [ -x "$DENO_BIN" ] || return 1
  "$DENO_BIN" --version 2>/dev/null | head -n1 | awk '{print $2}'
}

# ---------------------------------------------------------------- install ---
install_from_npm() {
  log "installing deno@${DENO_VERSION} from the npm registry..."
  mkdir -p "$INSTALL_ROOT"
  # The `deno` package pulls a platform-specific optional dep that contains the
  # real binary, so no post-install download from deno.land is needed.
  npm install --prefix "$INSTALL_ROOT" --no-audit --no-fund --loglevel=error \
    "deno@${DENO_VERSION}" >/dev/null 2>&1 || return 1
  local real
  real="$(readlink -f "${INSTALL_ROOT}/node_modules/.bin/deno" 2>/dev/null || true)"
  [ -x "$real" ] || return 1
  ln -sf "$real" "$DENO_BIN"
}

install_from_github() {
  log "npm route failed; falling back to GitHub releases..."
  local url tmp
  case "$(uname -m)" in
    x86_64)  url="https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip" ;;
    aarch64) url="https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-aarch64-unknown-linux-gnu.zip" ;;
    *) log "unsupported architecture $(uname -m)"; return 1 ;;
  esac
  tmp="$(mktemp -d)"
  curl -fsSL --retry 3 --retry-delay 2 -o "${tmp}/deno.zip" "$url" || { rm -rf "$tmp"; return 1; }
  unzip -oq "${tmp}/deno.zip" -d "$tmp" || { rm -rf "$tmp"; return 1; }
  install -m 0755 "${tmp}/deno" "$DENO_BIN"
  rm -rf "$tmp"
}

current="$(installed_version || true)"
if [ "$current" = "$DENO_VERSION" ]; then
  log "deno ${DENO_VERSION} already installed, skipping"
else
  install_from_npm || install_from_github || {
    log "ERROR: could not install deno from npm or GitHub."
    log "Check the egress allowlist for registry.npmjs.org and github.com."
    exit 1
  }
  log "installed $("$DENO_BIN" --version | head -n1)"
fi

# ------------------------------------------------------------ environment ---
# Persist for the whole session so every later shell sees deno.
{
  echo "export PATH=\"${BIN_DIR}:\$PATH\""
  echo "export DENO_DIR=\"${DENO_DIR}\""
  # Outbound HTTPS is re-terminated by the agent proxy; point deno at its CA
  # bundle so fetches to proxied hosts verify instead of failing.
  if [ -f /root/.ccr/ca-bundle.crt ]; then
    echo 'export DENO_CERT="/root/.ccr/ca-bundle.crt"'
  fi
} >> "${CLAUDE_ENV_FILE:-/dev/null}"

export PATH="${BIN_DIR}:$PATH"
[ -f /root/.ccr/ca-bundle.crt ] && export DENO_CERT="/root/.ccr/ca-bundle.crt"

# --------------------------------------------------------- egress warning ---
# Most of this repo imports from JSR (@std/*, @gfx/*). If jsr.io is not on the
# environment's egress allowlist, type-checking and tests cannot resolve them.
if curl -sS --max-time 10 -o /dev/null -w '%{http_code}' https://jsr.io/@std/assert/meta.json 2>/dev/null | grep -q '^200$'; then
  log "jsr.io reachable; warming dependency cache (best effort)..."
  "$DENO_BIN" install --quiet >/dev/null 2>&1 || \
    log "note: 'deno install' did not complete cleanly; run it manually if needed"
else
  log "WARNING: jsr.io is blocked by this environment's egress policy."
  log "  Local code and npm: imports work, but jsr: imports (@std/*, @gfx/*) will not resolve."
  log "  Fix: add jsr.io and npm.jsr.io to the environment's network egress allowlist"
  log "  (Claude Code on the web -> environment settings -> network access)."
fi

log "ready: $("$DENO_BIN" --version | head -n1)"

#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== Building syphon_bridge (release) ==="
cargo build --release --manifest-path "$root/native/syphon_bridge/Cargo.toml"

if [ ! -d "$root/native/syphon_bridge/frameworks/Syphon.framework" ] \
  && [ ! -d "$HOME/Library/Frameworks/Syphon.framework" ] \
  && [ ! -d "/Library/Frameworks/Syphon.framework" ]; then
  echo "Syphon.framework not found. Skipping E2E runtime test."
  exit 0
fi

echo "=== Starting Syphon server process ==="
deno run --unstable-ffi --unstable-webgpu --allow-ffi --allow-env --allow-read \
  --config "$root/deno.json" \
  "$root/libraryIntegrationTetsts/syphon-server-process.ts" &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

sleep 3

echo "=== Running Syphon client validation ==="
deno run --unstable-ffi --allow-ffi --allow-env --allow-read \
  --config "$root/deno.json" \
  "$root/libraryIntegrationTetsts/syphon-client-process.ts"

echo "=== E2E TEST PASSED ==="

#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

printf '==============================\n'
printf '  Syphon Bridge Test Suite\n'
printf '==============================\n\n'

echo "--- T0-a: Checking bundled Syphon.framework ---"
FRAMEWORK_BUNDLED="$root/native/syphon_bridge/frameworks/Syphon.framework"
FRAMEWORK_USER="$HOME/Library/Frameworks/Syphon.framework"
FRAMEWORK_SYSTEM="/Library/Frameworks/Syphon.framework"
if [ -d "$FRAMEWORK_BUNDLED" ] || [ -d "$FRAMEWORK_USER" ] || [ -d "$FRAMEWORK_SYSTEM" ]; then
  echo "PASS: Syphon.framework found"
  HAVE_FRAMEWORK=1
else
  echo "WARN: Syphon.framework not found in bundled/user/system locations."
  echo "  Skipping T3/T4 (runtime Syphon tests)."
  HAVE_FRAMEWORK=0
fi

echo
echo "--- T0-b: Building syphon_bridge (release) ---"
cargo build --release --manifest-path "$root/native/syphon_bridge/Cargo.toml"
echo "PASS: syphon_bridge built"

echo
echo "--- T1: Rust unit tests ---"
cargo test --manifest-path "$root/native/syphon_bridge/Cargo.toml"
echo "PASS: Rust unit tests"

echo
echo "--- T2: FFI smoke test ---"
deno run --unstable-ffi --allow-ffi --allow-env --allow-read \
  --config "$root/deno.json" \
  "$root/libraryIntegrationTetsts/syphon-smoke-test.ts"
echo "PASS: FFI smoke test"

if [ "$HAVE_FRAMEWORK" -eq 1 ]; then
  echo
  echo "--- T3: Windowed integration test ---"
  deno run --unstable-ffi --unstable-webgpu --allow-ffi --allow-env --allow-read \
    --config "$root/deno.json" \
    "$root/libraryIntegrationTetsts/syphon-integration-test.ts"
  echo "PASS: Windowed integration test"

  echo
  echo "--- T4: E2E server/client test ---"
  bash "$root/scripts/syphon-e2e-test.sh"
  echo "PASS: E2E test"
fi

echo
printf '\n==============================\n'
printf '  ALL TESTS PASSED\n'
printf '==============================\n'

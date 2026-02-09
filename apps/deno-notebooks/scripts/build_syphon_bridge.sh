#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cargo build --release --manifest-path "$root_dir/native/syphon_bridge/Cargo.toml"

uname_out="$(uname -s)"
case "$uname_out" in
  Darwin) ext="dylib" ;;
  Linux) ext="so" ;;
  MINGW*|MSYS*|CYGWIN*) ext="dll" ;;
  *)
    echo "Unsupported OS: $uname_out" >&2
    exit 1
    ;;
esac

echo "Built $root_dir/native/syphon_bridge/target/release/libsyphon_bridge.${ext}"

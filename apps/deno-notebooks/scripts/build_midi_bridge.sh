#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cargo build --release --manifest-path "$root_dir/native/midi_bridge/Cargo.toml"

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

lib_name="libmidi_bridge.${ext}"
echo "Built $root_dir/native/midi_bridge/target/release/$lib_name"

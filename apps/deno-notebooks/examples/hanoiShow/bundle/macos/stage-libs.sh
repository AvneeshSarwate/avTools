#!/usr/bin/env bash
# Build the 4 Deno-FFI Rust crates that combined_landscape.ts uses, stage the
# resulting dylibs into ./staging/ along with every non-system dylib they
# transitively depend on, rewrite install names to @loader_path/<basename>,
# and ad-hoc resign. build-app.sh then drops staging/ into
# HanoiShow.app/Contents/Resources/.

set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
STAGE="$SCRIPT_DIR/staging"

# Resolve repo paths.
NOTEBOOKS_DIR=$(cd "$SCRIPT_DIR/../../../.." && pwd)   # apps/deno-notebooks
NATIVE_DIR="$NOTEBOOKS_DIR/native"

CRATES=(deno_window syphon_bridge text_engine midi_bridge)

rm -rf "$STAGE"
mkdir -p "$STAGE"

echo "==> cargo build --release for ${#CRATES[@]} crates"
for crate in "${CRATES[@]}"; do
  echo "    $crate"
  (cd "$NATIVE_DIR/$crate" && cargo build --release >/dev/null)
done

is_system_lib() {
  case "$1" in
    /usr/lib/*|/System/*) return 0 ;;
    *) return 1 ;;
  esac
}

rpaths_of() {
  otool -l "$1" | awk '
    /cmd LC_RPATH/ { in_cmd=1; next }
    in_cmd && $1=="path" { print $2; in_cmd=0 }
  '
}

resolve_dep() {
  local dep="$1" referrer="$2"
  case "$dep" in
    @rpath/*)
      local libname="${dep#@rpath/}"
      while IFS= read -r rp; do
        [[ -f "$rp/$libname" ]] && { echo "$rp/$libname"; return 0; }
      done < <(rpaths_of "$referrer")
      for prefix in /opt/homebrew/lib /usr/local/lib; do
        [[ -f "$prefix/$libname" ]] && { echo "$prefix/$libname"; return 0; }
      done
      echo "error: could not resolve $dep (referrer $(basename "$referrer"))" >&2
      return 1
      ;;
    @loader_path/*|@executable_path/*)
      local libname="${dep##*/}"
      local dir
      dir=$(dirname "$referrer")
      [[ -f "$dir/$libname" ]] && { echo "$dir/$libname"; return 0; }
      echo "error: could not resolve $dep" >&2
      return 1
      ;;
    *)
      echo "$dep"
      ;;
  esac
}

copy_one() {
  local src="$1" dest_name="$2"
  [[ -f "$STAGE/$dest_name" ]] && return
  local real
  real=$(realpath "$src")
  cp "$real" "$STAGE/$dest_name"
  chmod u+w "$STAGE/$dest_name"
}

walk_deps() {
  local file="$1"
  local self
  self=$(basename "$file")
  while IFS= read -r dep; do
    is_system_lib "$dep" && continue
    local base
    base=$(basename "$dep")
    [[ "$base" == "$self" ]] && continue
    [[ -f "$STAGE/$base" ]] && continue
    local resolved
    resolved=$(resolve_dep "$dep" "$file") || continue
    copy_one "$resolved" "$base"
    walk_deps "$STAGE/$base"
  done < <(otool -L "$file" | awk 'NR>1 {print $1}')
}

echo "==> Staging crate dylibs + dependency chain"
for crate in "${CRATES[@]}"; do
  built="$NATIVE_DIR/$crate/target/release/lib${crate}.dylib"
  if [[ ! -f "$built" ]]; then
    echo "error: $built missing — cargo build did not produce expected output" >&2
    exit 1
  fi
  copy_one "$built" "lib${crate}.dylib"
done

for crate in "${CRATES[@]}"; do
  walk_deps "$STAGE/lib${crate}.dylib"
done

# Strip pre-existing signatures so install_name_tool doesn't warn; we ad-hoc
# resign at the end (Apple Silicon kernel SIGKILLs unsigned binaries).
for file in "$STAGE"/*; do
  codesign --remove-signature "$file" 2>/dev/null || true
done

echo "==> Rewriting install names to @loader_path"
for file in "$STAGE"/*; do
  base=$(basename "$file")
  if [[ "$file" == *.dylib ]]; then
    if ! install_name_tool -id "@loader_path/$base" "$file" 2>/dev/null; then
      # Some Homebrew dylibs have __LINKEDIT layout issues; compacting first
      # usually unblocks install_name_tool.
      strip -x "$file" 2>/dev/null || true
      install_name_tool -id "@loader_path/$base" "$file" 2>/dev/null || true
    fi
  fi
  while IFS= read -r dep; do
    is_system_lib "$dep" && continue
    depbase=$(basename "$dep")
    [[ "$depbase" == "$base" ]] && continue
    install_name_tool -change "$dep" "@loader_path/$depbase" "$file" 2>/dev/null || true
  done < <(otool -L "$file" | awk 'NR>1 {print $1}')
done

echo "==> Ad-hoc signing"
for file in "$STAGE"/*; do
  codesign --force --sign - "$file" 2>/dev/null || true
done

count=$(ls "$STAGE" | wc -l | tr -d ' ')
size=$(du -sh "$STAGE" | awk '{print $1}')
echo "Staged $count files ($size) in $STAGE"

#!/usr/bin/env bash
# Resolve ffmpeg/ffprobe via PATH, copy them and every non-system dylib they
# transitively depend on into ./staging/, then rewrite install names so each
# binary loads its siblings via @loader_path. cargo-bundle later copies the
# whole staging/ directory into HAP Encoder.app/Contents/Resources/, where
# the runtime sidecar lookup in src/platform/bundled_ffmpeg.rs finds them.

set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
STAGE="$SCRIPT_DIR/staging"

rm -rf "$STAGE"
mkdir -p "$STAGE"

is_system_lib() {
  case "$1" in
    /usr/lib/*|/System/*) return 0 ;;
    *) return 1 ;;
  esac
}

# Print the embedded LC_RPATH entries of a binary, one per line.
rpaths_of() {
  otool -l "$1" | awk '
    /cmd LC_RPATH/ { in_cmd=1; next }
    in_cmd && $1=="path" { print $2; in_cmd=0 }
  '
}

# Resolve a dependency string (as printed by `otool -L`) into an absolute
# path on disk. Handles plain paths and @rpath/-prefixed entries.
resolve_dep() {
  local dep="$1" referrer="$2"
  case "$dep" in
    @rpath/*)
      local libname="${dep#@rpath/}"
      while IFS= read -r rp; do
        if [[ -f "$rp/$libname" ]]; then
          echo "$rp/$libname"
          return 0
        fi
      done < <(rpaths_of "$referrer")
      # Fallback: well-known Homebrew prefixes.
      for prefix in /opt/homebrew/lib /usr/local/lib; do
        if [[ -f "$prefix/$libname" ]]; then
          echo "$prefix/$libname"
          return 0
        fi
      done
      echo "error: could not resolve $dep referenced by $(basename "$referrer")" >&2
      return 1
      ;;
    @loader_path/*|@executable_path/*)
      local libname="${dep##*/}"
      local dir
      dir=$(dirname "$referrer")
      if [[ -f "$dir/$libname" ]]; then
        echo "$dir/$libname"
        return 0
      fi
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
  if [[ -f "$STAGE/$dest_name" ]]; then
    return
  fi
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
    if is_system_lib "$dep"; then
      continue
    fi
    local base
    base=$(basename "$dep")
    if [[ "$base" == "$self" ]]; then
      continue
    fi
    if [[ -f "$STAGE/$base" ]]; then
      continue
    fi
    local resolved
    resolved=$(resolve_dep "$dep" "$file") || continue
    copy_one "$resolved" "$base"
    walk_deps "$STAGE/$base"
  done < <(otool -L "$file" | awk 'NR>1 {print $1}')
}

for tool in ffmpeg ffprobe; do
  bin=$(command -v "$tool" 2>/dev/null) || {
    echo "error: $tool not found on PATH" >&2
    exit 1
  }
  copy_one "$bin" "$tool"
done

walk_deps "$STAGE/ffmpeg"
walk_deps "$STAGE/ffprobe"

# Strip Homebrew's signatures up front so install_name_tool doesn't whine.
# We re-sign with ad-hoc identities at the end; Apple Silicon kernel kills
# any binary that lacks a valid signature.
for file in "$STAGE"/*; do
  codesign --remove-signature "$file" 2>/dev/null || true
done

# Rewrite install names so every reference resolves via @loader_path/<basename>.
for file in "$STAGE"/*; do
  base=$(basename "$file")
  if [[ "$file" == *.dylib ]]; then
    # Some Homebrew dylibs have a __LINKEDIT layout that install_name_tool
    # refuses to rewrite. Try a quick `strip -x` compaction before retrying;
    # if it still fails, fall through (most such libs are optional ffmpeg
    # features that the encode path never touches).
    if ! install_name_tool -id "@loader_path/$base" "$file" 2>/dev/null; then
      strip -x "$file" 2>/dev/null || true
      install_name_tool -id "@loader_path/$base" "$file" 2>/dev/null || true
    fi
  fi
  while IFS= read -r dep; do
    if is_system_lib "$dep"; then
      continue
    fi
    depbase=$(basename "$dep")
    if [[ "$depbase" == "$base" ]]; then
      continue
    fi
    install_name_tool -change "$dep" "@loader_path/$depbase" "$file" 2>/dev/null || true
  done < <(otool -L "$file" | awk 'NR>1 {print $1}')
done

# Re-sign with an ad-hoc identity so the kernel will execute them.
for file in "$STAGE"/*; do
  codesign --force --sign - "$file" 2>/dev/null || true
done

count=$(ls "$STAGE" | wc -l | tr -d ' ')
size=$(du -sh "$STAGE" | awk '{print $1}')
echo "Staged $count files ($size) in $STAGE"

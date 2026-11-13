#!/bin/sh
# Bundle tools/browser_bench.ts for the browser, serve it with the drawing,
# and drive Chrome through Playwright (installed in apps/livecode-tldraw).
#   tools/browser_bench.sh [out-dir] [--headed] [query e.g. "scale=1&frames=30&merge=vanilla"]
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
PROJECT=$(cd "$HERE/.." && pwd)
OUT="$PROJECT/.output/browser"
HEADED=""
QUERY=""
for arg in "$@"; do
  case "$arg" in
    --headed) HEADED=1 ;;
    *=*) QUERY="$arg" ;;
    *) OUT="$arg" ;;
  esac
done
mkdir -p "$OUT"
cp "$PROJECT/data/drawing/radiance-cascades_shapes.json" "$OUT/scene.json"
# Bundle from apps/deno-notebooks, whose config maps the engine aliases.
(cd "$PROJECT/../../../deno-notebooks" && deno bundle --config deno.json --platform browser \
  --output "$OUT/bench.js" "$HERE/browser_bench.ts")
cat > "$OUT/index.html" <<HTML
<!doctype html><meta charset="utf-8"><title>radiance cascades browser bench</title>
<pre id="out"></pre><script type="module" src="./bench.js"></script>
HTML
HEADED=$HEADED QUERY=$QUERY OUT=$OUT node "$HERE/browser_bench_driver.mjs"

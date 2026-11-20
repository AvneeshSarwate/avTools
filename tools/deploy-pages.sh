#!/usr/bin/env bash
# Build the browser apps as static sites and publish them to GitHub Pages.
#
#   tools/deploy-pages.sh               build, then push to the gh-pages branch
#   tools/deploy-pages.sh --build-only  build into .pages-build/ and stop
#
# The site is served from the gh-pages branch (repo Settings > Pages > Deploy
# from a branch > gh-pages, / root). Each deploy replaces that branch with a
# single commit, so build output never accumulates in the repository history.
#
# To add an app, append its directory name under apps/ to APPS. It must be a
# Vite project whose asset URLs survive a --base sub-path.
set -euo pipefail

# music-runners also builds as a static site, but its tldraw canvas needs a
# licence key once deployed; add it back here when the key is in place.
APPS=(fm-explainer)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/.pages-build"
REMOTE="$(git -C "$ROOT" remote get-url origin)"
# Project pages live under /<repo>/. Override for a custom domain: PAGES_BASE=/
REPO_NAME="$(basename "${REMOTE%.git}")"
BASE="${PAGES_BASE:-/$REPO_NAME/}"

rm -rf "$OUT"
mkdir -p "$OUT"

for app in "${APPS[@]}"; do
  echo "== building $app =="
  (
    cd "$ROOT/apps/$app"
    [ -d node_modules ] || npm ci
    npx vite build --base "$BASE$app/" --outDir "$OUT/$app" --emptyOutDir
  )
done

if [[ " ${APPS[*]} " == *" music-runners "* ]] && ! grep -qs '^VITE_TLDRAW_LICENSE_KEY=.' "$ROOT/apps/music-runners/.env.local" "$ROOT/apps/music-runners/.env.production.local" \
   && [ -z "${VITE_TLDRAW_LICENSE_KEY:-}" ]; then
  echo "warning: no VITE_TLDRAW_LICENSE_KEY set; the deployed music-runners canvas will stop rendering after a few seconds." >&2
  echo "         put the key in apps/music-runners/.env.local (git-ignored)." >&2
fi

{
  echo '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  echo '<meta name="viewport" content="width=device-width, initial-scale=1">'
  echo "<title>$REPO_NAME</title>"
  echo '<style>body{font:16px/1.6 Georgia,serif;max-width:32rem;margin:4rem auto;padding:0 1rem}a{color:inherit}</style>'
  echo "</head><body><h1>$REPO_NAME</h1><ul>"
  for app in "${APPS[@]}"; do echo "<li><a href=\"$app/\">$app</a></li>"; done
  echo '</ul></body></html>'
} > "$OUT/index.html"
# Serve files as they are, without GitHub's Jekyll pass.
touch "$OUT/.nojekyll"

if [ "${1:-}" = "--build-only" ]; then
  echo "built into $OUT (served under $BASE)"
  exit 0
fi

SHA="$(git -C "$ROOT" rev-parse --short HEAD)"
cd "$OUT"
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C "$ROOT" config user.name)" -c user.email="$(git -C "$ROOT" config user.email)" \
  commit -q -m "Deploy $SHA"
git push --force "$REMOTE" gh-pages
cd "$ROOT"
rm -rf "$OUT"
echo "deployed $SHA to gh-pages"

#!/usr/bin/env bash
set -euo pipefail

seed_root=/opt/avtools-seed
workspace_root=/workspace/avTools
persistent_root=/data/livecode
persistent_repo="$persistent_root/repo"
claude_state_root="$persistent_root/claude"
codex_state_root="$persistent_root/codex"
ssh_state_root="$persistent_root/ssh"
runtime_state_root=/workspace/.livecode-runtime
claude_status_file="$runtime_state_root/claude-status"
keepalive_status_file="$persistent_root/keepalive-status"
repo_persist_lock="$runtime_state_root/repo-persist.lock"
credential_persist_lock="$runtime_state_root/credential-persist.lock"

mkdir -p \
  /data/sessions \
  "$persistent_repo" \
  "$claude_state_root" \
  "$codex_state_root" \
  "$ssh_state_root" \
  "$runtime_state_root" \
  /root/.claude \
  /root/.codex \
  /root/.ssh \
  /workspace

# Always run on the container's local disk so Vite's file watcher and HMR have
# normal filesystem semantics. R2 is the durable mirror, not the live cwd.
mkdir -p "$workspace_root"
rsync --archive --delete "$seed_root/" "$workspace_root/"

repo_sync_args=(
  --archive
  --delete
  --exclude=node_modules
  --exclude=.vite
  --exclude=.cache
  --exclude=.deno
  --exclude=.venv
  --exclude=venv
  --exclude=target
  --exclude=coverage
  --exclude=dist
  --exclude=build
  --exclude=out
  --exclude=.wrangler
  --exclude=.avtools-livecode-sessions
  --exclude=.livecode-runtime
  --exclude='*.log'
  --exclude=.env
  --exclude='.env.*'
  --exclude=.DS_Store
  --exclude=/apps/browser-projections/public/block_rocking.mp4
  --exclude=/apps/browser-projections/reaction-diffusion-webgl
  --exclude=/apps/deno-notebooks/examples/hanoiShow/bundle/macos/HanoiShow.app
  --exclude=/apps/deno-notebooks/examples/hanoiShow/bundle/macos/staging
  --exclude=/apps/deno-notebooks/examples/hanoiShow/bundle/macos/staging_assets
  --exclude=/apps/deno-notebooks/examples/hanoiShow/bundle/macos/staging_bin
  --exclude=/encoder-gui/bundle/macos/staging
)

if [[ -d "$persistent_repo/.git" ]]; then
  echo "[livecode] restoring the persisted Git workspace from R2"
  rsync "${repo_sync_args[@]}" "$persistent_repo/" "$workspace_root/"
else
  echo "[livecode] first boot; the baked Git workspace will seed R2"
fi

# R2 is authoritative so a container rollout cannot silently overwrite an
# agent's work. Release migrations are consequently opt-in and guarded by the
# exact hash from the prior image: promote the baked file only when the remote
# copy is still untouched; otherwise preserve it and report the divergence.
promote_seed_file_if_unmodified() {
  local relative_path=$1
  local prior_sha256=$2
  local workspace_file="$workspace_root/$relative_path"
  local seed_file="$seed_root/$relative_path"
  local current_sha256

  if cmp -s "$workspace_file" "$seed_file"; then
    return
  fi
  if [[ ! -f "$workspace_file" ]]; then
    echo "[livecode] preserving missing remote file: $relative_path" >&2
    return
  fi
  current_sha256=$(sha256sum "$workspace_file" | cut -d ' ' -f 1)
  if [[ "$current_sha256" == "$prior_sha256" ]]; then
    echo "[livecode] promoting image update: $relative_path"
    cp --preserve=mode,timestamps "$seed_file" "$workspace_file"
  else
    echo "[livecode] preserving remotely edited file: $relative_path" >&2
  fi
}

# 2026-08-26: allow query strings at Vite proxy route boundaries so the Deno
# LSP WebSocket (`/lsp?session=...`) reaches port 7777. The debug/test updates
# make readiness part of the browser E2E contract.
promote_seed_file_if_unmodified \
  apps/livecode-tldraw/vite.config.ts \
  f935d3c029a7802fc45b164eb48fb64aa47e52c1f96c5f2464d6d5658689d5c7
promote_seed_file_if_unmodified \
  apps/livecode-tldraw/src/livecodeTldrawDebug.ts \
  bbfd90f7f0b998d8f0f2b456b59f435530749bac2a9a79ba7e33b074f7fcdb3e
promote_seed_file_if_unmodified \
  apps/livecode-tldraw/tests/livecodeTldraw.e2e.mjs \
  31a8cf4dcf00c1a7f601ece3871914e3ce4879a67eab59343d37d4ca425d4ca8

# 2026-08-27: keep the disposable browser-engine host bundle on local disk
# instead of the R2 FUSE mount, and build it in the background after startup.
promote_seed_file_if_unmodified \
  apps/deno-notebooks/livecode/visualizer/server.ts \
  48a123778136bcbc5fc578606a2b4c15def1e1aca62990a43e2b46b71dd554cd
promote_seed_file_if_unmodified \
  apps/deno-notebooks/livecode/visualizer/main.ts \
  96dde58a65321b5ccd2cb8a334e9f1685d1529d3c1bec136452f8f798aa3f846

rsync --archive "$claude_state_root/" /root/.claude/
rsync --archive "$codex_state_root/" /root/.codex/
rsync --archive "$ssh_state_root/" /root/.ssh/
chmod 0700 /root/.claude /root/.codex /root/.ssh
find /root/.claude /root/.codex /root/.ssh -type f -exec chmod 0600 {} +
if [[ ! -f "$keepalive_status_file" ]]; then
  printf 'false\n' > "$keepalive_status_file"
fi

# If an agent changed either lockfile since this image was built, reconcile the
# local dependency tree before starting Vite. The normal case is instant.
if ! cmp -s \
  "$seed_root/apps/livecode-tldraw/package-lock.json" \
  "$workspace_root/apps/livecode-tldraw/package-lock.json"; then
  npm ci --prefix "$workspace_root/apps/livecode-tldraw"
fi
if ! cmp -s \
  "$seed_root/apps/browser-projections/package-lock.json" \
  "$workspace_root/apps/browser-projections/package-lock.json"; then
  npm ci --prefix "$workspace_root/apps/browser-projections"
  npm --prefix "$workspace_root/apps/browser-projections" run buildPianoRoll
  npm --prefix "$workspace_root/apps/browser-projections" run buildAnimationEditor
fi

persist_repo() {
  flock --wait 120 "$repo_persist_lock" \
    rsync "${repo_sync_args[@]}" "$workspace_root/" "$persistent_repo/"
}

persist_credentials() {
  (
    flock --wait 120 9
    rsync --archive --delete /root/.claude/ "$claude_state_root/"
    rsync --archive --delete /root/.codex/ "$codex_state_root/"
    rsync --archive --delete /root/.ssh/ "$ssh_state_root/"
  ) 9> "$credential_persist_lock"
}

persist_all() {
  echo "[livecode] persisting workspace and credentials to R2"
  persist_repo || echo "[livecode] workspace persistence failed" >&2
  persist_credentials || echo "[livecode] credential persistence failed" >&2
}

repo_persist_loop() {
  while true; do
    persist_repo || echo "[livecode] workspace persistence failed; retrying" >&2
    sleep 30
  done
}

credential_watch_loop() {
  while true; do
    # Watch the top level where the three authentication files live. A timeout
    # is intentional: it gives us a periodic fallback if inotify misses an
    # atomic replacement or a watcher is interrupted by a tool update.
    if inotifywait -qq -t 30 \
      -e close_write,create,delete,move \
      /root/.claude /root/.codex /root/.ssh; then
      sleep 1
    fi
    persist_credentials ||
      echo "[livecode] credential persistence failed; retrying" >&2
  done
}

remote_control_loop() {
  while true; do
    if [[ ! -s /root/.claude/.credentials.json ]]; then
      printf 'needs-auth\n' > "$claude_status_file"
      sleep 5
      continue
    fi

    printf 'online\n' > "$claude_status_file"
    set +e
    claude remote-control \
      --name livecode-cloud \
      --spawn same-dir \
      --capacity 1 \
      --verbose \
      >> /data/livecode/claude-remote-control.log 2>&1
    remote_control_exit=$?
    set -e
    printf 'exited:%s\n' "$remote_control_exit" > "$claude_status_file"
    sleep 5
  done
}

shutdown() {
  trap - TERM INT EXIT
  for process_id in \
    "${repo_persist_pid:-}" \
    "${credential_watch_pid:-}" \
    "${remote_control_pid:-}" \
    "${deno_pid:-}" \
    "${vite_pid:-}"; do
    if [[ -n "$process_id" ]]; then
      kill "$process_id" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
  persist_all
}
trap shutdown TERM INT EXIT

repo_persist_loop &
repo_persist_pid=$!
credential_watch_loop &
credential_watch_pid=$!
remote_control_loop &
remote_control_pid=$!

cd "$workspace_root"
deno run \
  --unstable-webgpu \
  --unstable-ffi \
  --allow-all \
  apps/deno-notebooks/livecode/visualizer/main.ts \
  --host 127.0.0.1 \
  --port 7777 \
  --engine remote \
  --prewarm-browser-host \
  --projects-root apps/livecode-tldraw/example-projects \
  --session-root /data/sessions \
  --log-level info &
deno_pid=$!

until curl --fail --silent http://127.0.0.1:7777/health >/dev/null; do
  if ! kill -0 "$deno_pid" 2>/dev/null; then
    wait "$deno_pid"
  fi
  sleep 1
done

LIVECODE_SERVER_TARGET=http://127.0.0.1:7777 \
  npm --prefix apps/livecode-tldraw run dev -- \
    --host 0.0.0.0 \
    --port 5173 \
    --strictPort &
vite_pid=$!

wait -n "$deno_pid" "$vite_pid"

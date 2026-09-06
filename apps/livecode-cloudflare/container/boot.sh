#!/usr/bin/env bash
set -euo pipefail

seed_root=/opt/avtools-seed
workspace_root=/workspace/avTools
persistent_root=/data/livecode
persistent_repo="$persistent_root/repo"
repo_snapshot_marker="$persistent_root/repo-snapshot-complete"
claude_state_root="$persistent_root/claude"
codex_state_root="$persistent_root/codex"
ssh_state_root="$persistent_root/ssh"
runtime_state_root=/workspace/.livecode-runtime
boot_status_file="$runtime_state_root/boot-status.json"
claude_status_file="$runtime_state_root/claude-status"
keepalive_status_file="$persistent_root/keepalive-status"
repo_persist_lock="$runtime_state_root/repo-persist.lock"
credential_persist_lock="$runtime_state_root/credential-persist.lock"

mkdir -p \
  "$claude_state_root" \
  "$codex_state_root" \
  "$ssh_state_root" \
  "$runtime_state_root" \
  /root/.claude \
  /root/.codex \
  /root/.ssh \
  /workspace

boot_phase=initializing
boot_started_ms=$(date +%s%3N)
phase_started_ms=$boot_started_ms
write_boot_status() {
  local phase=$1
  local detail=${2:-}
  local updated_at
  local temporary_file="${boot_status_file}.tmp.$$"

  local now_ms
  now_ms=$(date +%s%3N)
  printf '{"component":"livecode-boot","event":"phase.completed","phase":"%s","durationMs":%s,"elapsedMs":%s}\n' \
    "$boot_phase" "$((now_ms - phase_started_ms))" "$((now_ms - boot_started_ms))" \
    | tee -a "$runtime_state_root/boot-timings.jsonl"
  boot_phase=$phase
  phase_started_ms=$now_ms
  updated_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  if [[ -n "$detail" ]]; then
    printf '{"phase":"%s","detail":"%s","updatedAt":"%s"}\n' \
      "$phase" "$detail" "$updated_at" > "$temporary_file"
  else
    printf '{"phase":"%s","updatedAt":"%s"}\n' \
      "$phase" "$updated_at" > "$temporary_file"
  fi
  mv "$temporary_file" "$boot_status_file"
}

write_boot_status initializing

# Credentials are independent of the worktree. Start their restore now, but
# join it before any credential watcher, agent, or ready/terminal access.
(
  credential_started_ms=$(date +%s%3N)
  rsync --archive "$claude_state_root/" /root/.claude/
  rsync --archive "$codex_state_root/" /root/.codex/
  rsync --archive "$ssh_state_root/" /root/.ssh/
  chmod 0700 /root/.claude /root/.codex /root/.ssh
  find /root/.claude /root/.codex /root/.ssh -type f -exec chmod 0600 {} +
  credential_finished_ms=$(date +%s%3N)
  printf '{"event":"credentials.restored","durationMs":%s,"elapsedMs":%s}\n' \
    "$((credential_finished_ms - credential_started_ms))" "$((credential_finished_ms - boot_started_ms))" \
    | tee -a "$runtime_state_root/boot-timings.jsonl"
) &
credential_restore_pid=$!
# Early workspace failures must not leave a restore running. No credential
# persistence starts until the successful join below.
trap 'kill "$credential_restore_pid" 2>/dev/null || true; wait "$credential_restore_pid" 2>/dev/null || true' EXIT

# The image already contains the workspace at its final path. Restore only
# source; baked dependency trees never need a second copy on wake.
write_boot_status restoring_workspace
mkdir -p "$workspace_root"

repo_copy_args=(
  --archive
  --exclude-from=/opt/livecode/repo-excludes.txt
)

checkpoint_restore_exit=0
node /opt/livecode/checkpoint.mjs restore \
  "$workspace_root" "$persistent_root" "$runtime_state_root" || checkpoint_restore_exit=$?
if [[ "$checkpoint_restore_exit" -eq 0 ]]; then
  echo "[livecode] packed workspace restored"
elif [[ "$checkpoint_restore_exit" -ne 3 ]]; then
  write_boot_status failed checkpoint_restore_failed
  exit "$checkpoint_restore_exit"
elif [[ -d "$persistent_repo/.git" && -f "$repo_snapshot_marker" ]]; then
  write_boot_status restoring_workspace
  echo "[livecode] restoring the persisted Git workspace from R2"
  rsync "${repo_copy_args[@]}" --delete "$persistent_repo/" "$workspace_root/"
elif [[ -d "$persistent_repo/.git" ]]; then
  write_boot_status recovering_workspace
  echo "[livecode] recovering files from an incomplete R2 snapshot" >&2
  # A prior container may have stopped midway through its first R2 upload.
  # Preserve the baked Git metadata and all baked files that never reached R2,
  # while salvaging any worktree files that did make it into the snapshot.
  rsync "${repo_copy_args[@]}" --exclude=.git \
    "$persistent_repo/" "$workspace_root/"
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

write_boot_status waiting_for_credentials
if ! wait "$credential_restore_pid"; then
  write_boot_status failed credential_restore_failed
  exit 1
fi
trap - EXIT
if [[ ! -f "$keepalive_status_file" ]]; then
  printf 'false\n' > "$keepalive_status_file"
fi

# If an agent changed either lockfile since this image was built, reconcile the
# local dependency tree before starting Vite. The normal case is instant.
write_boot_status reconciling_dependencies
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
  npm --prefix "$workspace_root/apps/browser-projections" run buildCanvas
fi

persist_repo() {
  (
    flock --wait 120 9 || exit 1
    node /opt/livecode/checkpoint.mjs save \
      "$workspace_root" "$persistent_root" "$runtime_state_root"
  ) 9> "$repo_persist_lock"
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
  local exit_code=$?
  trap - TERM INT EXIT
  set +e
  if [[ "$exit_code" -eq 0 ]]; then
    write_boot_status stopping
  elif [[ "$boot_phase" != failed ]]; then
    write_boot_status failed "supervisor_exit_${exit_code}"
  fi
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
  if [[ "${boot_reached_ready:-false}" == true ]]; then
    persist_all
  else
    echo "[livecode] skipping workspace persistence because boot never reached ready" >&2
    persist_credentials || echo "[livecode] credential persistence failed" >&2
  fi
  exit "$exit_code"
}

terminate() {
  exit 143
}

interrupt() {
  exit 130
}

fail_if_exited() {
  local process_id=$1
  local process_name=$2
  local exit_code

  if kill -0 "$process_id" 2>/dev/null; then
    return
  fi

  set +e
  wait "$process_id"
  exit_code=$?
  set -e
  if [[ "$exit_code" -eq 0 ]]; then
    exit_code=1
  fi
  write_boot_status failed "${process_name}_exited_${exit_code}"
  echo "[livecode] ${process_name} exited before startup completed (${exit_code})" >&2
  exit "$exit_code"
}

trap terminate TERM
trap interrupt INT
trap shutdown EXIT

write_boot_status starting_background_services
credential_watch_loop &
credential_watch_pid=$!
remote_control_loop &
remote_control_pid=$!

cd "$workspace_root"
write_boot_status starting_services
export LIVECODE_BROWSER_HOST_BAKED_CACHE=/opt/livecode/browser-host-cache
export LIVECODE_BROWSER_HOST_CACHE="$persistent_root/browser-host-cache"
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
  --session-root /workspace/.livecode-runtime/sessions \
  --log-level info &
deno_pid=$!

LIVECODE_SERVER_TARGET=http://127.0.0.1:7777 \
  npm --prefix apps/livecode-tldraw run dev -- \
    --host 0.0.0.0 \
    --port 5173 \
    --strictPort &
vite_pid=$!

deno_ready=false
vite_ready=false
until [[ "$deno_ready" == true && "$vite_ready" == true ]]; do
  fail_if_exited "$deno_pid" deno
  fail_if_exited "$vite_pid" vite
  if [[ "$deno_ready" == false ]] && curl --max-time 1 --fail --silent http://127.0.0.1:7777/health >/dev/null; then
    deno_ready=true
    echo "{\"event\":\"deno.ready\",\"elapsedMs\":$(($(date +%s%3N) - boot_started_ms))}" | tee -a "$runtime_state_root/boot-timings.jsonl"
  fi
  if [[ "$vite_ready" == false ]] && curl --max-time 1 --fail --silent http://127.0.0.1:5173/projects.html >/dev/null; then
    vite_ready=true
    echo "{\"event\":\"vite.ready\",\"elapsedMs\":$(($(date +%s%3N) - boot_started_ms))}" | tee -a "$runtime_state_root/boot-timings.jsonl"
  fi
  if [[ "$deno_ready" == false || "$vite_ready" == false ]]; then sleep 0.25; fi
done
write_boot_status ready
boot_reached_ready=true

repo_persist_loop &
repo_persist_pid=$!

set +e
wait -n "$deno_pid" "$vite_pid"
service_exit=$?
set -e
if [[ "$service_exit" -eq 0 ]]; then
  service_exit=1
fi
write_boot_status failed "service_exited_${service_exit}"
echo "[livecode] a required service exited (${service_exit})" >&2
exit "$service_exit"

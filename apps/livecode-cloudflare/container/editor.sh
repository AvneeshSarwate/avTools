#!/usr/bin/env bash
set -euo pipefail
umask 077

runtime=/workspace/.livecode-runtime
state="$runtime/editor-state"
checkpoint_runtime="$runtime/editor-checkpoint"
bucket=/data/livecode/editor
mkdir -p "$runtime"
# Concurrent browser requests/Worker replacements cannot launch two editors.
exec 9> "$runtime/editor.lock"
flock --nonblock 9 || exit 0
mkdir -p "$state/user-data" "$state/extensions" "$checkpoint_runtime"

# Restore only once per container lifetime. An editor process restart must not
# overwrite changes that have not reached the periodic checkpoint yet.
if [[ ! -f "$runtime/editor-restored" ]]; then
  node /opt/livecode/editor-state.mjs restore "$state" "$bucket" "$checkpoint_runtime"
  touch "$runtime/editor-restored"
fi

persist() {
  (flock --wait 120 8 || exit 1
   node /opt/livecode/editor-state.mjs save "$state" "$bucket" "$checkpoint_runtime"
  ) 8> "$runtime/editor-persist.lock"
}
persist_loop() {
  while true; do
    sleep 30
    persist || echo '[livecode-editor] checkpoint failed; retrying' >&2
  done
}
shutdown() {
  local code=$?
  trap - EXIT TERM INT
  if [[ -n "${editor_pid:-}" ]]; then
    kill "$editor_pid" 2>/dev/null || true
    wait "$editor_pid" 2>/dev/null || true
  fi
  # The loop has fd 9 closed, so a lingering upload cannot retain the singleton
  # lock. The separate persistence lock serializes it with this final save.
  kill "${persist_pid:-}" 2>/dev/null || true
  persist || echo '[livecode-editor] final checkpoint failed' >&2
  exit "$code"
}
trap shutdown EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

# No public port exposure: the Worker routes this service behind Access.
# Keep origin checks enabled and disable the additional arbitrary-port proxy.
code-server \
  --config /dev/null \
  --bind-addr 0.0.0.0:8080 --auth none \
  --disable-telemetry --disable-update-check --disable-proxy \
  --user-data-dir "$state/user-data" --extensions-dir "$state/extensions" \
  /workspace/avTools >> "$runtime/editor.log" 2>&1 9>&- &
editor_pid=$!
persist_loop 9>&- &
persist_pid=$!
wait "$editor_pid"

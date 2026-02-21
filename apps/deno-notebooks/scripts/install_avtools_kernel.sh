#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TEMPLATE_PATH="$REPO_ROOT/apps/deno-notebooks/kernels/avtools-deno-unstable/kernel.json.template"

if ! command -v deno >/dev/null 2>&1; then
  echo "deno not found on PATH. Please install Deno first."
  exit 1
fi

if [ ! -f "$TEMPLATE_PATH" ]; then
  echo "kernel template not found: $TEMPLATE_PATH"
  exit 1
fi

DENO_PATH="$(command -v deno)"
VENV_JUPYTER_UNIX="$REPO_ROOT/apps/deno-notebooks/.venv/bin/jupyter"
VENV_JUPYTER_WIN="$REPO_ROOT/apps/deno-notebooks/.venv/Scripts/jupyter"
if [ -x "$VENV_JUPYTER_UNIX" ]; then
  JUPYTER_BIN="$VENV_JUPYTER_UNIX"
elif [ -x "$VENV_JUPYTER_WIN" ] || [ -x "${VENV_JUPYTER_WIN}.exe" ]; then
  JUPYTER_BIN="$VENV_JUPYTER_WIN"
else
  JUPYTER_BIN="$(command -v jupyter || true)"
fi

if [ -z "$JUPYTER_BIN" ]; then
  echo "jupyter not found. Expected venv at $REPO_ROOT/apps/deno-notebooks/.venv or a global install."
  echo "Install with: (cd apps/deno-notebooks && uv venv --seed && uv pip install jupyterlab)"
  exit 1
fi

if ! JUPYTER_DATA_DIR="$("$JUPYTER_BIN" --data-dir 2>&1)"; then
  echo "jupyter failed to run at: $JUPYTER_BIN"
  echo "Output: $JUPYTER_DATA_DIR"
  echo "If the repo moved, recreate the venv:"
  echo "  (cd apps/deno-notebooks && rm -rf .venv && uv venv --seed && uv pip install jupyterlab)"
  exit 1
fi
KERNEL_DIR="$JUPYTER_DATA_DIR/kernels/avtools-deno-unstable"

mkdir -p "$KERNEL_DIR"

python - "$TEMPLATE_PATH" "$DENO_PATH" "$REPO_ROOT" "$KERNEL_DIR" <<'PY'
import pathlib, sys
template_path, deno_path, repo_root, kernel_dir = sys.argv[1:5]
template = pathlib.Path(template_path).read_text()
template = template.replace("__DENO_PATH__", deno_path)
template = template.replace("__REPO_ROOT__", repo_root)
path = pathlib.Path(kernel_dir) / "kernel.json"
path.write_text(template)
print(f"Installed kernel to {path}")
PY

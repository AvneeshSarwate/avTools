
# Deno + VS Code Notebooks (TypeScript) with uv-managed Jupyter + IntelliSense for local imports

This repo is set up so you can:
- Edit a **standard `.ipynb` notebook** in **VS Code**
- Run cells using the **Deno Jupyter kernel**
- Get **IntelliSense/type-checking** for **local TypeScript modules** you import from the repo
- Use only **official VS Code tooling** (Microsoft Jupyter + official Deno extension)

---

## What lives where

- **Python + Jupyter**: installed into a **project-local** virtual environment created by **uv** at `./.venv/`
- **Deno**: installed on your system (available on `PATH`)
- **VS Code**:
  - Uses your project `.venv` as the **Python interpreter** for notebook plumbing
  - Uses the **Deno kernel** to execute notebook cells
  - Uses the **official Deno extension** for IntelliSense/typechecking

---

## Prerequisites

- `uv` installed and on `PATH`
- `deno` installed and on `PATH`
- VS Code installed
- Rust (and cargo) installed

VS Code extensions:
- **Jupyter** (Microsoft)
- **Deno** (official: `denoland.vscode-deno`)
- (Recommended) **Python** (helps VS Code select the `.venv` interpreter)
- There is a .vscode/settings.json in the repo that sets the necessary extension settings

---

# One-time setup (do this once per machine/user OR when rebuilding the environment)

## 1a) Create the project venv with uv + install Jupyter

From the repo root:

```bash
uv python install 3.12
uv venv --seed
uv pip install jupyterlab
```

This creates `./.venv/` and installs Jupyter into it.

## 1b) (Optional) Build the Rust backed fast_sleep helper library

From the repo root:

```bash
cargo build --release --manifest-path native/fastsleep/Cargo.toml
```

## 1c) Build the MIDI bridge native library

From the repo root:

```bash
./scripts/build_midi_bridge.sh
```

This builds the native library into `./native/midi_bridge/target/release/` for Deno FFI to load.

> **Ableton Live + IAC Driver note:** The `midir` Rust crate sends CoreMIDI packets with a
> timestamp of `0` by default. Ableton Live doesn't route zero-timestamped MIDI to tracks
> (the MIDI indicator flashes but no sound plays). The `Cargo.toml` enables the
> `coremidi_send_timestamped` feature flag on `midir` to fix this. If you see MIDI activity
> in Ableton but hear nothing, make sure the library was built with this feature enabled.
> Other DAWs (Bitwig, Reaper) and MIDI Monitor are unaffected.
> See [midir#94](https://github.com/Boddlnagg/midir/issues/94) for details.

## 1d) Cache Deno dependencies

Install/cache all Deno dependencies (including npm packages) from `deno.json`:

```bash
deno install
```

Or use the provided task:

```bash
deno task install
```

This downloads and caches packages like `node-osc` and other dependencies.

## 2) Install the avtools Deno Jupyter kernel (required for WebGPU windowing)

You must run this at least once so Jupyter/VS Code can see the **avtools Deno kernel**.
We use a **custom kernelspec** because Deno’s built-in `deno jupyter --install` does **not**
include the `--unstable-webgpu` flag. Without that flag, `Deno.UnsafeWindowSurface` is
missing, so windowed WebGPU examples fail (headless WebGPU still works).

From the repo root:

```bash
bash apps/deno-notebooks/scripts/install_avtools_kernel.sh
```

This installs a kernel named **“Deno (avtools unstable)”** that starts with
`deno jupyter --unstable-webgpu ...`.

> Note: As of current Deno behavior, the Deno Jupyter kernel executes with broad permissions
> (often `--allow-all`). Treat notebooks as fully trusted code.

## 3) Initialize Deno workspace settings in VS Code (recommended)

Open the repo folder in VS Code, then:

* Command Palette → **Deno: Initialize Workspace Configuration**

This creates/updates `.vscode/settings.json` so VS Code uses Deno’s language server for TypeScript in this workspace.

---

# Daily workflow (do this each time you work in the repo)

These are the steps most folks new to Jupyter/VS Code notebooks miss.

## A) Open the repo folder (not a single file)

In VS Code: **File → Open Folder…** and choose the repo root.

## B) Activate the uv venv
run `source .venv/bin/activate` this allows you to pick the Python interpreter installed by uv for this project

## C) Select the Python interpreter (project venv)

This ensures VS Code’s Jupyter integration uses the right environment (the one that has Jupyter installed).

* Command Palette → **Python: Select Interpreter**
* Choose the interpreter inside `./.venv/`

  * macOS/Linux: `.venv/bin/python`
  * Windows: `.venv\Scripts\python.exe`

> You generally do **not** need to “activate” the venv in a terminal for VS Code notebooks if you’ve selected the interpreter here.
> Activating the venv is still useful when you run CLI commands in your shell.

## C) Open your notebook and select the kernel (Deno)

* Open/create a `.ipynb`
* In the notebook kernel picker (top right), select **Deno (avtools unstable)**

If you don’t see **Deno (avtools unstable)**, re-run:

```bash
bash apps/deno-notebooks/scripts/install_avtools_kernel.sh
```

## D) Edit + run cells

* Cells execute using the **Deno kernel**
* IntelliSense/type-checking comes from the **official Deno extension**

---

## Local TypeScript imports (for IntelliSense + reuse)

### 1) Prefer relative imports with explicit extensions

Deno works best with explicit file extensions:

```ts
import { foo } from "./src/foo.ts";
```

---

## Common troubleshooting

### Deno IntelliSense isn’t showing up

* Ensure you opened the **folder**, not just one file
* Command Palette → **Deno: Language Server Status** (confirm it’s running)
* Confirm `.vscode/settings.json` includes `"deno.enable": true` (the Initialize Workspace step sets this)

### Notebook runs Python instead of Deno

* In the notebook kernel picker, explicitly choose **Deno**

### “Deno (avtools unstable)” kernel isn’t available

* Re-run:

```bash
bash apps/deno-notebooks/scripts/install_avtools_kernel.sh
```

### Imports don’t resolve

* Use `./` / `../` imports with explicit `.ts` extensions, or
* If using `@/…`, confirm `"@/*": "./"` exists in `deno.json` and keep the `.ts` extension

---

## Handy commands

Run the dev task:

```bash
deno task dev
```

Re-install the avtools kernel (if needed):

```bash
bash apps/deno-notebooks/scripts/install_avtools_kernel.sh
```

# avTools – Unified Deno + Browser Workspace

This repo is a Deno‑workspace monorepo that unifies browser/Vite apps, Deno notebooks, shared TypeScript packages, and native Rust helpers. The goal is to make VSCode work “out of the box” across all environments (Deno LSP + TS/Vite) with minimal friction.

## High‑Level Layout

```
avTools/
├─ deno.json                 # Deno workspace + import map
├─ avtools.code-workspace    # Recommended VSCode multi‑root workspace
├─ packages/                 # Shared, Deno‑first TS libraries
│  ├─ core-timing/
│  ├─ creative-algs/
│  ├─ music-types/
│  ├─ ui-bridge/
│  ├─ power2d/
│  ├─ power2d-codegen/
│  └─ shader-fx/
├─ apps/
│  ├─ browser-projections/   # Vue + Vite web app
│  └─ deno-notebooks/        # Deno notebooks + Rust FFI libs
├─ tools/
│  ├─ vite-shader-plugin/    # Vite shader codegen wrapper
│  └─ shader-watch/          # Deno watcher for shader codegen
└─ webcomponents/            # Standalone webcomponent bundles
```

## Architecture Notes

- **Deno workspace first.** The root `deno.json` defines all workspace members and the import map. Shared packages are Deno‑native and are referenced via `@avtools/*`.
- **Browser app (Vue/Vite).** `apps/browser-projections` uses Vite and Vue. It aliases `@avtools/*` to the workspace packages so the browser app can import shared logic.
- **Deno notebooks.** `apps/deno-notebooks` contains TypeScript notebooks and helpers. It also includes Rust FFI libraries:
  - `native/fastsleep` – precise sleep for Deno
  - `native/midi_bridge` – MIDI I/O via `midir`
  - `native/deno_window` – windowed WebGPU surface for Deno
- **Power2D split.** Shader codegen lives in `packages/power2d-codegen`. The Vite plugin (`tools/vite-shader-plugin`) imports from that package directly.
- **ShaderFX split.** Babylon/WGSL + Babylon/GL post-processing runtime now lives in `packages/shader-fx`, with generated fragment wrappers emitted to `packages/shader-fx/generated`.
- **creative-algs** is a shared tools package used by both browser sketches and Deno notebooks.

## VSCode Setup (Recommended)

Open the workspace file:

```
avTools/avtools.code-workspace
```

This is configured to keep the Deno LSP enabled for the Deno packages + notebooks while letting the browser app use the standard TS/Vite tooling.

### Instant Deno‑Notebook Use (no manual kernel/interpreter picking)

To make “open VSCode → open a notebook → run” work without extra clicks, use the setup script:

```
./setup.sh
```

This installs toolchains (if missing), builds native helpers, caches Deno deps, creates the uv venv,
and installs the **custom avtools Deno kernel**.

If you want to do it manually instead, the minimal steps are:

1. Create the notebook venv with uv (inside `apps/deno-notebooks`):
   ```
   uv python install 3.12
   uv venv --seed
   uv pip install jupyterlab
   ```
2. Install the Deno Jupyter kernel:
   ```
   bash apps/deno-notebooks/scripts/install_avtools_kernel.sh
   ```
3. Open `avtools.code-workspace` in VSCode.

VSCode will usually auto‑detect the `.venv` and use it for Jupyter. If it does not:
- Set the interpreter to `apps/deno-notebooks/.venv/bin/python`
- In the notebook kernel picker, choose **Deno (avtools unstable)**

If you want this to be fully automatic for everyone, add a `.vscode/settings.json` with:
```
{
  "python.defaultInterpreterPath": "apps/deno-notebooks/.venv/bin/python",
  "python.terminal.activateEnvironment": true,
  "jupyter.jupyterServerType": "local"
}
```

## Build + Type Checking

### Browser app (Vue/Vite)

```
cd apps/browser-projections
npm install
npm run dev
npm run type-check
```

- `type-check` uses `vue-tsc` with `tsconfig.app.json`.
- Vite config uses `tools/vite-shader-plugin` for shader codegen.

### Deno notebooks and packages

From repo root:

```
deno check packages/core-timing/mod.ts \
  packages/creative-algs/mod.ts \
  packages/music-types/mod.ts \
  packages/ui-bridge/mod.ts \
  packages/power2d/mod.ts \
  packages/power2d-codegen/mod.ts \
  packages/shader-fx/mod.ts \
  tools/shader-watch/watch.ts
```

Notebook helpers live under `apps/deno-notebooks/tools/`.

### Rust FFI helpers (Deno notebooks)

```
cd apps/deno-notebooks
./scripts/build_midi_bridge.sh
cargo build --release --manifest-path native/fastsleep/Cargo.toml
cargo build --release --manifest-path native/deno_window/Cargo.toml
```

The Deno bindings look for compiled libs in:
```
apps/deno-notebooks/native/midi_bridge/target/release/
apps/deno-notebooks/native/fastsleep/target/release/
apps/deno-notebooks/native/deno_window/target/release/
```

## Publishing Shared Packages

Shared packages in `packages/` are Deno‑first and use `deno.json` for exports and versions. They can be published independently if desired.

## Notes on Imports

- Use `@avtools/*` for cross‑workspace imports.
- For Deno + Vite compatibility, use explicit `.ts` extensions for local relative imports inside packages.

## First‑Time Setup Checklist

Install:
- Node.js (recommended: 18+)
- Deno
- Rust (for MIDI + fastsleep helpers)
- Python 3.12 + `uv` (for Jupyter)

Then:
1. `./setup.sh`
2. `cd apps/browser-projections && npm install`

---

## Package Organization Notes

- Notebook test scripts and example `.ipynb` files now live under
  `apps/deno-notebooks/libraryIntegrationTetsts/` (moved from the
  `apps/deno-notebooks/` root).

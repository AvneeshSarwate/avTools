# avTools – Unified Deno + Browser Workspace

This repo is both a set of libraries and a specifically built project-setup for creative coding. It is a Deno‑workspace monorepo that unifies browser/Vite apps, Deno notebooks (aka Jupyter notebooks using the Deno kernel), shared TypeScript packages, and native Rust helpers. The goal is to create a set of Typescript based libraries for creative coding that can run both "natively" via Deno and/or also in the browser. The goal of the project setup in this repo is to make VSCode intellisense work “out of the box” across all environments (Deno files, jupyter notebooks).

### Why Deno (and notebooks?)
The purpose of integrating Deno is to allow for a first-class livecoding experience for sketching and prototyping. Deno comes out of the box with support for Jupyter Notebooks. checkout the examples in `apps/deno-notebooks/examples`

## First‑Time Setup Checklist

Requirements:
- `bash` (the setup script is a bash script)
- Internet access (to download toolchains and dependencies)

Run:
```
./setup.sh
```

If missing, `setup.sh` will install:
- Rust toolchain (via rustup)
- Deno
- uv (Python package manager)
- Node.js (via nvm)

Then it will:
- Build native Rust/FFI helpers
- Cache Deno dependencies
- Create the uv venv and install Jupyter
- Install the custom **Deno (avtools unstable)** Jupyter kernel
- Install npm dependencies for `apps/browser-projections`

After that:
1. Open `avtools.code-workspace` in VS Code - this should 

## VSCode Setup (Recommended)

Open the workspace file:

```
avTools/avtools.code-workspace
```

This is configured to keep the Deno LSP enabled for the Deno packages + notebooks while letting the browser app use the standard TS/Vite tooling.

When you open the repo in VS Code, you’ll be prompted to install the recommended extensions
(Deno, Jupyter, Python, Vue language server, Rust analyzer). These are listed in
`avTools/.vscode/extensions.json`.

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
└─ webcomponents/            # Standalone webcomponent bundles for UI that runs in the notebooks
```

## Architecture Notes

- **Deno workspace first.** The root `deno.json` defines all workspace members and the import map. Shared packages are Deno‑native and are referenced via `@avtools/*`.
- **Browser app (Vue/Vite).** `apps/browser-projections` uses Vite and Vue. It aliases `@avtools/*` to the workspace packages so the browser app can import shared logic.
- **Deno notebooks.** `apps/deno-notebooks` contains TypeScript notebooks and helpers. It also includes Rust FFI libraries:
  - `native/fastsleep` – precise sleep for Deno
  - `native/midi_bridge` – MIDI I/O via `midir`
  - `native/deno_window` – windowed WebGPU surface for Deno to display graphics
- **Power2D split.** Shader codegen lives in `packages/power2d-codegen`. The Vite plugin (`tools/vite-shader-plugin`) imports from that package directly.
- **ShaderFX split.** Babylon/WGSL + Babylon/GL post-processing runtime now lives in `packages/shader-fx`, with generated fragment wrappers emitted to `packages/shader-fx/generated`.
- **creative-algs** is a shared tools package used by both browser sketches and Deno notebooks.

## Notes on Imports

- Use `@avtools/*` for cross‑workspace imports.
- For Deno + Vite compatibility, use explicit `.ts` extensions for local relative imports inside packages.
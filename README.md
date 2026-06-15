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
- Build the piano-roll web component bundle used by livecode/tldraw views
- Install npm dependencies for `apps/livecode-tldraw`

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

## Standalone Builds

Two parts of the repo can be built as self-contained, double-clickable
macOS `.app` bundles — no Homebrew, no Deno on PATH, no other host setup
required. The build scripts walk the dylib chain, stage assets in
`Contents/Resources/`, and ad-hoc sign so the kernel will launch them.
Distribution outside the dev's own machine still needs a Developer ID
cert + notarization; see the per-app READMEs.

- **`encoder-gui/`** — Rust + egui frontend that drives `ffmpeg` to
  encode video into HAP / HAP-Q `.happack` files. The bundled `.app`
  ships its own `ffmpeg` + `ffprobe` and the full Homebrew dylib chain
  they need, so end users don't need ffmpeg installed.
  See [`encoder-gui/README.md`](encoder-gui/README.md).
  Build: `cd encoder-gui && bundle/macos/build-app.sh`.

- **`apps/deno-notebooks/examples/hanoiShow/`** — `combined_landscape.ts`
  packaged as a Deno-compiled binary plus the four FFI Rust dylibs
  (`deno_window`, `syphon_bridge`, `text_engine`, `midi_bridge`),
  `Syphon.framework`, fonts, the poem, and the tweakpane / perf-pane
  web bundles.
  See [`apps/deno-notebooks/examples/hanoiShow/README.md`](apps/deno-notebooks/examples/hanoiShow/README.md).
  Build: `cd apps/deno-notebooks && examples/hanoiShow/bundle/macos/build-app.sh`.

A shared pattern, `apps/deno-notebooks/bundle_paths.ts`, handles the
`deno compile` virtual-filesystem path mismatch by rewriting both
`Deno.dlopen` and asset URLs to `Contents/Resources/...` when the
binary is running compiled.

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

## Docs to Improve (TODO)

Most subtrees still lack a README. The two `.app`-bundle READMEs above
are the most recent and detailed; the rest of this list is a punch-card
of what's missing and what's stale, ordered roughly by how often you'd
want to read it.

### No README at all

- **Native crates** under `apps/deno-notebooks/native/`:
  `deno_window` (wry-based window + webview FFI),
  `text_engine` (HarfBuzz shaping FFI),
  `hap_decoder` (HAP frame decoder used by the encoder + browser
  projections), `push2_display` (Ableton Push 2 RGB display FFI),
  `fastsleep` (precise-sleep FFI).
- **Shared packages** under `packages/`: `core-timing`,
  `creative-algs`, `music-types`, `ui-bridge`, `power2d`,
  `power2d-codegen`, `shader-fx`, `shader-fx-codegen`,
  `compute-shader`, `compute-shader-codegen`, `codegen-common`.
- **Tools** under `tools/`: `vite-shader-plugin`, `shader-watch`.

### Exists but likely stale

- [`apps/browser-projections/README.md`](apps/browser-projections/README.md)
  — explicitly self-labelled "Documentation in progress, bugs
  guaranteed". The repo has grown a lot since.
- [`apps/browser-projections/src/pianoRoll/README.md`](apps/browser-projections/src/pianoRoll/README.md)
  — Oct 2025, may have drifted from the Konva implementation.
- [`apps/browser-projections/reaction-diffusion-webgl/README.md`](apps/browser-projections/reaction-diffusion-webgl/README.md)
  — Oct 2025, single-component, may still be accurate.
- [`webcomponents/README.md`](webcomponents/README.md) — short (15
  lines); components have grown since it was written.

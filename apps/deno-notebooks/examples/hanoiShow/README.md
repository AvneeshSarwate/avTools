# Hanoi Show (landscape)

`combined_landscape.ts` is the entry point — six per-scene P5GPU layers
alpha-composited into a single 1920×1080 frame, shipped over Syphon as
"Hanoi Show L" while a window also shows a scaled preview. Tweakpane +
perf-pane webviews are spawned via the `deno_window` (wry) FFI bridge.

## Run in development

```sh
cd apps/deno-notebooks
deno run --unstable-webgpu --unstable-ffi --allow-all \
  examples/hanoiShow/combined_landscape.ts
```

Requires the 4 FFI Rust crates under `apps/deno-notebooks/native/` to be
built (`cargo build --release` in each). External services that the
scenes expect (MediaPipe body-contour + hand-bbox WebSocket servers)
must be running separately if you want those features to do anything.

## Build a self-contained macOS `.app`

```sh
cd apps/deno-notebooks
examples/hanoiShow/bundle/macos/build-app.sh
```

Output: `examples/hanoiShow/bundle/macos/HanoiShow.app` (~840 MB).
Double-click to launch. Bundles the Deno runtime, all 4 FFI dylibs,
Syphon.framework, every TTF the scenes load, the tegaki glyph data, the
poem text, and the tweakpane + perf-pane web bundles.

### What the build script does

1. **`bundle/macos/stage-libs.sh`** — `cargo build --release` on each of
   `deno_window`, `syphon_bridge`, `text_engine`, `midi_bridge`. Recursively
   walks the dylib chain via `otool -L` (resolving `@rpath/...` through
   `LC_RPATH` entries), copies each non-system dep into `staging/`,
   rewrites every install name to `@loader_path/<basename>`, strips the
   pre-existing signatures and re-signs with ad-hoc identities (Apple
   Silicon kernel SIGKILLs unsigned binaries).

2. **Stage assets** — flattens every runtime-loaded file (`poem.txt`,
   `*.ttf`, `glyphData.json`, `tweakpane-client.js`, `perf-pane.js`) into
   `staging_assets/` keyed by basename. The runtime `resolveAsset()`
   helper maps these basenames back to `Contents/Resources/assets/`.

3. **`deno compile`** — produces a standalone binary with the entire TS
   graph embedded. `--allow-all --unstable-webgpu --unstable-ffi`.

4. **Assemble the `.app`** — writes a minimal `Info.plist`, drops the
   binary in `Contents/MacOS/`, dylibs + framework in
   `Contents/Resources/{,frameworks/}`, assets in
   `Contents/Resources/assets/`, ad-hoc signs the binary.

### Bundle layout

```
HanoiShow.app/
└── Contents/
    ├── Info.plist
    ├── MacOS/
    │   └── hanoishow                       # deno compile output
    └── Resources/
        ├── libdeno_window.dylib
        ├── libmidi_bridge.dylib
        ├── libsyphon_bridge.dylib
        ├── libtext_engine.dylib
        ├── frameworks/
        │   └── Syphon.framework            # see "Syphon quirk" below
        └── assets/
            ├── poem.txt
            ├── TorsilpYingyai.ttf
            ├── SOV_sannoga2467.ttf
            ├── SOV_sorm2496.ttf
            ├── charmonman.ttf
            ├── glyphData.json
            ├── InterVariable.ttf           # …and other system fonts
            ├── tweakpane-client.js
            └── perf-pane.js
```

## How `bundle_paths.ts` works

`deno compile` extracts the bundled TS sources to a per-process temp dir
like `/var/folders/.../T/deno-compile-hanoishow/...` and resolves
`import.meta.url` against it. Two consequences:

- `Deno.dlopen()` can't use those paths — the OS loader doesn't know
  about Deno's virtual FS.
- `Deno.readFile(new URL("./poem.txt", import.meta.url))` resolves to a
  path inside the virtual FS that doesn't contain assets we ship
  externally.

`apps/deno-notebooks/bundle_paths.ts` exports three helpers that detect
compile mode (`/deno-compile-` substring in `import.meta.url`) and
redirect to `<execPath>/../Resources/...`:

| Helper | Dev | Compiled |
|---|---|---|
| `resolveNativeLib(base, name)` | `new URL(name, base)` | `Resources/<name>` |
| `resolveAsset(rel, baseUrl)` | `new URL(rel, baseUrl)` | `Resources/assets/<basename of rel>` |
| `resolveAssetDir(rel, baseUrl)` | `new URL(rel, baseUrl)` | `Resources/assets/` |

Call sites that needed patching:

- 4 FFI loaders (`window/`, `syphon/`, `midi/`, `tools/p5gpu_text/`)
- `tools/p5gpu_text/ffi.ts` — `loadBundledFonts()` uses `resolveAssetDir`
- `window/panel_html.ts` — tweakpane-client.js
- `tools/perf_shell_html.ts` — perf-pane.js
- `examples/hanoiShow/fab_and_lies.ts` — poem.txt + 3 Thai TTFs
- `examples/hanoiShow/p5gpu_tegaki_handwriting.ts` — charmonman font + glyph data

## The Syphon framework quirk

`syphon_bridge`'s Rust code searches for `Syphon.framework` in several
locations, preferring `<dylib_dir>/frameworks/Syphon.framework` and
falling back to CWD-walking heuristics that look for the framework
inside the repo.

When launched from a terminal, CWD is `apps/deno-notebooks` and the
fallback finds the framework. When launched via Finder / `open`, CWD is
`/` and only the dylib-relative path works. **The build script bundles
`Syphon.framework` into `Contents/Resources/frameworks/`** so the
dlopen-time search hits on the dylib-relative candidate.

## Distribution

Ad-hoc signing satisfies Apple Silicon's "every executable must be
signed" requirement, but Gatekeeper still treats the `.app` as
"unidentified developer" on any machine that didn't build it. For
sharing without warnings you need the same Developer ID + notarization
pipeline as `encoder-gui` (see `encoder-gui/README.md`).

Quick local escape hatch for unsigned builds:

```sh
xattr -dr com.apple.quarantine HanoiShow.app
```

## Known issues / follow-ups

- **Bundle size (~840 MB).** `deno compile` is currently sweeping in
  `apps/deno-notebooks/node_modules` (~760 MB) even though most of it
  isn't on the import graph reachable from `combined_landscape.ts`.
  Adding an `exclude` block in `apps/deno-notebooks/deno.json` (or
  passing `--exclude` to `deno compile`) should shrink this
  substantially without changing behaviour.

- **MediaPipe servers external.** The body-contour and hand-bbox
  WebSocket servers (run from the Swift Vision app) are not bundled.
  The scenes that consume them degrade quietly if those services aren't
  running.

## Layout

```
apps/deno-notebooks/
├── bundle_paths.ts                    # the runtime resolver
├── window/ffi.ts                      # uses resolveNativeLib
├── syphon/ffi.ts                      # uses resolveNativeLib
├── midi/ffi.ts                        # uses resolveNativeLib
├── tools/p5gpu_text/ffi.ts            # uses resolveNativeLib + resolveAssetDir
├── window/panel_html.ts               # uses resolveAsset
├── tools/perf_shell_html.ts           # uses resolveAsset
├── native/
│   ├── deno_window/                   # wry-based window + webview FFI
│   ├── syphon_bridge/                 # Syphon output FFI (uses Syphon.framework)
│   ├── text_engine/                   # HarfBuzz text shaping FFI
│   └── midi_bridge/                   # CoreMIDI FFI
└── examples/hanoiShow/
    ├── combined_landscape.ts          # entry point
    ├── fab_and_lies.ts                # uses resolveAsset (poem + Thai fonts)
    ├── p5gpu_tegaki_handwriting.ts    # uses resolveAsset (charmonman)
    ├── poem.txt, *.ttf, *.png         # local assets
    └── bundle/macos/
        ├── stage-libs.sh              # builds + walks + rewrites dylibs
        └── build-app.sh               # full pipeline → HanoiShow.app
```

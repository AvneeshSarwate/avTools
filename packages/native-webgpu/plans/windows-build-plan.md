# Windows x64 build and distribution plan (TOP + CHOP)

Investigated 2026-11-13 on the Windows target machine itself (Windows 11 26200,
i5-1135G7 4C/8T, 8 GB RAM, Intel Iris Xe, TouchDesigner 2025.33230 installed).
Builds on [windows-portability-investigation.md](windows-portability-investigation.md),
which audited the source; this document decides the packaging shape and the
verification ladder.

## Decision: one self-contained DLL per operator

macOS ships each operator as a `.plugin` directory (Finder shows it as one item):
plugin binary (TD glue + statically linked TS compiler, ~28 MB) + private
`libavtools_runtime.dylib` (V8 + Dawn + libuv + Rust MIDI/text, ~44 MB) +
`AVToolsSyphon.framework` + `Resources/`.

Windows has no bundle concept: a CPlusPlus TOP/CHOP's **Plugin Path** is a
single `.dll`. The direct analogue of the fat bundle is therefore a **fat DLL**,
and it is achievable — arguably cleaner than on macOS:

```text
Plugins/
  README.md
  AvToolsSketch.dll          <-- TOP: everything inside, ~70-100 MB
  AvToolsChannels.dll        <-- CHOP: everything inside
  avtools-build.exe          <-- offline typechecker CLI
  THIRD_PARTY_NOTICES.txt
  version.json
```

Users pick `Plugins/AvToolsSketch.dll` in the file chooser. There is no
"keep the bundle intact" rule because there is nothing to break apart.

Why a single DLL rather than mirroring the mac DLL + private runtime layout:

- Windows resolves an implicitly linked dependency **by module name**, and an
  already-loaded module with that name wins even if the parent was loaded by full
  path ([DLL search order](https://learn.microsoft.com/en-us/windows/win32/dlls/dynamic-link-library-search-order)).
  Two project versions each shipping `avtools_runtime.dll` would silently share
  the first one loaded. TouchDesigner documents no dependency-directory behavior.
  A fat DLL loaded by full path has no name-resolved private dependency at all,
  so different versions/paths load as distinct modules.
- Windows DLLs export nothing by default, so the macOS `-load_hidden` /
  `-fvisibility=hidden` / `exports.txt` isolation work is unnecessary.
- Static CRT (`/MT`) removes the VC++ redistributable requirement.

Fallback layout if the fat link proves impractical: a folder per operator
(`AvToolsSketch/AvToolsSketch.dll` + content-hashed `avtools_runtime-<hash>.dll`
+ `Resources/`), with the runtime delay-loaded from the plugin's own directory
via a delay-load hook (`GetModuleHandleExW` + `LoadLibraryExW` full path). This
is exactly the mac shape, but the user then selects a DLL inside a folder.

### What has to change to link one DLL

| Piece | macOS today | Windows fat DLL |
| --- | --- | --- |
| TD glue (`SketchTOP.cpp`/`SketchCHOP.cpp`) | Apple clang, system libc++, C ABI to runtime dylib | Build as a GN `shared_library` beside `:runtime`, so the whole DLL uses one toolchain (clang-cl + Chromium libc++ + `/MT`). TD's API passes only raw pointers/C strings, and clang-cl is MSVC-ABI compatible, so TD's vtables work. Do **not** link MSVC-STL objects and Chromium-libc++ objects into one image (duplicate `operator new`, CRT mode conflicts). |
| Rust | Two staticlibs in two images (`libavtools_build.a` in plugin, `libavtools_runtime_deps.a` in runtime) | One umbrella staticlib crate depending on both as rlibs; two Rust staticlibs in one MSVC link collide on std symbols. Build with `-C target-feature=+crt-static` to match `/MT`. Same Rust toolchain for both (td-native-build pins 1.99.1). |
| V8 / Dawn / napi_v8 / libuv | GN, monolithic, separate dylib | Same GN targets, linked into the operator DLL. `buildtools/win/gn.exe`, Windows Chromium clang package instead of `Mac_arm64`. |
| Shader compiler | Metal (system) | D3D12: DXC is two DLLs (`dxcompiler.dll`, `dxil.dll`) and cannot be static; Dawn falls back to FXC (`d3dcompiler_47.dll`, a Windows system DLL) when they are absent ([Dawn change](https://git.axiodl.com/encounter/dawn-cmake/commit/a0758a1aef12b02216c2df2781d8e1458d6d7da6)). Start with FXC; also compile the Vulkan backend (`vulkan-1.dll` is guaranteed because TD itself requires Vulkan on Windows). Choose the default after testing p5gpu shaders on both. DXC, if later needed, can be embedded and extracted (below) and pre-loaded by full path. |
| Resources (`renderer.js`/`chop.js`, fonts, `DeclaredParameters.py`) | `Contents/Resources` beside the binary | Embed as `RCDATA`. On first load extract atomically (temp dir + rename) to `%LOCALAPPDATA%\avTools\runtime\<content-hash>\Resources` and pass that path to the existing code — every consumer already takes a `resources` directory string, so nothing downstream changes. The hash isolates versions; TOP/CHOP/multiple TD processes race safely via rename. Template SDK is already compiled into the Rust library. |
| Syphon | Framework in bundle | Omit. Spout is a later, separate feature (Spout prototype work exists under `apps/deno-notebooks/spout`). |
| Licenses | Per-bundle Resources | One `THIRD_PARTY_NOTICES.txt` beside the DLLs. |

Size is roughly the mac plugin binary + runtime (~70-100 MB per operator). TOP
and CHOP each carry V8 and Dawn, as on macOS today.

### Source changes (platform shims, not rewrites)

- `dladdr`/`dlopen(RTLD_NODELETE)` → `GetModuleHandleExW(FROM_ADDRESS | PIN)` +
  `GetModuleFileNameW` (Bridge.cpp, NativeBuild.h, SketchTOP/CHOP `resources()`).
- `dlsym(RTLD_DEFAULT, "Py…")` (TDParameters.h, PulseName.h) →
  `GetProcAddress(GetModuleHandleW(L"python311.dll"), …)`; TD 2025 ships
  `python311.dll` in `bin/`. Better: find the loaded `python3*.dll` dynamically.
- `SecRandomCopyBytes` → `BCryptGenRandom(BCRYPT_USE_SYSTEM_PREFERRED_RNG)`.
- `WebSocket.mm` (NSURLSession) → WinHTTP WebSocket API (`WinHttpWebSocket*`,
  built into Windows, no dependency) behind the same `WebSocket.h`.
- `src/td-runtime.ts` `backend=metal` → `d3d12`/`vulkan`; skip Syphon.
- `__attribute__((visibility))` in Bridge.h → a portable `AV_EXPORT` macro.
- Paths: UTF-8 ↔ UTF-16 at every OS boundary; TD hands UTF-8 strings.
- Build scripts: `xcrun`, `codesign`, `ditto`, `strip`, `.plugin` assembly →
  MSVC environment discovery, `rc.exe`, zip, optional `signtool`.

## Security prompts on end-user machines

- Windows 11 **Smart App Control** blocks unsigned DLLs loaded into any process
  ("Part of this app has been blocked") with no per-folder exception
  ([Microsoft](https://support.microsoft.com/en-US/Windows/Security/Threat-Malware-Protection/smart-app-control-has-blocked-part-of-this-app),
  [explainer](https://textslashplain.com/2026/04/28/smart-app-control/)).
  It is off on most upgraded machines but on for some clean installs. Plan to
  Authenticode-sign both DLLs and the CLI (e.g. Azure Trusted Signing) before
  wide distribution; document the symptom until then.
- Downloaded ZIPs propagate Mark-of-the-Web to extracted files. `LoadLibrary`
  does not prompt for that, but SmartScreen may when `avtools-build.exe` is
  launched from Explorer (not from a terminal). Verify in TD (L5 below).

## Verification ladder (what needs no computer use)

| Level | Check | Needs |
| --- | --- | --- |
| L0 | Rust TS compiler + `avtools-build.exe` build for `x86_64-pc-windows-msvc`; `check-file` on template entries | Existing Rust + VS 2019 Build Tools. **Result below.** |
| L1 | Fetch pinned Dawn + V8 with depot_tools (`DEPOT_TOOLS_WIN_TOOLCHAIN=0`), build `embedded-probe.exe` with D3D12 + Vulkan | Visual Studio 2022+ with C++ workload and Windows 11 SDK (only VS 2019 + SDK 19041 installed now). Many GB of sources; several hours on 4 cores/8 GB, link memory is the risk (use `-j2`, or a CI Windows runner). |
| L2 | Run `embedded-probe.exe`: JS timers, file/UDP/OSC, p5gpu render + readback on Iris Xe; MIDI enumerate | L1 output only |
| L3 | Link fat `AvToolsSketch.dll`/`AvToolsChannels.dll`; `dumpbin /dependents` shows only system DLLs; `dumpbin /exports` only TD entry points | L1 |
| L4 | Scripted TD (not TouchEngine — no TouchEngine license on this machine): launch `TouchDesigner.exe fixture.toe` whose `onStart` creates CPlusPlus TOP/CHOP, loads the DLL, cooks N frames, saves the TOP to PNG and channel values to JSON, then `project.quit(force=True)`; reuse the existing `create_fixture.py`/`verify.py` patterns. A window opens, but nothing needs to be read from the screen | TD itself runnable here (Non-Commercial is fine for C++ OPs, at TD's resolution caps). If a login/license or "load this plugin?" dialog blocks the start, one computer-use or manual step. |
| L5 | GUI walkthrough of the README: file chooser, Build/Diagnostics pages, Create Template, VS Code edit → reload, Info DAT, Smart App Control / MOTW behavior from a downloaded ZIP | Computer use |

Everything up to L4 can be scripted; only L5 and possibly a first license
dialog need eyes on the screen.

## Progress log

2026-11-13 (this machine):

- **L0 passed.** `tools/td-native-build` builds for `x86_64-pc-windows-msvc`
  (`avtools_build.dll` 32.9 MB, `avtools-build.exe` 33 MB). `init` creates the
  template; `check-file` passes all 7 starter entries and reports an injected
  type error with correct line/column and exit code 1.
- **Bug found and fixed:** `std::fs::canonicalize` returns `\\?\C:\...` verbatim
  paths on Windows; rolldown treated them as bare specifiers (`Cannot find module
  '\\'`), so every bundle failed. New `src/paths.rs` strips the prefix (no-op on
  macOS); all 9 call sites use it. `build-file` now succeeds for TOP and CHOP
  entries; unit test covers drive, UNC and volume forms.
- Rust MIDI + text runtime deps (`native/rust`) build for Windows with `+crt-static`.
- Toolchain: VS 2026 Build Tools (MSVC 14.51) + SDK 10.0.28000 — the versions the
  pinned Chromium `build/` (31b155b) packages; VS 2019 left installed, unused.
- Upstream fetched at `C:\src\avtools-upstream` (junction from `upstream/`), all
  pins verified. depot_tools needs `bootstrap\win_tools.bat` once when
  `DEPOT_TOOLS_UPDATE=0`. Clone with `core.autocrlf=false` (set via
  `GIT_CONFIG_*` env, not global config).
- All six Dawn binding patches apply on Windows, but only with LF endings: the
  avTools checkout stores `.patch` files CRLF under `core.autocrlf=true`.
  `embedding-win.mjs` strips CR; a `*.patch eol=lf` `.gitattributes` rule would
  fix it at the source (not yet added).
- `gn gen` succeeds (1993 targets). Baseline V8 + Dawn compile running at `-j3`.

Source port written (compiles once the baseline finishes):

- `native/embedded/Platform.h`: module path/pin, TD Python symbol lookup
  (finds the loaded `python3XY.dll`), secure random. Replaces every
  `dlfcn`/`SecRandom` use in `embedded/` and `td/`.
- `native/embedded/WebSocket_win.cpp`: WinHTTP transport, same contract as `WebSocket.mm`.
- `native/embedded/platform_stubs_win.cpp`: no Syphon on Windows.
- `IO.cpp` libuv-portable open flags + `S_ISREG` fallback; `Bridge.h` `AV_API` macro.
- `td-runtime.ts`: backend from `__avGPUBackend` (`metal` / `d3d12`,
  `AVTOOLS_GPU_BACKEND=vulkan` override); clear error for Syphon on Windows.
- `native/rust-windows/`: single Windows staticlib (compiler + MIDI + text),
  `panic = "unwind"` (compiler FFI uses `catch_unwind`), lockfile merged from
  the two existing locks.
- `embedded/BUILD.gn`: macOS targets unchanged under `is_mac`; Windows
  `AvToolsSketch`/`AvToolsChannels` DLL targets and `embedded-probe`.
- `scripts/embedding-win.mjs`: stage + build script (patches, libuv /MT, Rust,
  staging, args.gn, gn gen, ninja).

Cross-platform pipeline (same commands on macOS and Windows; mac paths unchanged,
each mac script gets a top-of-file `win32` dispatch):

| Command | Windows implementation |
| --- | --- |
| `embedding.mjs fetch` / `embedding.mjs` | `embedding-win.mjs` (fetch, stage, build `embedded-probe`) |
| `syphon.mjs --embedded` | no-op message |
| `build-td-plugin.mjs [--chop]` | `build-td-plugin-win.mjs`: AVR1 resource blob + `.rc`, ninja, `prebuilt/windows-x64/<Name>-<tag>.dll` |
| `package-td.mjs` | `package-td-win.mjs`: `prebuilt/avtools-td-plugins-windows-x64.zip` + `apps/td-projects/Plugins` (publish: `release-td.mjs`) |
| `notices.mjs` | Windows crate graph (`native/rust-windows`), no Syphon |
| `tools/td-native-build/scripts/package.mjs` | packages `avtools-build.exe` |

- Resources embedded (RCDATA 101 blob, 102 hash) and extracted atomically per
  hash to `%LOCALAPPDATA%\avTools\resources`; non-ASCII profile paths use the
  8.3 short form. `<Dll>-resources` beside the DLL overrides for development.
- Found: the first `avtools-build.exe` imported `VCRUNTIME140.dll`. Added
  `tools/td-native-build/.cargo/config.toml` (Windows-only `+crt-static`).
- `.gitattributes`: `*.patch text eol=lf`.
- Windows end-user guide: `prebuilt/windows-x64/README.md`; developer steps in
  `TOUCHDESIGNER.md` → "Windows x64".

### L1/L2: runtime builds and runs on Windows (2026-11-13)

Baseline V8 + Dawn compile: 40 min at `-j4` after enabling "Best performance"
and a Defender exclusion for `C:\src\avtools-upstream` (~40% faster than `-j3`).
The whole port then compiled after one fix (`MAKEINTRESOURCEW` is absent from
Chromium's trimmed `<windows.h>`). `embedded-probe.exe` imports only Windows
system DLLs (no VCRUNTIME/UCRT). On D3D12 (Iris Xe) it passes: two isolated V8
instances, GPU buffer write/copy/map/readback, 10k timer cancellations with flat
heap, leak checks, error recovery, CPU-budget termination, poisoning.

Windows-specific issues found and fixed, in order:

1. **V8 layout static_assert with pointer compression off** (Torque says
   `JSAtomicsMutex::owner_thread_id` at 40, C++ at 36 under MSVC layout). Windows
   now uses `v8_enable_pointer_compression = true` (Chrome's tested config);
   sandbox stays off. macOS unchanged.
2. **Embedder/V8 config mismatch** (fatal at startup): our GN targets included V8
   headers by path without V8's defines. Windows targets now use
   `//third_party/v8/src:external_config`.
3. **napi_v8 "Object is already wrapped"**: the shim reads an unset internal field
   as a pointer (unspecified; null without compression, non-null with it). New
   `patches/0007-napi-v8-construct-wrap-state.patch` sets the field to null on
   construct calls. Applied on Windows only for now; correct on macOS too.
4. **V8 deoptimizer fail-fast (0xC0000409) under CET shadow stacks**: Chromium
   marks executables `/CETCOMPAT`. `enable_cet_shadow_stack = false`.
   TouchDesigner.exe is not CET-compatible, so the DLLs are unaffected; if a
   future TD opts in, V8's (experimental) `v8_enable_cet_shadow_stack` is needed.
5. **Vulkan never loads** (error 87): Dawn's bare-name fallback uses
   `LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR`. `dawn_force_system_component_load = true`
   loads vulkan-1/d3d12/dxgi/d3dcompiler_47 from System32 only.

Not needed for shipping: Dawn builds the Vulkan validation layers by default;
`dawn_enable_vulkan_validation_layers = false` would shorten clean builds.

Backend selection: `d3d12,vulkan` ordered fallback (single backend via
`AVTOOLS_GPU_BACKEND`), `powerPreference: 'high-performance'` for hybrid laptops;
`__avGPUBackendUsed` records the result. Both backends pass the probe round trip.

### L3/L4: operator DLLs and TouchDesigner (2026-11-13)

`npm run td:build` / `td:build:chop` / `td:pack` produce Windows distribution 2:
`AvToolsSketch.dll` 69.9 MiB, `AvToolsChannels.dll` 65.2 MiB, `avtools-build.exe`
31.6 MiB, ZIP 60.2 MiB. `dumpbin`: DLLs and CLI import only Windows system DLLs
(no VCRUNTIME/UCRT); TD entry points exported; `.rsrc` holds the resource blob.
Extracted ZIP → `avtools-build.exe init` → TOP and CHOP starters build `ready`.

Fixture startup code is platform-aware (`PLATFORM`/`PLUGIN` in each
`project_start.py`); `scripts/update-td-project-startup.py` (macOS + Windows)
re-embedded it into 20 saved `.toe`/`.tox` files via toeexpand/toecollapse.

`scripts/td-smoke-test.py <fixture.toe>` (agent test protocol): temporary copy of
the fixture with a verification hook; launches TD, waits for native builds, writes
JSON (per CPlusPlus TOP/CHOP: plugin, errors/warnings, size, per-channel image
min/max/mean, CHOP values), quits TD. Plugins resolve from gitignored local
build/fetch state; no copies needed. On TD 2025.33230 (Non-Commercial), all 12
checked-in fixtures pass with no errors: Sketch, TimeContext, Channels, Stress,
Parameters, IO (UDP/OSC bound), MIDI, Logging, ExecutionModes, NativeBuild,
channels IDE project (after its documented `npm run setup`), Canvas. TOP colours
match the sketches exactly (orange 255/120/60, blue 60/160/255), alpha 1.0. Note:
`TOP.sample()` reported equal RGBA values; the test reads `numpyArray()` instead.
To check visually later: a few pure-black pixels per TOP image (background never
goes below ~10/255).

Not yet exercised on Windows: interactive GUI flow (file chooser, Create Template
Project button, edit→save→reload in VS Code, Info DAT views), MIDI with a real
device, WebSocket against a live server, Smart App Control behaviour, and a clean
machine without developer tools.

### Release examples (2026-11-13)

Each release ZIP (both platforms) gets `Examples/` beside `Plugins/`:
`scripts/td-examples.mjs` lists native, sketch (Sketch + TimeContext), channels,
execution-modes, logging; only git-tracked files are copied; `Examples/README.md`
points to the template's built-in examples (parameters, OSC/UDP, MIDI, WebSocket,
canvas). Parameters/IO/MIDI fixtures are excluded (tsconfig extends repo paths);
`starter` and the `channels` IDE project are excluded (need Node + repo tools).
Those five examples' startup scripts use `find_plugin()`: `Plugins/` beside or
above the project, else `prebuilt/<platform>/current*.txt`; re-embedded with
`update-td-project-startup.py` (which now also syncs edited `project_start.py`
files into saved projects). `fetch-td-plugins.mjs` writes `prebuilt/<platform>`
markers on both platforms. `apps/td-projects/README.md` updated for Releases.

### L5: release ZIP + on-screen check in TD (2026-11-13, computer use)

Release ZIP (60.8 MiB, with `Examples/`) extracted to a folder outside the repo:
all 6 example `.toe`s pass the smoke test, loading only the ZIP's own `Plugins/`.

First-time-user flow in TD 2025.33230 (Non-Commercial), from that ZIP's `Plugins`
copied beside a newly saved `MyProject.toe`:
- CPlusPlus TOP, Plugin Path `Plugins/AvToolsSketch.dll` (relative): loads, no
  load prompt, error badge clears; Build/Legacy/Diagnostics/Sketch/Output pages.
- Template Parent Folder via the Windows folder chooser; Create Template Project
  creates `avtools-project/`, auto-sets TypeScript File, Controls page appears.
- Floating viewer: orange circle on dark background at 1280x720; edges clean (the
  few dark pixels from earlier stats are not visible).
- Live edit (save main.ts adding a rect): rebuilt and reloaded in ~4 s.
- Type error: last good sketch keeps running; node warning
  `.../main.ts:21:9 TS2322 Type 'string' is not assignable to type 'number'.`;
  clears after fixing.
- CPlusPlus CHOP, `Plugins/AvToolsChannels.dll`: template guard refuses to replace
  the existing project ("Existing files were not changed."); with the template's
  channels entry, `value` 0 and `ticks` rising ~100/s, no warnings.

Found and fixed: Windows paths built by the TD glue mixed separators
(`C:/.../MyProject\avtools-project\examples\...`) in TypeScript File and messages.
`NativeBuild.h`, `TDParameters.h` and the TOP/CHOP `resources()` now use
`generic_string()` (forward slashes; unchanged on macOS). Verified in TD with
distribution 4 (template path and guard message all forward slashes); all 6
release examples pass again from a freshly extracted distribution-4 ZIP.
Automation notes (not product issues): TD ignores single synthetic clicks
(double-click registers as one); `open_application` starts a new TD instance
instead of focusing the running one. Not covered: VS Code IntelliSense,
Smart App Control, a clean machine without dev tools.

## Handoff: state on 2026-11-13 and next steps

Nothing is committed. `main` == `origin/main` (history rewrite pushed; builds are
GitHub release assets, rolling tag `td-plugins`, not yet uploaded). The working tree
holds the whole Windows port, cross-platform scripts, fixture changes (incl. 20
re-saved `.toe`/`.tox`), plus the user's unrelated deno-notebooks/Spout work.

Local build state (gitignored): upstream at `C:\src\avtools-upstream` (junction
`packages/native-webgpu/upstream`), `out/avtools-win` built; operator DLLs in
`prebuilt/windows-x64/`; distribution in `apps/td-projects/Plugins`. Rebuild:
`npm run td:build && npm run td:build:chop` (from `packages/native-webgpu`).
Build/test steps on this laptop: run in background, `-j4`.

Next (in order):
1. Re-run `npm run td:pack`, extract the ZIP to an empty folder, and smoke-test
   `Examples/*/*.toe` from there with `scripts/td-smoke-test.py` (proves the
   beside/above `Plugins/` lookup outside the repo).
2. Computer-use verification in TD 2025.33230 (GUI only covers what scripts can't):
   - From the extracted ZIP: new project → CPlusPlus TOP → Plugin Path →
     `Plugins\AvToolsSketch.dll` (file chooser); note any load prompt; Build and
     Diagnostics pages appear.
   - Create Template Project → orange circle 1280x720; Info DAT Diagnostics/Logs.
   - Edit `examples/background/main.ts` (e.g. fill colour), save → automatic
     rebuild + reload visible; introduce a type error → warning, last good sketch kept.
   - Same for CPlusPlus CHOP + `AvToolsChannels.dll` (`value`/`ticks`).
   - Open each `Examples/*.toe`; look for the few pure-black pixels seen in TOP stats.
3. On macOS: pull, run the normal build (`embedding.mjs`, `td:build`, `td:build:chop`,
   `td:pack`) and open a fixture — mac build files, fixture startup scripts and the
   re-saved `.toe` files changed. Then `npm run td:release` (needs `gh`).
4. Windows `npm run td:release` after verification; commit the port.
Later: Authenticode signing; CUDA fast path (Phase 2); optional
`dawn_enable_vulkan_validation_layers = false`; hide `napi_*` exports from the DLLs;
UTF-8 paths at `std::filesystem::path::string()` boundaries; apply patch 0007 on macOS.

### Phase 2: GPU texture fast path (not started)

TD's Windows C++ TOP API has no D3D/Vulkan handle exchange; the only zero-copy
mode is `TOP_ExecuteMode::CUDA` (`cudaArray` inputs/output; NVIDIA only). The
Windows build ships the same CPU readback/upload path as macOS. Fast path plan:
Dawn D3D12 texture exported via SharedTextureMemory → `cudaImportExternalMemory`
→ device copy into TD's output `cudaArray` (and inputs in reverse), with
D3D12/CUDA fence interop; load TD's bundled `cudart64_12.dll` dynamically so the
DLL still loads on non-NVIDIA machines; automatic fallback to CPUMem. Needs an
NVIDIA machine to develop and validate (this laptop is Intel Iris Xe).

Open items: verify compile of the operator DLLs; Windows bridge probe; UTF-8 handling of
user-selected TypeScript paths (`std::filesystem::path::string()` on Windows uses
the ANSI code page); Authenticode signing. Distribution is decided: GitHub Releases
(rolling `td-plugins` tag, one ZIP per platform via `npm run td:release`); builds
are no longer in git.

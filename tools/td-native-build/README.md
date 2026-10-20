# Native TypeScript builds for TouchDesigner

`avtools-build` checks, bundles, generates shader wrappers, and watches TypeScript
without Node, npm, Deno, or a compiler installed on the user's machine. The TOP and
CHOP load the same native build library directly. A terminal watcher is optional.
The original [Node runner](../td-sketch-build/README.md) remains available.

## Open and edit

Open [the native example](../../apps/td-projects/native/project.toe) in TouchDesigner.
Open that directory in VS Code and edit `sketches/`. Saving rebuilds and restarts
the affected sketches automatically. State resets on successful replacement.
Errors appear in each operator's Info DAT and warning; its last working script
continues running. No setup command is required for the supplied project.

To use a project on another operator, select the current prebuilt avTools TOP/CHOP
and set its **Build** page:

- **Project Directory**: directory containing `avtools.json`.
- **Entry**: a key in that file's `sketches` map.
- **Automatic Builds**: rebuild on filesystem changes; turn off for manual builds.
- **Build Project**: request a build explicitly.

Automatic Builds is shared at the project level: any enabled subscriber keeps its
watcher active. A manual subscriber still receives builds requested by another
instance. Disable the toggle on every instance of that project for fully manual use.

Project Directory takes precedence over Sketch DAT and Source File. Clear it to
use those existing modes. For a CHOP, set Output Channels and Output Samples to
match the entry's `outputs` and `samples`. These describe the runtime output shape;
they do not dynamically create TD parameters.

Compilation runs on a dedicated thread. Multiple instances of a project share the
watcher and bundle data; their V8 state and timing tasks remain independent. There
is one serialized build service per loaded compiler version, shared by TOP/CHOP.
Builds finish while playback is paused; activation waits until the next cook. No
filesystem callback calls TD or V8. Polling at cook boundaries uses a nonblocking
lock attempt. Source File mode also watches its directory and reads changed files
in the background, retaining the last complete file if temporarily removed.

## CLI and copying a template

The signed macOS arm64 executable is in
`packages/native-webgpu/prebuilt/macos-arm64/native-build/<version>/avtools-build`;
`native-build/current.txt` identifies the version. It is standalone: copying just
that executable is sufficient for CLI use. Keep its adjacent third-party notices
when redistributing it.

```sh
avtools-build init /path/to/new-project
avtools-build build /path/to/project
avtools-build check /path/to/project
avtools-build watch /path/to/project
```

`init` requires an empty directory and extracts the versioned, embedded template
and SDK. Alternatively copy `apps/td-projects/native/`, excluding `.avtools/` and
`dist/`. The SDK is explicit project data and never silently upgraded. To upgrade,
initialize a separate directory and compare/copy its SDK deliberately.

`check` checks types/configuration and generated shader types without publishing
runtime bundles. It does **not** run a GPU/runtime smoke test, unlike the old
runner's `check` command. Developer runtime validation is described below.

The supported dependency scope is local source plus the supplied SDK. Dependencies
must be copied into the project; symlinks and outside-project source are rejected.
There is no automatic package installation. The relative `sdk/tsconfig.json`
aliases work in the checker, bundler and ordinary VS Code TypeScript tooling.
Full TypeScript checking uses pinned tsrs (TypeScript 7.1 development baseline);
Rolldown/Oxc performs transformation and bundling. The IDE's TypeScript version may
differ. Existing starter and generated shader contracts have conformance coverage.

## Project configuration

```json
{
  "version": 1,
  "sketches": {
    "background": {"entry": "sketches/background/main.ts", "target": "top"},
    "channels": {"entry": "sketches/channels/main.ts", "target": "chop",
                 "outputs": ["x", "y"], "samples": 10000}
  },
  "shaderDirs": ["sketches"],
  "generatedDir": "generated",
  "outDir": "dist"
}
```

Paths resolve against the config directory. `samples` defaults to 1; CHOP schemas
follow the runtime's 1024-channel / 1M-total-sample limits. TOP entries export
`draw`, with optional `setup` and `onPulse`. CHOP entries export `setup` and/or
`onCook`, with optional `onPulse`. Import host types and use `host.timing` for
managed timing; bundling a separate timing runtime is rejected.

Plain `.wgsl` imports become strings. The existing `.material.wgsl`,
`.strokeMaterial.wgsl`, `.fragFunc.wgsl`, and `.compute.wgsl` conventions generate
typed wrappers under `generated/`. They use the existing TypeScript generators,
prebundled at release time and executed by embedded QuickJS. No Node fallback is
used. Generated files remain visible to the IDE.

## Publication and lifecycle

Each build snapshots local input contents into a private session directory,
generates/checks/bundles there, and verifies the source revision before publication.
An edit during compilation discards the stale result and schedules another build.
A project file lock also serializes a simultaneous CLI and TD build.
All entries validate before any bundle is published; each file replacement is
atomic, but different operators can observe revisions on different cooks.
Identical output bytes do not touch the live file or restart its script.

`.avtools/status.json` contains state, revision, diagnostics and timing;
`.avtools/last-good.json` retains the last successful build. `dist/*.js.map` holds
source maps for tooling; V8 does not automatically consume them.

Compiler sessions do not persist across builds. The adapter owns config/parser
regions, checker regions and programs, copies diagnostics, frees the program,
releases regions, then resets compiler IDs. [Vendor notes](vendor/UPSTREAM.md)
record the audited ownership constraints. One checker and two bundler workers
limit background contention. A compiler panic poisons the service until the host
restarts; user type/syntax errors are ordinary recoverable results.

The last subscription closes project watchers and joins outstanding compilation.
The dylib itself is pinned until process exit because the bundler's shared Rayon
pool has process lifetime. Plugins resolve one canonical shared dylib; copying
private, unrelated compiler libraries into each plugin is not the packaging model.
The compiler uses ordinary pointers so distinct plugin versions can coexist
without competing for the upstream compiler's fixed virtual-address reservation.

## Build and validate the tool itself

Development requires Rust 1.99.1, the macOS SDK, and the existing Node build
dependencies **only for refreshing release assets**. Cargo.lock pins Rolldown
1.2.14/Oxc 0.154 and the other dependencies; tsrs is vendored at a specific revision.

```sh
node tools/td-native-build/scripts/prepare-assets.mjs
cargo build --release --manifest-path tools/td-native-build/Cargo.toml -j 4
node tools/td-native-build/scripts/notices.mjs
node tools/td-native-build/scripts/package.mjs
node packages/native-webgpu/scripts/build-td-plugin.mjs
node packages/native-webgpu/scripts/build-td-plugin.mjs --chop
node --test tools/td-native-build/tests/behavior.mjs
node tools/td-native-build/tests/native-hosts.mjs
node tools/td-native-build/tests/native-runtime.mjs apps/td-projects/native
```

Behavior tests use Node as the test driver but run the native executable with
`PATH=/usr/bin:/bin`. Set `AVTOOLS_BUILD_BINARY` to test a release or packaged binary.
The C hosts test subscription/result ownership and bundle-directory notifications.
`tests/two-libraries.cpp` checks coexistence of independently loaded compiler
versions; `tests/service-soak.cpp` measures complete repeated in-process builds.
Add `--soak` to `native-hosts.mjs` for 200 complete builds and JSON memory samples.
`avtools-build soak PROJECT COUNT [ALTERNATE_PROJECT]` measures repeated owned
sessions in one process. See [validation](VALIDATION.md) for actual results and
remaining limits. Builds on Windows are not supplied yet.

# Native TypeScript builds for TouchDesigner

Current lifecycle: [Build, Reload, and Reset](../../packages/native-webgpu/RELOAD.md). Automatic Reload is per operator; Reload adopts available source, Reset restarts active source. Each activation creates a fresh isolate. The generated SDK supports ordinary TimeContext imports.


The avTools TOP and CHOP compile and watch TypeScript inside the native plugin.
No Node, npm, Deno, compiler installation or terminal watcher is needed for the
supplied SDK. The [older Node runner](../td-sketch-build/README.md) remains available.

## Start in your own TD project

1. Load the current [prebuilt TOP or CHOP](../../packages/native-webgpu/prebuilt/README.md)
   into your project. Keep its `.plugin` bundle and sibling `native-build/` distribution together.
2. On its **Build** page, choose a **Template Parent Folder**, usually your TD
   project directory. The button creates an `avtools-project/` child folder.
3. Press **Create Template Project**. This creates a local SDK, `tsconfig.json`,
   starter TOP/CHOP sources and a README. It selects the matching **TypeScript File**
   on this operator, enables Automatic Builds, and configures the starter CHOP's
   `value ticks` output channels and one output sample.
4. Open the new `avtools-project/` folder in VS Code and edit the sources. Saving rebuilds the affected
   entries; successful changed bundles restart their instances.

Creation is optional. For an existing TypeScript project, just select its entry
file. Creation refuses an existing `avtools-project` child, including symlinks;
it never replaces an existing project or silently upgrades its SDK. Unrelated
files such as a `.toe` are preserved. Filesystem failures can leave a partial
new template; diagnostics explain the failure. No `.toe` or plugin copy is generated
by this button: the operator is already in your TD project.

For a ready-to-open example, use [project.toe](../../apps/td-projects/native/project.toe).

## Several sketches in one .toe

Each operator's **TypeScript File** points directly to a `.ts` entry. There is no
manifest or bundle-path setup. For example:

| Operator | TypeScript File |
| --- | --- |
| Background TOP | `sketches/background/main.ts` |
| Orbit TOP | `sketches/orbit/main.ts` |
| Channels CHOP | `sketches/channels/main.ts` |
| Offset CHOP | `sketches/offset/main.ts` |

The nearest enclosing `tsconfig.json` supplies types and import resolution. Entries
can share ordinary relative imports, aliases, npm packages and workspace links.
The native checker checks the selected entry and its dependency graph, plus the
config's ambient declaration files. An unrelated entry's error does not block it;
a broken shared helper affects every entry importing that helper. VS Code still
checks the full project selected by its tsconfig. Use `import` for executable
helpers; unrelated global-script `.ts` files are not implicit dependencies.

TOP entries export `draw`, optionally `setup` and `onPulse`. CHOP entries export
`setup` and/or `onCook`, optionally `onPulse`. The operator determines the target.
CHOP Output Channels and Output Samples define the runtime schema; there is no
manifest schema to keep in sync. Import runtime timing functions from `@avtools/core-timing`.

One native service serializes compilation, and entries in the same project share
its root filesystem watcher. Identical entry/target subscriptions share compiled
results; each operator retains its own V8 state. Automatic Builds is shared among
subscribers of the **same entry**. Build Script requests that entry explicitly.
Compilation never runs in a cook. Builds finish while playback is paused, and the
new script activates on its next cook. Errors preserve each entry's last working
bundle and appear in the Info DAT and operator warning.

TypeScript File takes precedence over other source modes. Clear it to use Sketch
DAT or Source File. Source File still accepts prebuilt JavaScript and watches it.
Older manifest projects remain supported on the **Legacy Build** page; leave those
fields empty in new projects. They retain their original all-entry build behavior.

## Types, dependencies and shaders

SDK 3 gives the IDE and native checker ES2022 plus accurate TD declarations.
See [TD types](../../packages/native-webgpu/TD_TYPES.md) for common/TOP profiles,
type-only timing imports, separate Node tooling configs and ambient-type limits.
Imported npm packages may use bundled types or ordinary `@types` dependencies.
Install them using your own package manager; the native compiler does not install
packages. It supports installed node_modules layouts including pnpm symlinks,
package exports/imports, CommonJS/JSON, external sources and tsconfig aliases/extends.
Yarn PnP, URL imports and `npm:` specifiers are outside this implementation.

Dependencies must run with embedded V8/TD APIs. Node built-ins are bundle errors;
no Node/browser/network APIs are added by importing a package. Safely guarded
platform detection is allowed. SDK-private dependencies do not override npm
versions installed in the user's project.

Plain `.wgsl` imports become strings. Local `.material.wgsl`, `.strokeMaterial.wgsl`,
`.fragFunc.wgsl` and `.compute.wgsl` sources generate typed wrappers under
`generated/`, retaining project-relative shader directories. Only requested
wrappers affect an entry's diagnostics/publication. The embedded QuickJS generators
need no Node runtime. Keep generated wrappers out of source control.

## CLI and caches

The signed executable under `prebuilt/macos-arm64/native-build/<version>/` embeds
the same template. `native-build/current.txt` identifies its distribution.

```sh
avtools-build init /path/to/project
avtools-build build-file /path/to/project/sketches/background/main.ts top
avtools-build check-file /path/to/project/sketches/channels/main.ts chop
avtools-build watch-file /path/to/project/sketches/channels/main.ts chop
```

`check-file` checks types/generated shader types, without bundling or a runtime
smoke test. Build results and last-good JavaScript live in
`.avtools/entries/<entry-and-target-hash>/`, with status and dependency metadata.
These are disposable implementation caches; operators don't need their paths.
Legacy `build|check|watch PROJECT` commands still require `avtools.json`.

Checking and bundling share cached filesystem observations at original paths.
Imported external dependencies and missing paths are watched; source edits during
compilation discard stale results. A project lock serializes CLI/TD publication.
Each bundle replacement is atomic; unchanged bytes do not restart scripts.
Source maps are emitted, but V8 does not automatically apply them.

Compiler sessions release owned parser/program/checker regions between builds;
[vendor notes](vendor/UPSTREAM.md) explain the audited ownership constraints.
A compiler panic requires restarting the host. The last subscription joins the
build service; compiler dylibs stay loaded for process-lifetime worker pools.

## Build and validate the tool

Development needs Rust 1.99.1 and the macOS SDK. Node dependencies are used only
for refreshing release assets and driving tests. Cargo.lock pins Rolldown/Oxc;
tsrs is vendored. User projects need none of that tooling.

```sh
node tools/td-native-build/scripts/prepare-assets.mjs
cargo build --release --manifest-path tools/td-native-build/Cargo.toml -j 4
node tools/td-native-build/scripts/notices.mjs
node tools/td-native-build/scripts/package.mjs
node packages/native-webgpu/scripts/build-td-plugin.mjs
node packages/native-webgpu/scripts/build-td-plugin.mjs --chop
node --test tools/td-native-build/tests/behavior.mjs tools/td-native-build/tests/environment.mjs tools/td-native-build/tests/entry-files.mjs
node tools/td-native-build/tests/native-hosts.mjs
node tools/td-native-build/tests/native-runtime.mjs apps/td-projects/native/sketches/background/main.ts top
node tools/td-native-build/tests/native-runtime.mjs apps/td-projects/native/sketches/channels/main.ts chop "value ticks"
```

Set `AVTOOLS_BUILD_BINARY` to test another compiler distribution. Native host tests
cover C ABI ownership, entry subscriptions, independent error recovery and file
notifications. Add `--soak` for 200 repeated builds. See [validation](VALIDATION.md).
The shipped target is macOS Apple Silicon; Windows binaries are not supplied.

Execution policy is independent of compilation: **Wait for Current Result** chooses
blocking/buffered execution per operator. See [execution modes](../../packages/native-webgpu/EXECUTION_MODES.md).

## Template setup verification

`tests/td-template-examples.py` runs in TD's Textport with `__file__` set to its
absolute path. It creates an isolated test component and temporary source
projects without saving the current `.toe`. Distribution 20 passed this test
in TouchDesigner 2025.31550 on macOS: both template buttons create the child
folder, preserve unrelated parent files, reject repeat/symlink collisions, and
run the new controls, input, timing and 10,000-sample XY interpolation examples.
Results are recorded in [`tests/results/template-examples-td.json`](tests/results/template-examples-td.json).

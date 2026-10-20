# Native TypeScript build tool for TouchDesigner

Status: implemented initial native core/CLI, copied SDK, shader generators, and
TOP/CHOP project integration. See [implementation guide](../../../tools/td-native-build/README.md)
and [validation](../../../tools/td-native-build/VALIDATION.md). The existing Node
runner remains available. A physically separate clean-machine installation has
not been exercised; release tests remove developer runtimes from PATH.
Research date: 2026-10-20.

## Objective and user experience

Deliver one native executable, tentatively `avtools-build`, that builds and watches
TypeScript projects for the avTools TOP and CHOP. Users copy a template directory,
edit TypeScript in their IDE, and point an operator at the project. They should not
need Node, npm, Deno, Rust, a terminal watcher, or a native toolchain installed for
the eventual integrated workflow.

Target a shared Rust build core usable both by one standalone executable and
directly by the C++ operators through a C ABI. The CLI is a useful external
watcher and test harness for the same implementation, not a prerequisite rollout
before attempting direct integration. Prove both entry points early.

This is for personal/shared internal use. Compiler crash isolation is not a design
requirement, and a polished production rollout is unnecessary. Prefer compilation
on a dedicated thread so normal cooks continue, but occasional compile-related
stalls are acceptable initially. Record their impact rather than making a strict
frame-time guarantee a release gate.

Assume user-authored projects and output bundles are trusted. This is a build and
reload system, not a security sandbox. Preserve existing runtime error handling,
timing-task cancellation, and generation ownership during script replacement.

## Starting point

- [`tools/td-sketch-build`](../../../tools/td-sketch-build/README.md) currently
  uses Node, TypeScript 5.9, and esbuild for checking, bundling, shader generation,
  event-driven watching, and atomic publication.
- [`apps/td-projects`](../../../apps/td-projects/README.md) contains the editing
  workflow and project templates. TOP and CHOP adapters consume bundled scripts.
- [`tools/td-sketch-build/codegen.ts`](../../../tools/td-sketch-build/codegen.ts)
  delegates to four existing raw WGSL generators. Their implementation is
  TypeScript and depends on `wgsl_reflect`.
- The CHOP integration is being developed independently. Inspect its current
  callback, output-schema, and declaration contracts before adapting it; this plan
  must not replace or interfere with that work.

Keep the existing runner operational during development. Preserve its useful
behavioral tests; compare behavior rather than requiring identical bundle bytes.

## Architecture decisions

| Responsibility | Choice | Integration status |
| --- | --- | --- |
| Module resolution, TS transformation, bundling | Rolldown Rust API, using Oxc internally | Native library API exists; pin and prove our use case |
| Full TypeScript checking | Pinned/vendored `tsrs` compiler crates | Experimental; requires an adapter around internal APIs |
| Filesystem notifications | Rust `notify` with macOS FSEvents | Own the build scheduling and publication policy |
| Configuration and diagnostics | Our Rust build coordinator | Static JSON config, structured results |
| Existing WGSL generators | Prebundled JS in an embedded engine, initially investigate QuickJS | Compatibility spike required |
| Runtime execution | Existing embedded V8 TOP/CHOP runtime | Build tool emits its existing callback contract |

Oxc transformation removes TypeScript syntax; it is not full typechecking.
Rolldown supplies the module graph and bundle generation. Do not build a custom
bundler from Oxc parser/transformer primitives.

Avoid depending on the npm Rolldown CLI, JavaScript build configurations, Vite,
or arbitrary JavaScript build plugins. Call the native Rust libraries directly.
No user-side package-manager invocation should be necessary for supplied examples.

Organize the implementation as a reusable build-core crate, a thin CLI, and a thin
C ABI wrapper, proposed under `tools/td-native-build/`. Keep third-party compiler
details behind adapters. Do not duplicate the entire JS runner indefinitely;
retire it only after parity.

### Fresh compilation sessions and arena cleanup

Start with one shared in-process build service on a dedicated thread with adequate
stack space. Serialize builds across projects initially. Each request creates a
fresh compilation session; full rebuilds are acceptable. Do not introduce
cross-build in-memory compiler caches until measured edit latency justifies them.

Use `tsrs`'s existing arena/region ownership and program cleanup facilities to
establish a session boundary. Adapt its driver where needed rather than wrapping
the whole compiler in a blanket allocator and assuming that all state resets.
Distinguish a persistent project watch subscription from a short-lived compilation
session; several subscriptions can feed the shared service.

Session lifecycle:

1. Capture the build inputs and initialize the compiler/bundler session.
2. Generate, check, and bundle on the build service thread; bound any compiler
   worker pools and keep them separate from sketch timing threads.
3. Copy diagnostics, emitted code, source maps, and dependency information into
   build-service-owned data. No arena-backed pointers may escape in results.
4. Finish/join session work, release compiler programs and non-arena resources,
   and release the session's regions in their required ownership order. Run this
   cleanup for ordinary error paths as well as successful builds.
5. Publish the owned successful result. The runtime may continue using it after
   the compilation session has been destroyed.

Audit global/thread-local caches and references that can outlive a session. Also
inspect process-wide counters: upstream watch-memory notes identify growing
node/symbol IDs, which freeing an arena alone does not reset. Recheck the pinned
revision and adapt remaining state as necessary. Only reset IDs/caches after
proving no live compiler object refers to them; never reset shared state while
another compilation uses it.

Treat memory cleanup as a concrete implementation/test task, not a reason to defer
in-process integration. Repeated sessions should reach a bounded steady state;
RSS need not return to its startup value because allocators may retain reusable
pages. Distinguish live growth from retained capacity.

A self-spawned compiler-worker mode remains a fallback if a specific lifecycle
problem proves expensive to fix. It is not the default architecture or a required
intermediate milestone. Do not retain process-wide CLI exit/signal handling in the
library entry point, and do not unwind Rust panics across the C ABI.

## Project and output contracts

Proposed commands:

```sh
avtools-build build /path/to/project
avtools-build watch /path/to/project
avtools-build check /path/to/project
```

`build` checks and bundles once. `watch` repeats on source changes. `check` checks
types/configuration without publishing a bundle; unlike the existing runner's
`check`, this command does not imply a GPU or native-runtime smoke test. Document
that distinction during migration; retain a separate developer validation command.

Proposed template layout:

```text
project/
  avtools.json
  tsconfig.json
  sketches/
    animation/main.ts
    background/main.ts
  sdk/
  generated/
  dist/
  .avtools/
```

- `avtools.json`: versioned JSON schema; named entries, target (`top`/`chop`),
  entry path, relevant CHOP output schema, shader directories, and output directory.
  Resolve relative paths against the config directory, not the current directory.
- `tsconfig.json`: relative paths and host declarations that work in ordinary
  VS Code TypeScript tooling. No custom language server is required initially.
- `sdk/`: versioned host declarations, supported avTools libraries, and required
  transitive dependencies. A copyable template should work in the IDE immediately.
  The binary may also embed an SDK archive for initialization and explicit upgrades.
  Do not silently update a project's SDK when the tool version changes.
- `generated/`: derived shader wrappers, written to disk so the IDE can inspect
  their actual types.
- `dist/<entry>.js`: one self-contained bundle per entry, with the callback adapter
  expected by the target runtime. Preserve managed `host.timing` ownership.
- `.avtools/`: ignored build metadata and machine-readable status; optional disk
  caches can be introduced later.

Include TypeScript standard-library declarations in the distribution/embedded
assets as needed. First-run extraction of data files is compatible with shipping
one executable; do not confuse it with requiring extra executable installations.

The initial dependency scope is local modules plus the supplied SDK. Resolving
an already-installed package is distinct from downloading/installing one. Arbitrary
npm dependency installation is a separate later feature, not an implicit promise.
Ensure the bundler, checker, and IDE agree on aliases and module resolution.

## Build and publication semantics

1. Observe source, helper, config, declaration, and shader changes using filesystem
   notifications. Coalesce save bursts. Exclude outputs, generated writes, caches,
   native artifacts, and unrelated large trees from rebuild loops.
2. Build against a consistent source revision. Either capture a source snapshot or
   verify relevant contents before publishing; if inputs changed during the build,
   discard the result and rebuild. Event ordering alone is insufficient.
3. Generate shader wrappers, typecheck, and bundle. Failures publish diagnostics
   while preserving the previous successful runtime bundle.
4. Publish each complete bundle by temporary write plus atomic rename in the same
   filesystem. Do not truncate/rewrite the live file in place.
5. Compare output bytes or hashes: unchanged output must not restart an operator.
6. Include revision IDs in diagnostics/status so an older build cannot overwrite
   a newer result. A failed build must not erase the current successful revision.

Watch directories as appropriate to handle editor atomic saves and file creation,
rename, deletion, and recreation. Recover from missing imports when files appear.
On config changes, invalidate the relevant resolver/transform caches.

For multiple entries, initially retain the existing policy: validate the project
before publishing changed entries. Each entry replacement is atomic; do not claim
all operators switch revisions in one TD-wide transaction.

Produce readable CLI diagnostics and structured status with source locations,
target/entry, revision, state, and timing. Preserve source maps for later runtime
stack mapping, but do not claim V8 will automatically consume them.

## Implementation stages and exit criteria

### 0. Prove native composition and reusable session cleanup

- Pin Rolldown/Oxc and a specific `tsrs` revision; build a macOS arm64 core library,
  standalone executable, and minimal C ABI test host using the same core.
- Adapt the compiler driver into an explicitly owned session using its existing
  region/program cleanup facilities. Avoid invoking the process-exiting CLI main.
- Run repeated create/build/destroy cycles in one process, including successful
  checks, type errors, syntax errors, and switching between projects.
- Test that copied results remain readable after session destruction, no stale
  caches contaminate the next project, and live memory does not grow per build.
- Include standard libraries and check host declarations without Node/npm on PATH.
- Build one TOP and one CHOP entry with transitive local imports.
- Verify intentional syntax/type errors and source positions.
- Execute successful bundles through the existing native runtime checks.
- Record binary size, cold/warm check/build times, memory, and required runtime files.

Gate: demonstrate the combined binary and reusable in-process lifecycle. Upstream
API existence is evidence of feasibility, not proof that our composition already
works. This is an implementation spike, not a requirement for a separate-process
product or a long production-hardening phase.

### 1. Deliver the standalone CLI and templates

- Implement JSON config/schema, bundled SDK handling, multiple entries, and target
  callback adapters.
- Add build/check/watch, event debounce, dependency invalidation, atomic publication,
  last-good behavior, and structured diagnostics.
- Support plain WGSL imports as strings.
- Supply copyable templates that require no repo-relative absolute paths.
- Share compilation for repeated use of one entry while retaining runtime isolation.

Gate: copied templates build and watch offline on a machine without Node, npm,
Deno, Rust, or native compiler tooling installed. Saving an error must leave the
current sketch running; correcting it must recover without restarting the watcher.

### 2. Preserve the full avTools shader workflow

- Prebundle the existing TypeScript generators and `wgsl_reflect` at our release
  build time, then embed that JS in the executable.
- Test execution in an embedded JS engine such as QuickJS. Expose only the small
  generator interface needed to turn source strings into wrapper strings.
- Match all four generator contracts and maintain their shared source of truth.
- Test material, stroke material, fragment effect, and compute examples, including
  malformed inputs, deleted files, type output, and runtime rendering.

If embedded-engine compatibility is poor, evaluate porting the generator layer
with parity tests. Do not silently drop shader generation or make users install
Node as an undocumented fallback. Basic CLI delivery may precede this stage, but
the old runner is not fully replaced until it passes.

### 3. Integrate the build core directly with the C++ operators

- Expose the core as a Rust static library or dylib with a small C ABI: create
  project subscription, request build, drain events, and destroy subscription.
  Specify ownership/free functions for strings and buffers crossing the boundary.
- Include the build core and required notices/resources in the plugin distribution;
  no download or native build at project-open time. Keep the standalone CLI as a
  distributable external watcher and diagnostic/test tool.
- Add Project Directory, Entry, and automatic build/reload controls while retaining
  existing prebuilt-bundle loading.
- Automatically subscribe to one project watcher per canonical project and
  compatible tool/SDK configuration. Reference-count users, clean up unused
  subscriptions, and send builds to the shared serialized service. Each build
  still uses a fresh compilation session.
- Display build state and source diagnostics through TD parameters/Info DATs.
- Implement a lightweight bundle-directory watcher. Its background callback marks
  a pending revision; it must not call TD APIs or enter the sketch V8 isolate.
- Transfer the revision to the runtime at a controlled boundary. Read bundle data
  only when changed; retain existing generation cleanup and restart semantics.
- Prefer compilation off TD's cook thread and off each sketch's independent timing
  thread. Multiple instances may share bundle bytes, never mutable script state.
- Define shared service ownership across TOP/CHOP plugin binaries so separate
  copies do not incorrectly assume they control process-wide compiler state.
- Stop accepting work and finish outstanding compiler tasks before releasing their
  resources or unloading library code. For the initial implementation, allowing an
  in-flight build to finish is simpler than forced cancellation.

Define paused/unused-operator semantics explicitly: a build can finish while TD is
paused; normal activation can wait until the next cook or an explicit reload. Do
not introduce forced cooking solely to acknowledge filesystem events.

Gate: the user copies a template, selects it in a TOP/CHOP, and edits in an IDE
without launching a terminal watcher. Verify project relocation, reopen, repeated
builds, operator deletion/recreation, and service shutdown. Direct linking is the
target, not an optimization that needs a separate business case. Stages 1–3 can
overlap; no polished CLI release is required before testing actual TD integration.

### 4. Optimize only where measurements justify it

- Add disk-based incremental reuse or retained compiler sessions only if full
  rebuild latency warrants the added lifetime complexity.
- Consider parallel builds only after serialized use is working and upstream
  global state has been checked for compatibility.
- Improve frame-time isolation, cancellation responsiveness, and runtime source
  map reporting as needed for actual use. Production crash isolation is optional.

## Validation and performance

- Compare actual avTools projects against the current TypeScript checker and
  runner. Account explicitly for the TS5-to-TS7 checker/configuration transition.
- Test aliases, declarations, transitive helpers, supplied third-party dependencies,
  all shader generators, and runtime callbacks.
- Exercise atomic editor saves, rename/delete/create, rapid saves during checking,
  config edits, missing-import recovery, and no-op output updates.
- Verify source errors never replace the last successful bundle and stale builds
  never become current. Verify watcher failures produce actionable status.
- Run repeated in-process compilation-session creation/destruction and measure
  live allocation/region growth, retained allocator capacity, idle CPU, completion
  of outstanding work, and clean shutdown. Include error-path teardown and
  alternating projects; do not test only successful repeats of one source file.
- Measure cold and warm edit-to-bundle and edit-to-visible-result latency.
- Run four actual TOP/CHOP instances while editing; record TD frame times and
  per-operator cook time during and outside rebuilds. Cap worker count based on
  these results rather than upstream throughput benchmarks. Occasional stalls are
  acceptable for this internal version; report them without treating a strict
  realtime budget as a blocker.
- Test signed release packaging on a clean Apple Silicon setup with no development
  runtimes installed. Keep platform boundaries modest so Windows can follow later.

## Known risks and non-goals

- `tsrs` is experimental and its internal APIs may change. Pin revisions, retain
  conformance cases, and keep its adapter replaceable. Do not imply it is a drop-in
  replacement for the TypeScript 5 compiler API used in the current runner.
- Rolldown's native API is usable, but our options/plugins and lifecycle need their
  own tests and pinned dependencies.
- Existing shader generation is JS/TS code, not a feature Oxc provides automatically.
- Typechecking and successful bundling cannot guarantee user callbacks terminate or
  eliminate runtime errors. No additional sandbox is proposed here.
- State-preserving HMR, Vite/browser preview, a custom language server, automatic
  arbitrary npm installation, production crash isolation, and aggressive
  incremental caching are not MVP goals. Direct in-process compilation is a goal.
- Preserve license/attribution files for all shipped compiler, library, SDK, and
  embedded-engine components.

## Research references

These sources were inspected on 2026-10-20. Recheck the pinned revisions before
implementation; upstream `main` and published releases may differ.

- [Oxc Rust transformer integration](https://oxc.rs/docs/guide/usage/transformer.html)
- [Rolldown native Bundler API](https://docs.rs/rolldown/latest/rolldown/struct.Bundler.html)
- [Rolldown Rust exports](https://github.com/rolldown/rolldown/blob/main/crates/rolldown/src/lib.rs)
- [tsrs compiler-driver library](https://github.com/oxc-project/tsrs/blob/main/crates/tsrs_execute/src/lib.rs)
- [tsrs CLI lifecycle](https://github.com/oxc-project/tsrs/blob/main/crates/tsrs_cli/src/main.rs)
- [tsrs arena and region APIs](https://github.com/oxc-project/tsrs/blob/main/crates/tsrs_core/src/lib.rs)
- [tsrs watch memory and remaining global state](https://github.com/oxc-project/tsrs/blob/main/notes/watch-memory.md)
- [tsrs program-region cleanup](https://github.com/oxc-project/tsrs/blob/main/notes/mem-build-free-programs.md)
- [tsrs compatibility](https://github.com/oxc-project/tsrs/blob/main/docs/COMPATIBILITY.md)
- [tsrs API limitations](https://github.com/oxc-project/tsrs/blob/main/docs/NODE_API.md)
- [tsrs release notes](https://github.com/oxc-project/tsrs/blob/main/docs/STATUS.md)
- [notify filesystem watcher](https://docs.rs/notify/latest/notify/)
- [QuickJS Rust bindings](https://github.com/DelSkayn/rquickjs)

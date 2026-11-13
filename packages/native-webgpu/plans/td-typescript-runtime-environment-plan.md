# TypeScript environment declarations for TouchDesigner sketches

Status: implemented 2026-10-20 in SDK 2. See [the environment guide](../TD_TYPES.md),
`tools/td-native-build/tests/environment.mjs` and `runtime-environment.js` for the
resulting contract and verification. The investigation below is retained as design
history; “current checkout” findings describe the pre-implementation baseline.
The optional ambient-leakage warning remains a possible follow-up.

## Goal and user intent

Make editing TD sketches feel like ordinary TypeScript, including normal npm
package imports, while giving accurate editor completion and useful compile-time
errors for APIs that the embedded runtime does not provide. The user considers
calling unsupported platform APIs a programming error, not grounds for banning
otherwise usable packages.

Supply a TD environment in the same way a project selects browser or Node types:
standard ECMAScript declarations plus declarations for the actual TD host. Do not
advertise the whole browser or Node environment. This is developer assistance,
not a sandbox or a proof that arbitrary npm code will run successfully.

Dependency resolution/watch support is separate ongoing work in the main thread.
Reinspect its current code before implementation; do not revert or duplicate it.
This plan does not add package installation, runtime Node APIs, network APIs, or
browser polyfills.

## Findings from the current checkout

- `tools/td-native-build/template/tsconfig.json` includes `ES2022` and `DOM`.
  Consequently VS Code and the checker currently accept browser APIs absent in TD.
- The SDK already sets `types: []`, but this only controls automatic ambient
  package inclusion. It does not prevent imported declarations from including
  Node/DOM types explicitly.
- `packages/native-webgpu/native/embedded/Runtime.cpp` and `polyfills.js` define
  the common embedded global environment. Use these as the implementation source
  of truth, plus actual runtime probes for inherited V8 and Dawn globals.
- `td-chop.d.ts` imports `typeof Timing` from the core-timing **source** module.
  The SDK maps `@avtools/core-timing` to source as well. That pulls implementation
  feature detection, including optional `MessageChannel`, into sketch checking.
  `td-sketch.d.ts` already uses emitted timing declarations through a different
  path; the SDK preparation script rewrites that path.
- `td-sketch.d.ts` gets its P5 types through the general native-webgpu entry point.
  That entry point also advertises NodeTextEngine, GPUWindow and createGPU. It has
  an explicit `@webgpu/types` reference. These are broader than the TD sketch API.
- The copied `@webgpu/types` declaration uses supporting browser types, including
  EventTarget, BufferSource and image/canvas types. Removing DOM alone is not a
  complete fix. P5 declarations also contain a few platform-dependent signatures.
- `prepare-assets.mjs` regenerates the SDK and the CLI's embedded template. Editing
  only a copied SDK or `assets/template.json` would not produce a durable fix.

Read-only probes using the locally installed TypeScript compiler found:

1. A synthetic ES2022-only program with explicit console/timer declarations accepts
   promises and typed arrays, and rejects `fetch`, `document`, `window`, `process`,
   `Buffer` and `node:fs` with ordinary TypeScript diagnostics.
2. Removing DOM from the current template produces 27 diagnostics with its existing
   skipLibCheck setting. Most are in timing source: missing host globals and the
   optional MessageChannel branch.
3. With declaration checking enabled too, there are 55 diagnostics, including 19
   in the WebGPU declaration, 27 in timing source, and the remaining errors in
   emitted timing/P5/native-webgpu declarations. This is a baseline, not a stable
   count to assert after concurrent code changes.
4. A dependency containing `/// <reference lib="dom" />` makes `document.title`
   type-check even with `lib: ["ES2022"]` and `types: []`. This was reproduced with
   an entirely in-memory compiler host; no source files were changed.

These probes used ordinary TypeScript, not the native tsrs checker. Agreement
between the two is an implementation acceptance criterion below.

## Proposed contract

### 1. A small, canonical common runtime declaration

Add a canonical declaration such as `packages/native-webgpu/td-runtime.d.ts` and
copy it into the generated SDK. Include it explicitly in sketch configuration.
Use actual globals, with useful overloads and comments, not a broad index signature
on globalThis and not imported DOM/Node interfaces that claim extra capabilities.

Audit and declare the supported surface:

| API | Declaration requirements |
| --- | --- |
| Standard JS | Start with ES2022, preserving the current target. Do not confuse language target with host APIs. |
| console | log/error/warn/debug only, unless the runtime actually supplies more. |
| performance | now() only; do not advertise mark(), measure(), etc. |
| crypto | randomUUID() only; no implicit subtle/getRandomValues support. |
| setTimeout/clearTimeout | Numeric handles, callable callbacks, supported extra callback arguments; no string-eval overload or Node Timeout methods. Timers remain independent of TD frames. |
| setImmediate/clearImmediate | Numeric handles and supported callback arguments. |
| queueMicrotask | Callable callback. |
| requestAnimationFrame/cancelAnimationFrame | Numeric handles; document that callbacks follow accepted TD frame requests and do not manufacture frames while playback is paused. |
| Event/EventTarget/DOMException | Only implemented constructors, properties, methods and options. Do not copy the complete DOM versions. |
| AbortController/AbortSignal | Only implemented members; do not advertise static timeout/any/abort helpers unless actually supplied. |
| Global event listeners | Match the implemented event surface, including rejection events where part of the public contract. |

Do not expose internal __host/__av/nativeGPU/nativeText globals merely because
they are present. Decide explicitly whether any legacy raw readFile binding is
public; prefer the already documented host.readFile capability for TOP sketches.
Do not introduce new runtime capabilities as a shortcut to satisfying declarations.

### 2. Accurate timing and P5 types

The portable restart plan supersedes the earlier declarations-only timing alias.
SDK 3 distributes ordinary core-timing source, and both host types and direct
imports resolve to that same source identity. The native checker validates it
against the actual supported runtime primitives. P5 and GPU types still use the
emitted/derived declaration trees. `host.timing` remains a compatibility API;
normal bundled imports are supported without a hidden host dependency.

- Keep the timing library's own multi-platform source checking in its existing
  environment. A fallback mentioning MessageChannel does not justify advertising
  MessageChannel to every TD sketch. If checking source is needed for a development
  workspace, use a properly typed optional capability check rather than adding a
  fictitious global implementation.
- Give TD a narrow P5 type entry that describes the instance actually passed to
  setup/draw. Avoid importing/exporting NodeTextEngine, GPUWindow, createGPU, or
  unrelated platform constructors just to obtain P5GPU/P5GPUImage types.
- Audit public P5 signatures involving URL, DOM images or browser canvas. Remove
  or narrow unsupported TD-facing forms while preserving actual texture-based
  operations. Keep common portable types generated/shared where possible.

### 3. WebGPU declarations without a browser environment

Prefer reusing the upstream WebGPU declarations, with a small explicit TD adapter,
over hand-maintaining the full GPU API. Investigate the minimal dependency closure
with skipLibCheck disabled before choosing the exact adapter.

- Supporting data types such as BufferSource can be defined accurately without
  importing DOM globals.
- Event support must match the host and Dawn binding; declaring a type does not
  imply its constructor is available globally.
- Unsupported external-image/canvas APIs should be omitted/narrowed in a generated
  TD-specific declaration variant if needed. Do not add permissive empty interfaces
  or any aliases that make arbitrary values look like valid browser image sources.
- If a derived upstream declaration is necessary, retain its license/version and
  add deterministic generation with assertions that expected patch points exist.
  Do not silently continue when an upstream update changes those declarations.
- Inspect actual Dawn-provided globals before declaring constructors. Object
  interface types and callable runtime constructors are separate decisions.

The common profile should not imply that CHOPs expose the TOP's GPU globals.
Provide a TOP extension profile if necessary. A mixed TOP/CHOP project can retain
one union profile for convenience, with that limitation documented; strict
per-target checks can use separate configs in their sketch subdirectories.
Do not make users split every mixed project merely to adopt the base improvement.

### 4. Normal TypeScript configuration

The default sketch config should use ES2022 without DOM or WebWorker, explicit TD
ambient declarations, types: [], and existing strict/module settings. Keep normal
typing for imported npm modules, including packages with bundled declarations or
separate @types dependencies. Coordinate inherited typeRoots with the main thread's
package-resolution work; do not accidentally make project node_modules/@types
unreachable while trying to avoid automatic Node globals.

Keep Node-based build scripts/tests in a separate tsconfig with Node types. The
runtime package's own build configuration may legitimately need broader platform
types; this change primarily concerns user sketch configurations and their SDK.

The SDK should extend normal TS configuration, not require an editor plugin. Use
the same declarations for VS Code/tsc and the native checker. Do not recommend
installing @types/node or adding DOM as a generic fix for missing TD types.

## Limits and dependency compatibility policy

TypeScript is not an environment-capability validator:

- A compiled npm package may call fetch internally while its .d.ts exposes only
  a harmless-looking function. The package's JS implementation is not necessarily
  type-checked as part of the consuming sketch.
- Explicit dependency references/global augmentations can reintroduce DOM/Node
  declarations. types: [] is not an allowlist of permitted imported packages.
- skipLibCheck suppresses declaration-file checks; it does not stop declaration
  loading or global augmentation. Turning it off does not solve ambient leakage.
- any, assertions, dynamic property access and user-provided declarations can
  bypass compile-time guidance. No security guarantee is intended.

Use accurate default declarations as the primary UX. Keep unresolved imports and
unbundled Node built-ins as actionable build errors. Do not reject a package just
because it contains optional platform-detection code or a Node type reference.
Coordinate existing bundler global-name guards with the main thread; they must
not be mistaken for exhaustive protection or reject safely guarded fallback code
solely because an unavailable name appears syntactically.

Optional follow-up: report a nonfatal diagnostic when an actual sketch program
loads lib.dom/lib.webworker or Node ambient declarations, explaining that those
declarations weaken TD-environment checking. Use resolved compiler source files,
not a package-name blacklist. Do not expand the first implementation into a
custom static analyzer or make this warning a prerequisite for basic support.

## Implementation sequence and integration points

1. Audit globals and public host/P5/GPU types; add canonical common declarations
   and focused compiler fixtures. Verify supported members against native runtime
   probes, including partial APIs and constructor availability.
2. Normalize timing declaration paths; isolate TD-facing P5 types; implement the
   minimal WebGPU declaration adapter. Type-check first-party declaration tests
   with skipLibCheck:false so missing dependencies are not hidden by any.
3. Update SDK preparation and sketch configs. Keep canonical files as the source
   of truth; regenerate template/sdk, assets/template.json, and the copied native
   example SDK using the existing release workflow. Bump the SDK snapshot version.
4. Run both ordinary TypeScript and native checker tests against fresh init output
   and relocated projects. Coordinate with ongoing npm/workspace resolution tests.
5. Package the updated compiler/template distribution and update pointers through
   the existing packaging process. If only declarations/template assets change,
   avoid an unnecessary runtime redesign, but ensure shipped init really extracts
   the new profile and existing copied SDKs remain explicit upgrades.
6. Update native builder and example READMEs with the supported environment,
   package compatibility limits, and separate tooling tsconfig guidance.

Relevant existing files:

- `tools/td-native-build/scripts/prepare-assets.mjs`
- `tools/td-native-build/template/tsconfig.json` and generated `template/sdk/`
- `tools/td-native-build/src/checker.rs` and `src/bundler.rs` (currently evolving)
- `tools/td-native-build/tests/behavior.mjs` and native runtime tests
- `packages/native-webgpu/td-chop.d.ts`, `td-sketch.d.ts`, emitted public types
- `packages/native-webgpu/native/embedded/Runtime.cpp`, `polyfills.js`
- `packages/native-webgpu/src/td-timing.ts`, `td-runtime.ts`, `td-chop-runtime.ts`
- `apps/td-projects/native/tsconfig.json` and its copied SDK

Do not modify the older Node-watcher projects' environment blindly; audit their
browser/Node tooling and sketch config separation before applying the same profile.

## Acceptance tests

Run the core fixtures through BOTH ordinary TypeScript and native avtools-build
check/build. Assert diagnostic locations/categories rather than identical wording
or every diagnostic code across compiler versions.

- Valid: ordinary JS, promises, typed arrays, typed npm utility imports, host input/
  output APIs, TimeContext inference/cancellation, numeric timers with arguments,
  performance.now, crypto.randomUUID, supported event APIs and raw GPU rendering.
- Invalid: direct window/document/fetch/WebSocket/process/Buffer use under the
  default profile; unsupported console/performance/crypto/AbortSignal methods;
  timer-handle .ref()/.unref(); string timer callbacks; unsupported public P5 APIs.
- Verify that unsupported Node imports do not become runtime globals or silently
  bundle as empty stubs. A clear unresolved/built-in error is acceptable even if
  an explicitly imported declaration package makes the import type-check.
- A type-only timing import must not pull timing implementation source into the
  sketch program or bundle another scheduler. Inspect compiler loaded files and
  bundle modules, not merely successful compilation.
- Check representative raw power2d/shader-fx examples and all generated WGSL wrapper
  variants, including their public GPU types, without enabling DOM.
- Test @types/node installed for unrelated tooling: it must not enter implicitly.
  Separately test explicit DOM/Node references from a dependency and document the
  resulting leakage; do not claim the profile prevents it.
- Include an npm utility with a safely guarded optional platform path; do not
  reject an otherwise compatible package by simplistic lexical scanning.
- Fresh CLI init and copied/relocated template must expose the same accurate types
  without repository-specific absolute paths or extra editor setup.
- Run a small native runtime smoke check for each declared host capability, and
  negative checks for partial API members. Existing TD fixture verification can
  confirm normal TOP/CHOP sketches still build/reload; no performance benchmark
  rerun is needed for declarations alone.
- Verify IDE behavior using the actual TypeScript program/language service used
  by the selected SDK setup; do not claim a VS Code UI test unless one was done.

## References

- [TypeScript lib](https://www.typescriptlang.org/tsconfig/lib.html): select language
  and host-environment library declarations independently.
- [TypeScript types](https://www.typescriptlang.org/tsconfig/types.html): controls
  automatic global type inclusion, not normal typing of imported modules.
- [Triple-slash references](https://www.typescriptlang.org/docs/handbook/triple-slash-directives.html):
  dependencies can explicitly include type packages and built-in libraries.
- [skipLibCheck](https://www.typescriptlang.org/tsconfig/skipLibCheck.html): skips
  declaration checking, not inclusion.

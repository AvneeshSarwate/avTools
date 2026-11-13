# TypeScript for the embedded TouchDesigner runtime

The native builder's SDK 3 gives VS Code, ordinary TypeScript and the native
checker the same environment: ES2022 plus the APIs supplied by the avTools TD
plugins. Open the [native example directory](../../apps/td-projects/native/README.md)
in VS Code; no editor extension or repository-specific absolute aliases are needed.
The native compiler does not require a Node installation. Installing additional npm
packages remains a separate step using your preferred package manager.

## Runtime profiles

The common [`td-runtime.d.ts`](td-runtime.d.ts) describes numeric timers,
`setImmediate`, microtasks, TD frame callbacks, the implemented event/abort APIs,
`console.log/error/warn/debug`, `performance.now()` and `crypto.randomUUID()`.
Timers advance independently of TD playback. `requestAnimationFrame` follows
accepted TD frame requests; it does not generate frames while playback is paused.

[`td-top-runtime.d.ts`](td-top-runtime.d.ts) adds Dawn WebGPU interfaces and actual
TOP GPU globals. Unsupported browser image/canvas sources are narrowed to `never`;
interfaces do not imply that their objects can be constructed with `new`.
P5 types describe the instance passed to `setup`/`draw`, without exporting a P5
constructor, NodeTextEngine, GPUWindow or createGPU. Load fonts using string paths.

The starter is a mixed TOP/CHOP project and includes the TOP profile for convenience.
That means a CHOP source in this project can see GPU globals in the editor even
though its runtime does not supply them. For a CHOP-only project, replace the TOP
profile in the root tsconfig's `include` with:

```json
"sdk/packages/native-webgpu/td-runtime.d.ts"
```

For strict per-target editing in a mixed project, use separate sketch subdirectory
configs with the appropriate `files`/`include`. The native builder uses the nearest enclosing `tsconfig.json` for each TypeScript
File, checking that entry and its imports plus the config's ambient declarations.
Nested configs can therefore enforce different profiles within one project.

Keep `lib: ["ES2022"]` and `types: []`. The former chooses standard JS declarations;
the latter prevents automatic inclusion of unrelated installed ambient packages
such as `@types/node`. Imported libraries still get their bundled types or normal
`node_modules/@types` declarations. No restrictive `typeRoots` overrides are needed.
If you add Node-based tooling, give it a separate tsconfig with Node types and keep
its sources outside the sketch config's `include`.

## Timing, P5 and npm imports

```ts
import type { ChopHost } from '@avtools/native-webgpu/td-chop';
import type { TimeContext } from '@avtools/core-timing';
import type { P5GPU } from '@avtools/native-webgpu/td-p5';
```

SDK 3 resolves `@avtools/core-timing` to ordinary package source for both type and
value imports. Public host timing types reference that same source, avoiding a
second nominal class identity. `host.timing` remains available for compatibility;
new reusable code uses normal imports. See [RELOAD.md](RELOAD.md).

Ordinary npm imports, installed package declarations, shared relative imports,
tsconfig aliases and workspace symlinks are supported. The SDK's own third-party
packages use private `#avtools-*` mappings; installing `earcut` in your project uses
your version. See [the build guide](../../tools/td-native-build/README.md) for resolution
and watching behavior. Node built-ins, URL imports and package installation are
not provided by the embedded runtime/builder.

## What the types can and cannot catch

Direct `document`, `window`, `fetch`, `WebSocket`, `process`, `Buffer`, string timer
callbacks and Node timer methods fail under the default profile. Unsupported
members of partial APIs (for example `performance.mark` and `AbortSignal.timeout`)
also fail. This is editor guidance, not a compatibility proof or a sandbox:

- A package's compiled JS may call an unavailable API that its declarations never
  mention. Choose runtime-compatible packages and test their behavior.
- An imported declaration can explicitly reference DOM or Node types and add those
  globals back. `types: []` does not block this; `skipLibCheck: false` does not either.
- Assertions, `any` and user-written ambient declarations can bypass these checks.

Do not add DOM or Node types just to silence missing-API errors in a TD sketch.
Safely guarded optional platform branches are allowed; there is no global-name
blacklist. Unsupported Node built-in imports remain actionable bundle errors.

## Maintaining and verifying the declarations

`tools/td-native-build/scripts/prepare-environment.mjs` derives timing/P5 types from
first-party emitted declarations and the GPU types from pinned `@webgpu/types`
0.1.72, preserving its license. Patch-point assertions make upstream changes fail
explicitly. `prepare-assets.mjs` copies these into the SDK and embedded template.
An existing project SDK never upgrades silently: compare/copy a fresh CLI init SDK.

`tests/environment.mjs` in the native builder checks positive and negative fixtures
with both ordinary TypeScript and the native checker, including strict declaration
checking, loaded-file inspection and TypeScript language-service completions.
`tests/runtime-environment.js` checks the supported globals against embedded V8/Dawn.
These are language-service tests, not a VS Code UI automation test. The older Node
watcher examples retain their own configurations.

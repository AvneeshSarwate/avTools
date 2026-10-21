# TypeScript sketches for TouchDesigner

Open this folder in VS Code. The local SDK and tsconfig provide TypeScript types
without installing Node or an editor extension.

In an avTools TOP's **Build** page, select `sketches/background/main.ts` as
**TypeScript File**. In an avTools CHOP, select `sketches/channels/main.ts` and set
**Output Channels** to `value ticks`, **Output Samples** to `1`. A wired input
channel named `value` is doubled; `ticks` advances independently with TimeContext.
The Create Template Project button configures the operator that created this folder.

Add more .ts entries anywhere under this tsconfig and select them on other
operators. Share helpers using ordinary imports. No manifest or bundle paths are
needed. Each operator checks its entry and dependencies; unrelated sketches can
have errors without blocking it. All operators use their own runtime state.

Automatic Builds reloads changed bundles after saving. Build Script requests a
manual build. Type errors preserve that entry's last working bundle. Runtime
caches live in `.avtools/entries/`; these are disposable and not source files.

Import TimeContext functions normally from `@avtools/core-timing`. Automatic Builds compiles; Automatic Reload controls activation. Reload adopts the latest successful bundle; Reset restarts the active bundle. Each activation starts fresh module/global state. Installed
npm packages and linked/shared source work, but dependencies must use APIs supported
by embedded V8/TD. Node and browser APIs are not supplied. Package installation is
separate from the native builder. This mixed starter includes TOP GPU types; use
`sdk/packages/native-webgpu/td-runtime.d.ts` instead of `td-top-runtime.d.ts` in
`tsconfig.json` for a CHOP-only environment.

Local WGSL files can be imported as strings. Shader conventions `.material.wgsl`,
`.strokeMaterial.wgsl`, `.fragFunc.wgsl` and `.compute.wgsl` generate typed wrappers
under `generated/`, retaining the shader's project-relative directories. Only
wrappers used by the selected entry affect its build.

Optional CLI: `avtools-build build-file sketches/background/main.ts top` or
`avtools-build watch-file sketches/channels/main.ts chop`. No terminal watcher is
required when using the plugin's Automatic Builds toggle.

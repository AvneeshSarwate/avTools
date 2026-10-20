# TypeScript directly in TouchDesigner

Open **[project.toe](project.toe)**. It contains four 1080p avTools TOPs and four
avTools CHOPs using the same editable TypeScript project. Compilation and watching
happen inside the native plugins; no npm install or terminal watcher is required.

Open this folder in VS Code. The checked-in SDK and relative tsconfig aliases give
ordinary TypeScript completion immediately. Save `sketches/channels/math.ts` to
change the scalar transform, or edit `sketches/background/` to change the image.
Each successful changed bundle restarts its instances. A type/syntax/shader error
leaves the last working script running and appears in the operator's Info DAT.

The CHOP's `value` output is twice its wired input; `ticks` advances independently
through `host.timing`. The TOP draws a simple animated background. Each instance
has independent runtime state despite sharing one project compiler/watcher.

In each operator's **Build** page, Project Directory points here and Entry selects
`channels` or `background` from `avtools.json`. Clear Project Directory to return
to Sketch DAT or Source File mode. Disable Automatic Builds and pulse Build Project
for manual compilation. For CHOP entries, match Output Channels/Output Samples to
the schema in `avtools.json`.

You can copy this folder to another location. If it is outside the avTools checkout,
set the operator plugin paths to your copied distribution: keep the versioned
`.plugin` bundles alongside the `native-build/` directory from `prebuilt/macos-arm64`.
The example's startup script automatically locates plugins while it remains in
this repository; remove/adapt that startup path lookup for an external project.

The SDK is a project-local snapshot. It never updates silently. `generated/`,
`dist/`, and `.avtools/` are derived files and can be regenerated.

See [the native build guide](../../../tools/td-native-build/README.md) for the CLI,
configuration, shader generation, lifecycle, distribution, and development tests.

# TypeScript directly in TouchDesigner

Current lifecycle: [Build, Reload, and Reset](../../../packages/native-webgpu/RELOAD.md). Automatic Reload is per operator; Reload adopts available source, Reset restarts active source. Each activation creates a fresh isolate. SDK 3 supports ordinary TimeContext imports.


Open **[project.toe](project.toe)**, then open this folder in VS Code. Four 1080p
TOPs and four CHOPs compile/watch TypeScript inside the plugins. No npm install
or terminal watcher is required for this example.

Each operator's **Build → TypeScript File** points directly to its source:

| Instances | Entry | Behavior |
| --- | --- | --- |
| background1, background3 | `sketches/background/main.ts` | Orange circle |
| background2, background4 | `sketches/orbit/main.ts` | Blue orbiting circle |
| channels1, channels3 | `sketches/channels/main.ts` | Input × 2; independent timing ticks |
| channels2, channels4 | `sketches/offset/main.ts` | Input × 2 + 100; independent timing ticks |

Both TOP entries import `background/palette.ts`. Both CHOP entries use
`channels/math.ts`. Edit these helpers to update their dependent entries together.
Add another `.ts` entry and select it on an operator to add a different sketch.
There is no manifest and no bundle filename to configure. All entries use the
nearest `tsconfig.json`, and each instance has independent runtime state.

The native checker checks the selected entry and its imports, plus ambient
`.d.ts` files. Errors in unrelated sketches don't block it. A type/syntax/shader
error preserves its last working bundle and appears in the Info DAT. A successful
changed bundle restarts only its affected instances. Disable Automatic Builds and
press Build Script for manual rebuilding.

For CHOPs, Output Channels and Output Samples specify the output schema directly.
This example uses `value ticks`, one sample. Clear TypeScript File to use Sketch
DAT or Source File instead; new projects should leave Legacy Build fields empty.

## Start from an operator in your own project

Load the [prebuilt plugin distribution](../../../packages/native-webgpu/prebuilt/README.md),
choose **Template Directory** on the Build page, and press **Create Template Project**.
It writes the SDK, tsconfig, starter sources and README, then selects the matching
starter entry on that operator. CHOP creation also sets `value ticks`, one sample.
The directory can contain your `.toe`; creation refuses existing template paths
instead of overwriting them. Additional operators simply select other TS files.

You can copy this example folder elsewhere. Outside the avTools checkout, set the
operator plugin paths to your copied distribution: keep the versioned `.plugin`
bundles alongside their `native-build/` directory. Adapt/remove the example's
repository startup lookup for standalone distribution. The template button creates
sources, not plugin copies or another `.toe`.

SDK 3 supplies ES2022 plus TD APIs, without default browser/Node globals. It is a
project-local snapshot and never updates silently. Install npm dependencies in
this directory using your normal package manager, or import shared source through
relative paths, aliases and workspace links. Dependencies must use runtime-compatible
APIs; npm support doesn't add Node or browser APIs.

This mixed project includes the TOP type profile. Use the common profile for a
CHOP-only project. See [TD types](../../../packages/native-webgpu/TD_TYPES.md) and the
[native build guide](../../../tools/td-native-build/README.md) for details.
`generated/` and `.avtools/entries/` are disposable build outputs.

# TouchDesigner sketch projects

For a new project, copy the entire **[Plugins](Plugins)** folder beside your saved
`.toe`. It is the ready-to-use macOS Apple Silicon distribution, including both
operators and the native TypeScript builder. Follow **[Plugins/README.md](Plugins/README.md)**
for the GUI setup, template generation, source locations, and update instructions.
No Node install or native build is needed to use it.

[Plugins/version.json](Plugins/version.json) identifies the distribution with an
incrementing integer. The normal TOP/CHOP build commands in `packages/native-webgpu`
refresh this folder and the downloadable ZIP automatically; `npm run td:pack`
refreshes them from existing binaries. Versions increment only when shipped contents
change. Commit both outputs together. Edit their sources, not this generated folder.

Current lifecycle: [Build, Reload, and Reset](../../packages/native-webgpu/RELOAD.md). Automatic Reload is per operator; Reload adopts available source, Reset restarts active source. Each activation creates a fresh isolate. SDK 3 supports ordinary TimeContext imports.


The other subdirectories are TD pieces, each with a `.toe`, multiple TypeScript sketches,
project-local helpers/shaders, and one generated JavaScript bundle per sketch.

For the native workflow, open **[native/project.toe](native/project.toe)** and
open [its folder](native/README.md) in your IDE. TOP/CHOP operators compile and watch
TypeScript themselves using a TypeScript File per operator, without a manifest.
Create Template Project optionally creates the SDK/config/starter sources from the Build page. The copied SDK provides
IntelliSense immediately; there is no install step or external watcher. See the
[native build guide](../../tools/td-native-build/README.md) for configuration and
shader generation.

For the existing Node watcher workflow, start with [starter](starter/README.md). It includes an openable `project.toe`,
Power2D and shader-fx examples, TimeContext animation, CHOP controls, and pulses.
For procedural channel animation and XY buffers, start with
[channels](channels/README.md), which uses the V8/TimeContext CHOP and the same watcher.

## Node watcher workflow

The [prebuilt native plugin](../../packages/native-webgpu/prebuilt/README.md) is
included in this checkout for macOS 15+ Apple Silicon. Install TouchDesigner,
then use Node 22.20.x:

```sh
cd apps/td-projects/starter
npm run setup
npm run dev
```

Open `starter/project.toe` in TouchDesigner and open the starter directory in your
IDE. The saved project contains two 1920×1080 TOPs. The watcher generates typed
WGSL wrappers, checks TypeScript, and bundles each configured entry into `dist/`.
Saving a successful change replaces the affected bundles; their TOPs restart on
the next cook. Local state and timing loops reset. A failed build leaves the last
working bundles running. No browser, network server, or plugin rebuild is needed
for sketch edits.

Use `npm run build` for a one-time build and `npm run check` for native rendering,
pulse, and reload checks. Keep `npm run dev` running while editing; stop it with
Ctrl-C. Watch events are filesystem notifications, not a polling loop. A paused
or unused TOP picks up the new bundle when it next cooks.

## Organize a piece

Copy the starter to a sibling folder for each TD project. Each folder owns its
`.toe`, `sketches/<name>/`, `shared/` helpers, and `td-sketches.config.ts`. Add entry
points to the config and point the corresponding TOPs at their `dist/<name>.js`.
A shared-helper edit rebuilds all affected bundles. Instances have independent
state even when they load the same file.

Commit sources, config, and the saved TD project; generated shader wrappers,
bundles, and IDE mappings are rebuilt by setup. To share a runnable piece without
Node, include its `.toe`, built `dist/`, and compatible native plugin. See the
[starter guide](starter/README.md) for exact plugin placement and controls.

The shared [project runner](../../tools/td-sketch-build/README.md) owns generation,
checking, bundling, and watching. Projects declare their layout in a small config;
the runner does not depend on their location under `apps/`.

## CHOP entries

CHOP sketches use `host.inputs`, persistent `host.outputs`, `host.timing`, and an
optional synchronous `onCook`. Configure them alongside TOP entries:

```ts
sketches: {
  image: 'sketches/image/main.ts', // TOP
  motion: {entry: 'sketches/motion/main.ts', target: 'chop', outputs: ['x', 'y'], samples: 10000},
}
```

Set the corresponding TD CHOP's Output Channels to `x y`, Output Samples to
`10000`, and Source File to `dist/motion.js`. Config output layouts are used by
`npm run check`; they do not modify the TD network. Scalar control channels use
the default sample count of 1. See the [CHOP API](../../packages/native-webgpu/CHOP.md).

### Per-operator execution mode

TOPs and CHOPs expose **Wait for Current Result** (`Samecook`). CHOP defaults on
for same-cook transforms; TOP defaults off. Turn it off on a CHOP to let its timing
worker run independently and return the latest complete channel buffer. Pending
inputs can coalesce under load. The script API and bundler are unchanged, and
switching modes preserves runtime state. Pre-trigger TOPs remain nonblocking.
See [the execution guide and example](../../packages/native-webgpu/EXECUTION_MODES.md).

The native workflow's SDK 3 supports normal installed npm imports and watched shared
source/workspace links. Its [TD type environment](../../packages/native-webgpu/TD_TYPES.md)
uses ES2022 plus the embedded host API; Node/browser globals are not enabled by default.

## Script-declared controls

TOP and CHOP TypeScript entries can export native parameter definitions. The new
template includes `sketches/parameters/picture.ts` and `channels.ts`; see the
[parameter API](../../packages/native-webgpu/PARAMETERS.md) and openable
[Parameters.toe example](../../packages/native-webgpu/native/td/parameter-example/Parameters.toe).

The plugin's **Template Parent Folder** picker selects the enclosing directory.
**Create Template Project** creates `avtools-project/` inside it and selects the
starter TypeScript entry. Open that child folder in VS Code. Its README lists API
examples (controls, buffers, input images and timing); its `.gitignore` excludes
the generated SDK. Restore the SDK from a fresh template of the same plugin
version when cloning a code-only project.

Each current `.plugin` bundle is independently copyable, including its static TypeScript compiler and libuv. Both TOP and CHOP hosts support [async files and OSC/UDP](../../packages/native-webgpu/IO.md); generated templates include examples.

Native MIDI input/output is bundled in both operators. Generated projects include
MIDI device-selector and TimeContext examples plus the full API reference in their
README. See [MIDI guide](../../packages/native-webgpu/MIDI.md).

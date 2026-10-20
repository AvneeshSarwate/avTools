# TouchDesigner sketch projects

Each subdirectory is a TD piece, with a `.toe`, multiple TypeScript sketches,
project-local helpers/shaders, and one generated JavaScript bundle per sketch.

For the native workflow, open **[native/project.toe](native/project.toe)** and
open [its folder](native/README.md) in your IDE. TOP/CHOP operators compile and watch
TypeScript themselves using Project Directory and Entry. The copied SDK provides
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

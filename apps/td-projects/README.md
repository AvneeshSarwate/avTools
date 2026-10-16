# TouchDesigner sketch projects

Each subdirectory is a TD piece, with a `.toe`, multiple TypeScript sketches,
project-local helpers/shaders, and one generated JavaScript bundle per sketch.

Start with [starter](starter/README.md). It includes an openable `project.toe`,
Power2D and shader-fx examples, TimeContext animation, CHOP controls, and pulses.

## Edit in your IDE, preview in TouchDesigner

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

# IDE → TouchDesigner starter

Open **project.toe** after the setup below. It runs two independent, file-backed
1920×1080 Sketch TOPs: Power2D particles and a shader-fx background. Edit their TypeScript or
WGSL in your IDE, save, and watch the result in TouchDesigner. Each successful
changed bundle restarts its sketch, including local variables and TimeContext loops.

## First run

The [prebuilt native plugin](../../../packages/native-webgpu/prebuilt/README.md)
is included in the repository; no native build is needed. Install TouchDesigner
on macOS 15+ Apple Silicon and use Node 22.20.x for the project tools.
The bundled plugin includes the `host.onDispose` support this starter needs.

From this directory:

```sh
npm run setup
npm run dev
```

Then open `project.toe`. Its embedded startup DAT finds the checkout's selected
prebuilt plugin and the two `dist/*.js` files. The generated bundles are not checked
in, so build before opening. Keep the watcher running while editing.

Open **this directory** in VS Code for the included TypeScript/Deno settings.
`npm run setup` generates the import-path configuration for autocomplete. No Deno
extension or browser server is required. If opening the whole avTools workspace,
add this directory as a workspace folder; keep Deno disabled for it.

## Try it

- Edit `shared/palette.ts`: both bundles rebuild; both TOPs restart.
- Edit `sketches/particles/main.ts`: only the particles bundle changes.
- Edit `sketches/background/shaders/waves.fragFunc.wgsl`: its typed wrapper and
  background bundle regenerate.
- Select the enclosing component and change **Amount** to change particle speed
  and background contrast. Select either TOP, set **Event Name** to `Trigger`,
  and press **Send Pulse**: particles reverse, or the waves shift phase.
- Pause playback, wait, then resume: independent TimeContext loops have continued.
- Introduce a TypeScript error: the terminal reports the original file/line and
  the previous bundle keeps running. Fix and save to resume updates.

`sketch1` renders particles into `out1`; `sketch2` renders waves into `out2`.
Both use **Source File** with an empty **Sketch** DAT parameter. The internal
`sketch` DAT is only a note. The inherited `image` TOP is unused and unwired.
Info DATs show runtime errors; the watcher terminal shows build errors.

## Project layout and commands

`td-sketches.config.ts` selects entry points and source/output directories.
`sketches/<name>/` holds each sketch's ordinary TypeScript and WGSL; `shared/`
holds helpers. Generated shader wrappers mirror the source path under `generated/`.
Each entry produces exactly one `dist/<name>.js`, including its dependencies and
shader strings. Instances loading the same bundle still have independent state.

- `npm run dev`: build immediately, then watch project files and workspace libraries.
- `npm run build`: generate shaders, check TypeScript and runtime imports, build.
- `npm run check`: build, then render each bundle through the actual embedded
  V8/Dawn bridge, send pulses, and reload repeatedly. Writes preview PPMs to `.td/`.
  Uses the included plugin; additionally requires Apple Command Line Tools to
  compile the small native test harness. Normal build/watch does not need them.

Copy this folder to a sibling under `apps/td-projects/` to start another piece;
run setup in the copy. Add entries to the config for more sketches, then create
TOP instances pointing at their bundles. The runner has no fixed entry names or
dependency on this example's directory layout. For a folder outside this checkout,
update its package scripts and config's type import to reference the shared tool;
run setup to regenerate absolute IDE mappings. The shared avTools source checkout
is still a build dependency, not a published npm SDK.

To hand off the **running piece**, include `project.toe`, `dist/`, and a compatible
plugin at `Plugins/AvToolsSketch.plugin`. The recipient needs TouchDesigner but
does not need Node, the source checkout, or the watcher. Third-party data/assets
read at runtime must travel separately. `project.tox` is an optional reusable
component: set its Plugin Path, and keep `dist/` beside the receiving `.toe`.

See the [tool guide](../../../tools/td-sketch-build/README.md) for the callback
contract, custom shaders, checks, and limitations. The small Python builder there
regenerates the saved `.toe`/`.tox`; it is not needed to open them.

See [validation and 1080p timings](VALIDATION.md) for per-TOP CPU measurements,
two/four-instance upload-inclusive frame times, and how to repeat the benchmark.

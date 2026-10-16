# avTools Sketch example

**Open `Sketch.toe` to run the example.** It is a standalone TouchDesigner project
with the network and a live output preview. Its embedded startup script finds this
checkout's prebuilt plugin automatically; no Textport commands are required.

`Sketch.tox` is the reusable TouchDesigner component kept beside the C++ TOP
source. Its JavaScript, CHOP, TOP input, and two renderer instances are embedded;
there are no machine-specific paths or external image/font dependencies in the
fixture. The native plugin bundle is checked in separately under
[`prebuilt/macos-arm64`](../../../prebuilt/README.md).

## TimeContext example

Open **TimeContext.toe** for two autonomous timing instances. Its counter and ball
are driven by `host.timing.launch`; a second counter uses `waitFrame`. Pause TD,
wait, then resume: realtime ticks jump forward while frame ticks resume normally.
Set Event Name to `Trigger` and Send Pulse to toggle the realtime root, or use
`start`, `stop`, or `reset`. The other TOP stays independent. `TimeContext.js` is
the readable source; `TimeContext.tox` is the reusable component. See
[the timing guide](../../../TIMING.md). The same plugin lookup applies below.

## Open from this checkout

With TouchDesigner installed on macOS 15+ Apple Silicon, double-click **Sketch.toe**
in this directory. The checkout includes the native plugin; no build is needed.
In a release ZIP, open `Sketch.toe` beside the supplied `Plugins` directory.
The native plugin is a separate bundle, not embedded in the `.toe`.

To add the example to an existing project instead, run this in TouchDesigner's
Textport, substituting your checkout path:

```python
import runpy
runpy.run_path('/path/to/avTools/packages/native-webgpu/native/td/example/load_example.py')
```

The loader creates a new component under `/project1`, reads the current plugin
location from `prebuilt/macos-arm64/current.txt`, and starts both TOPs. Buffered results appear on subsequent cooks; the Info DATs show errors/status. It does not replace
existing operators or save your project. Enter the printed component path to
see its network; view `out1` or `out2` to start animation.

Alternatively, drag `Sketch.tox` into any TD project and set its **Plugin Path**
parameter to the complete built `.plugin` bundle. Both internal TOPs use that one
parameter. The default is `Plugins/AvToolsSketch.plugin` relative to your project, which
matches the release ZIP: place its `Plugins` directory beside your saved `.toe`.

## Try it

- Change the component's **Amount**: the `controls` CHOP drives the background's
  red channel in both outputs. Blue advances with each sketch's cook count.
- Edit the internal `sketch` Text DAT to live-code. `sketch.js` alongside this file
  is a readable copy of the embedded source, not a live external file dependency.
- Select `sketch1`, leave **Event Name** as `Trigger`, and press **Send Pulse**.
  Its yellow circle samples `amount` for its radius; `sketch2` stays independent.
  Change Amount and pulse again. Missing CHOP channels return zero.
- The upper-left square comes from the wired `image` TOP. Change its color or
  replace it with another TOP. Rust-backed text reads “Dawn + Rust.”
- Change either TOP's **Width / Height**, or pulse **Reset** to rerun setup.
  `info1` and `info2` show status and transport details.
- Output is buffered by default, normally one frame behind. The new **Wait for
  Same Cook (Blocking)** toggle opts into synchronous output. An Info CHOP exposes
  frame age, skipped submissions, worker time, and upload-enqueue time.
- Optional early submission: enable **Pre-trigger Mode** on either or both TOPs.
  The single embedded `pretrigger` Execute DAT finds the enabled instances and
  submits/collects them in two passes. Its Python source is also `pretrigger.py`.
  Put useful independent project work in `between_passes(nodes)` to give workers
  more time before collection; the default hook does nothing and adds no delay.
  `before_submit(nodes)` can update controls or send event pulses. Same-frame
  output is opportunistic; an unfinished result uses the previous output.
  Place one coordinator at the common ancestor of participating TOPs in your
  project. The toggle is off by default and overrides the blocking Same Cook
  option while on.
- Optional Syphon: enable **Enable Syphon** on one renderer, then create a Syphon
  In TOP and select its advertised `avTools Embedded:...` name. Names include the
  operator path to distinguish instances. **Syphon Only** returns a 1×1 placeholder
  on the renderer; view the Syphon receiver for the full image. Keep the publisher
  cooking. CPU TOP output is the default; wired inputs still use CPU transfers.

## Verification and updates

The buffered revision additionally passed headless tests for pulses queued while
a worker is overloaded, CHOP snapshots, resizing, last-good output after syntax
errors, draw errors, async timeout/reset recovery, and continued animation in the
other instance. See [timings and methodology](../../../VALIDATION.md#buffered-transfers-and-end-to-end-timing-2026-10-12).

This saved component was loaded from this directory with real TouchEngine on
TD Commercial 2025.31550 / macOS arm64: 60 frames on each output passed dimension,
RGBA, and CHOP-change checks. The checkout loader also passed in the editor;
a Trigger pulse grew one instance's yellow circle while the other stayed
unchanged. The integration's native bridge and editor tests additionally cover
errors, reset, resizing, and Syphon orientation.

To update the example, edit its embedded DAT, copy the source back to `sketch.js`,
restore Amount=40 and CPU output, set **Plugin Path** to the literal relative
value `Plugins/AvToolsSketch.plugin`, and save the component over `Sketch.tox`.
Avoid a machine-specific absolute path or an expression on this exposed parameter;
TouchEngine supplies exposed input values from their saved/default values.
To rebuild `Sketch.toe`, open TouchDesigner's empty Base project template and run
`save_project.py` with `runpy.run_path(...)`. It imports the saved `.tox`, embeds
`project_start.py`, sets up the preview, and saves `Sketch.toe`. The builder refuses
to replace a nonempty `/project1`. The `.toe` runs its embedded Python; it does not
depend on these external scripts when opened.

`scripts/package-td.mjs` packages these same `.tox` and `.toe` files for users.

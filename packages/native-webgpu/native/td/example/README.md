# avTools Sketch example

`Sketch.tox` is a self-contained TouchDesigner component kept beside the C++ TOP
source. Its JavaScript, CHOP, TOP input, and two renderer instances are embedded;
there are no machine-specific paths or external image/font dependencies in the
fixture. The native plugin bundle is built separately and is not checked in.

## Open from this checkout

Build the plugin using [the integration guide](../../../TOUCHDESIGNER.md), then
run this in TouchDesigner's Textport, substituting your checkout path:

```python
import runpy
runpy.run_path('/path/to/avTools/packages/native-webgpu/native/td/example/load_example.py')
```

The loader creates a new component under `/project1`, reads the current plugin
location from `build/td-plugin-path.txt`, and checks both TOPs. It does not replace
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
- Optional Syphon: enable **Enable Syphon** on one renderer, then create a Syphon
  In TOP and select its advertised `avTools Embedded:...` name. Names include the
  operator path to distinguish instances. **Syphon Only** returns a 1×1 placeholder
  on the renderer; view the Syphon receiver for the full image. Keep the publisher
  cooking. CPU TOP output is the default; wired inputs still use CPU transfers.

## Verification and updates

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
`scripts/package-td.mjs` packages this same `.tox` for users.

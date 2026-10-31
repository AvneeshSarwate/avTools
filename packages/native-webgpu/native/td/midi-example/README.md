# Native MIDI example

Open **MIDI.toe** directly from this directory in the avTools checkout. It loads
the checked-in plugins and builds the adjacent TypeScript files automatically.
No Node, Deno, Rust, or hardware-specific driver installation is needed for the
example itself. A connected MIDI device must be visible to macOS CoreMIDI.

The network contains two TOPs and two CHOPs. Select an operator, open its **MIDI**
parameter page, and choose **MIDI Controller**. All four can select the same
controller. They start at **None**, so opening this project does not claim a
controller or send messages to hardware.

- `picture.ts`: any CC moves the circle horizontally; note velocity sets its color.
- `channels.ts`: any CC sets a target which a persistent TimeContext loop smooths
  into the `value` channel. Notes update `note` and `velocity`. Adjust **Duration**
  on the Controls page. MIDI and smoothing continue when playback is paused.
- Set **TypeScript File** to another entry to customize an instance. Each instance
  has its own state and listeners even when it uses the same source file/device.
- **Reset** restarts one script; **Reload** adopts the latest compiled source.
  Restart gaps are acceptable; other operators remain connected.

`MIDI.tox` is the same component for importing into an existing project. Its
startup resolver expects the avTools checkout. After importing the `.tox`, run
its startup DAT’s `onStart()` once (or reopen your saved project). For standalone
projects, copy
`apps/td-projects/Plugins` beside your `.toe`, use **Create Template Project**, and
select the generated `sketches/midi/channels.ts` / `picture.ts` files. That project
README includes the complete API, explicit device connections and sending.

See [MIDI API](../../../MIDI.md) and [validation](../../../test/midi/README.md).
`project_start.py` resolves the checkout from `project.folder`; `build_projects.py`
packages the TD-saved component as the standalone `.toe` without machine-specific
plugin/source paths. The binary project is checked in and opens on its own.

# Sonar melodies — tldraw port

Three editable source piano rolls (`dscale5`, `dscale7`, `d7mel`), each with its
own parameter object, pipeline instance, and one-shot/gate/stop/preview buttons. Every
control lives on the tldraw canvas, and an Arturia BeatStep can drive the same
controls (see below). Each roll ("bank") can also be recorded into directly
from a MIDI keyboard, including per-note MPE expression, and playback can
send that expression back out as MPE. No LPD8 or TouchOSC input adapter is
included.

Open **sonar-melodies** using **engine on server**, **engine in browser**, or
**engine in same tab**, then Run **melody player**. Its imported helpers initialize automatically; they do
not need individual Run actions. After editing an imported helper, restart the
engine to reload its cached module instance; replacing the player alone may
retain the previous helper code. The source rolls are already saved in the
project. Run preserves edits and seeds a source only if its entity is absent.

The transport pane selects BPM and MIDI outputs: defaults are the original
`IAC Driver Bus 1` for the base voice and `IAC Driver Bus 2` for the echo, MIDI
channel 0 (channel 1 in a DAW). Route those ports to instruments for sound.
`dryRun` lets subsequent triggers run without a MIDI device. Changing output or
BPM settings affects subsequent triggers; currently playing phrases finish
with their captured routing/tempo. This project does not contain a synthesizer.

`midi-helpers` uses the multi-target library in `packages/midi`: native MIDI on
Deno and Web MIDI in browsers. The browser engine initializes MIDI when it
starts. Allow the MIDI permission prompt; if needed, click in the engine tab
(or the canvas for same-tab mode) to retry. The engine's MIDI status lists the
available output names. Set the output fields to ports on the machine running
the engine. The server mode needs the native MIDI bridge; browser mode does not.

After pulling this change, restart the livecode server and reload the UI and
any engine tab to receive the new browser import map and rebuilt engine assets.
No project-specific build or helper-module launch is required.

## Canvas controls

- **oneShot** starts the source's transformed phrase and its echo. Releasing the
  button leaves the phrase playing; repeated presses can overlap.
- **gate** starts the same pair and cancels both on release, including an echo
  that has not started yet. It does not loop. Each melody has its own gate.
- **stop** cancels every active phrase belonging to that melody.
- **preview** plays the source roll as written, with no transforms and no
  echo, on the base output at the transport BPM, and moves a playhead across
  that melody's piano-roll views. Pressing it again restarts the preview;
  **stop** ends it.
- Module Stop, Replace, and Panic retire the listener and release owned notes.
  Holding the same MIDI pitch in two phrases does not let one release the other.

Source edits are read at the next trigger. Transforms never overwrite the source
roll. The original clip length is kept as a minimum because piano-roll entities
store notes rather than loop length; extending notes extends the phrase too.
Save project persists roll edits, params, and layout. Restarting or replacing the
player preserves those durable values.

## Named presets

Each params pane has a **presets** switcher beside it (`ui/index.tsx`, the
project's own tldraw view). Type a name and press **set** to save the pane's
current values under it; pick a name in the dropdown to load it. The table
lists every leaf of the loaded preset next to the live value and marks the
ones that have changed since the load; the header counts them. With a preset
loaded and the name field blank, **set** overwrites that preset; **×** deletes
it. Presets live on the params entity, so **Save project** writes them to the
entity's data file and Duplicate copies them with the entity. The loaded name
is the switcher's own state and survives a reload; the values do not until
the project is saved.

## Recording into a bank

Pick a keyboard in the transport pane's **record input**, then switch on
**record into this bank** in a melody's pane, play, and switch it off. The take
replaces that melody's source roll; the next trigger plays it through the same
transforms. Several banks can record from the same input at once.

- The first note lands on beat 0, at the transport BPM.
- **record quantize** snaps note starts to 1/4, 1/8, or 1/16 of a beat (off by
  default) and rounds durations to the same grid.
- **phrase beats** is set to the take's length, rounded up to a whole beat.
  The roll stores notes only, so this is what keeps trailing silence in the
  phrase. Set it to 0 to go back to the original melody's length.
- **fit roll views after recording** (transport pane, on by default) frames
  the take in that bank's piano-roll views once it is written.
- Pitch bend, pressure and timbre (CC74) are recorded per note as the roll's
  pitch, Pressure and Timbre curves, as in
  [`feature-midi-recording`](../feature-midi-recording/README.md): per
  channel, so with an MPE controller each note gets its own, and a note's
  curves start at the values its channel had at note-on. Poly pressure is
  recorded for its key. **record bend range** (transport pane, 48 by default,
  the MPE standard; ordinary keyboards are usually 2) scales recorded bend
  into semitones. Curves are thinned to the points needed, and a curve that
  never leaves its rest value (no bend, zero pressure, timbre 64) is not
  written. Curves span the note, so quantizing a note stretches them with it.
- Pitch-curve points within 0.3 semitones of a whole MIDI pitch are marked
  as anchors (the roll's `rooted` points, drawn in the anchor colour and
  editable there). Thinning keeps where each run of anchors on one pitch
  starts and ends. Anchors are what scale-aware transposition moves (see
  below).
- **record status** reports the result. A take with no notes leaves the roll
  alone. Stopping or replacing the player discards an unfinished take, and a
  toggle left on is switched off when the player starts again.
- Recording writes to the live roll only; **Save project** makes it permanent,
  as with any roll edit. Undo in the piano roll does not cover a take.

## MPE output

**MPE output** (transport pane, off by default) plays every phrase, echo and
preview as MPE on a lower zone: each note gets its own member channel (MIDI
channels 2-16; **channel** is then unused), and its pitch, pressure and timbre
curves are sent as that channel's pitch bend, channel pressure and CC74,
updated every 10 ms while the note sounds. A note's starting values go out
just before its note-on, and a note without a curve gets the rest values (no
bend, pressure 0, timbre 64), so a channel never carries the previous note's
expression. **MPE output bend range** must match the synth's member-channel
bend range (48 by default); no RPN or MPE configuration message is sent, so
set the instrument to MPE mode yourself. The noteLength CC76 goes on the
master channel (channel 1). Free channels are reused least recently released
first, so a released note's tail keeps its bend for as long as possible; with
more than 15 notes sounding at once, notes share a channel. The base and echo
outputs allocate channels separately. Like the other transport settings, the
mode is read at each trigger.

With MPE output off, notes play on **channel** as before and the curves are
ignored.

The transforms keep a note's curves attached to it:

- **Transpose, spread and ornament pitches** are scale-aware for MPE
  (`scaleTransposeMPE`): the note moves through the scale, and so does each
  run of anchored pitch-curve points, so a slide from D onto F# moved up a
  degree in `dR7` runs from D# onto G#. Points between anchors move by an
  amount interpolated between them; a curve with no anchors keeps its bend
  relative to the note.
- An off-scale pitch moves with the scale degree below it and keeps its
  distance above it. (Before this, any recorded note outside `dR7` became
  NaN in the pipeline.)
- **Stretch and easing** scale a note's curves with its new length.
- **Reverse** reverses each note's curves too, as if the recorded events were
  played backwards.
- **Rotate** cuts a note crossing the rotation point in two, and each part
  keeps its own section of the curves.
- An **ornament** splits a note into three, and each part gets its third of
  the curves, so a gesture continues across the ornament.

## BeatStep

Plug in an Arturia BeatStep (the original, not the Pro) in its factory CNTRL
preset, except that encoder 1 sends CC 10 (as on the unit this was mapped on;
the factory sends CC 7). The player selects it automatically when it sees an input whose name
contains "BeatStep"; otherwise pick it in the **sonar/beatstep** pane. The pane
also shows which melody the encoders edit and reports the device status.

Pads, as seen from the front (top row notes 44-51, bottom row 36-43):

| | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **top** | dscale5 one-shot | dscale7 one-shot | d7mel one-shot | dscale5 stop | dscale7 stop | d7mel stop | focus dscale5 | focus dscale7 |
| **bottom** | dscale5 gate | dscale7 gate | d7mel gate | dscale5 record | dscale7 record | record focused melody | focus d7mel | canvas follow |

- Columns 1-3 are the original LPD8 layout: one column per melody, one-shot on
  top and gate on the bottom. Columns 4-6 add stop for each melody, and record
  toggles: bottom 4 and 5 for dscale5 and dscale7, and bottom 6 (note 41) for
  whichever melody has focus.
- The focus pads choose which melody the encoders edit and light like radio
  buttons. With three melodies and two pads left in the top row, the third
  focus pad is bottom 7.
- **canvas follow** (bottom right, lit while on) decides whether a focus press
  also moves the tldraw camera to that melody's params pane, at the current
  zoom. Pressing the focused pad again brings the camera back to it. This uses
  engine-to-UI events (`ui-events`), so it works in every engine topology.
  Changing focus from the pane's dropdown only updates the pads.
- Record pads are lit while their bank is recording; note 41 follows the
  focused melody.
- The pad layout is one table, `PAD_LAYOUT` in `modules/beatstep.orig.ts`.

Encoders edit the focused melody, mostly in the original sketch's slider order:

| Encoders | Parameters |
| --- | --- |
| 1-8 (top) | base transpose (CC 10), stretch, rotate, reverse, ornament, easing, spread (CC 73), noteLength (CC 75) |
| 9-14 (bottom) | echo transpose, stretch, rotate, reverse, ornament, easing |
| 15, 16 | delayTime, delayEnabled (turn right for on, left for off) |

The knobs are set to Relative #1 (65 for a step clockwise, 63 for a step
counter-clockwise), and that is the default **encoder mode**: each step moves
the focused parameter by 1/127, knobs are endless, and switching focus never
makes a value jump. To set all 16 knobs without Control Center, send
`F0 00 20 6B 7F 42 02 00 06 2k 01 F7` for k = 0 to F (knobs 1-16). A factory
BeatStep sends absolute values instead; for that, choose `delta`, which applies
the change since the last message (limited by the knob's own 0-127 range), or
`absolute`, which jumps to the knob's position.

Pad LEDs are driven by sending each pad a note-on for its own note, and a
real note-off to clear it (the BeatStep ignores a velocity-0 note-on). This
works in the factory Note/Gate mode without SysEx, on both the Deno and
browser engines. The BeatStep has no local-control setting, so a pad also
lights itself while held; the player relights a lit pad after its release. If the
BeatStep's output port is missing, the status says so and everything else
still works. Stopping the player turns the LEDs off.

## Transform pipeline

`modules/pipeline.orig.ts` calls the copied functions directly. Each melody has
one pipeline instance with a base chain and an echo chain. The echo takes the
**transformed base**, as in the original. Base params and delay time are sampled
on trigger; echo transform params are sampled when the echo begins.

| Field | Original mapping, for a knob value `n` in 0–1 |
| --- | --- |
| transpose | `floor(n * 16 - 8)` degrees in `dR7` |
| stretch | `n * 3`, with the original function's minimum factor of 0.01 |
| rotate | Original rotation, neutral at 0.5 |
| reverse | Enabled above 0.5 |
| ornament | Probability `n`; original random ornament choices and durations |
| easing | Original circular easing, neutral at 0.5 |
| base.spread | `floor(n * 4)` scale degrees; base chain only |
| delayTime | `n² * 8` beats |

Order: transpose → stretch → rotate → reverse → ornament → circular easing →
spread (base only). The echo has the same first six steps. `delayEnabled` is a
convenience toggle. The original unused sliders 14/15 are omitted. `noteLength`
retains slider 6 as an external rack control: it sends CC76 to the base output at
trigger time, and only has an audible effect if the instrument maps that CC.
It defaults to 0.5 (CC value 64), rather than the minimum. MIDI note-off timing
remains 98% of the transformed piano-roll duration. It is not an extra note
transform.

Defaults are deliberately neutral and audible: transpose/rotation/easing 0.5,
stretch 1/3, reverse/ornament/spread 0, and delay off. When enabled, the
echo defaults to two beats. The original app
initialized every slider to zero, which heavily compresses/transposes a phrase.
The ranges and mappings are unchanged. Existing live or saved params keep
their values on Run/Replace; set `noteLength` to 0.5 and `delayEnabled` to false in an already-open pane
to apply the new defaults there.

All transform implementations, including the transforms outside this default
chain, are copied into `transforms.orig.ts` and `easing.orig.ts`. Their only
shared music dependency is the existing `AbletonClip`/`Scale` data library.
There is no runtime dependency on browser-projections, its Vue state, the DSL
parser, `eval`, or `new Function`. Ornament RNG is injectable for testing.
The transforms additionally carry MPE curves (see [MPE output](#mpe-output));
the source melodies have no curves and are all in `dR7`, so this does not
change their results.

## Source provenance and verification

Melodies were extracted from the original sketch's loaded Ableton set:
`apps/browser-projections/src/sketches/sonar_sketch/piano_melodies Project/freeze_loop_setup_sonar.als`.
The sketch's static `clipData.ts` does not contain these melodies. Source note
counts are 6, 8, and 22. The active pipelines come from `LivecodeHolder.vue`;
`runLineWithDelay` supplies the base-to-echo relationship and delay formula.

From `apps/deno-notebooks`:

```sh
deno test --allow-all livecode/tests/sonar_project_test.ts
```

The test prepares every canonical module into a temporary directory through the
real analyzer. It compares nine deterministic base/echo results to snapshots
captured from the original transform registry (seed 123; note values rounded to
8 decimals before hashing), checks independent params, and exercises canvas
events with simulated MIDI outputs through the real engine. It also tests
shared-pitch cancellation and Stop/Replace/Panic cleanup.

Manually: edit each source, vary only one pane's transforms, trigger overlapping
one-shots, release a held gate before its echo starts, then Stop/Replace. Save
and reopen to check the edited rolls and independent settings persist. Record a
take into one bank with quantize on and off, and check the other banks are
untouched. Record a take on an MPE controller (sliding, pressing, moving a
finger vertically) and check the roll shows its curves; then turn on MPE
output, route it to an MPE synth, and check preview and triggers (with
stretch, easing and ornament) reproduce the gestures. With a BeatStep, press
each pad column, switch focus with canvas
follow on and off, and turn encoders after switching focus to check nothing
jumps.

The test also drives the BeatStep mapping with synthetic pad and encoder
events (layout, radio LEDs, relit pads, the follow toggle, every encoder mode)
and the recorder with synthetic takes, including MPE expression and anchor
marking. It checks that every curve-carrying transform moves the curves as
described above, that off-scale pitches transpose, and that MPE playback
gives each note its own channel with its expression sent before the note-on. Recording was also checked live through
an IAC bus on macOS.

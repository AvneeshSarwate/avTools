# Sonar melodies — tldraw port

Three editable source piano rolls (`dscale5`, `dscale7`, `d7mel`), each with its
own parameter object, pipeline instance, and one-shot/gate/stop buttons. Every
control lives on the tldraw canvas, and an Arturia BeatStep can drive the same
controls (see below). Each roll ("bank") can also be recorded into directly
from a MIDI keyboard. No LPD8 or TouchOSC input adapter is included.

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
- Module Stop, Replace, and Panic retire the listener and release owned notes.
  Holding the same MIDI pitch in two phrases does not let one release the other.

Source edits are read at the next trigger. Transforms never overwrite the source
roll. The original clip length is kept as a minimum because piano-roll entities
store notes rather than loop length; extending notes extends the phrase too.
Save project persists roll edits, params, and layout. Restarting or replacing the
player preserves those durable values.

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
- **record status** reports the result. A take with no notes leaves the roll
  alone. Stopping or replacing the player discards an unfinished take, and a
  toggle left on is switched off when the player starts again.
- Recording writes to the live roll only; **Save project** makes it permanent,
  as with any roll edit. Undo in the piano roll does not cover a take.

## BeatStep

Plug in an Arturia BeatStep (the original, not the Pro) in its factory CNTRL
preset. The player selects it automatically when it sees an input whose name
contains "BeatStep"; otherwise pick it in the **sonar/beatstep** pane. The pane
also shows which melody the encoders edit and reports the device status.

Pads, as seen from the front (top row notes 44-51, bottom row 36-43):

| | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **top** | dscale5 one-shot | dscale7 one-shot | d7mel one-shot | dscale5 stop | dscale7 stop | d7mel stop | focus dscale5 | focus dscale7 |
| **bottom** | dscale5 gate | dscale7 gate | d7mel gate | dscale5 record | dscale7 record | d7mel record | focus d7mel | canvas follow |

- Columns 1-3 are the original LPD8 layout: one column per melody, one-shot on
  top and gate on the bottom. Columns 4-6 add stop and a record toggle for the
  same melodies.
- The focus pads choose which melody the encoders edit and light like radio
  buttons. With three melodies and two pads left in the top row, the third
  focus pad is bottom 7.
- **canvas follow** (bottom right, lit while on) decides whether a focus press
  also moves the tldraw camera to that melody's params pane, at the current
  zoom. Pressing the focused pad again brings the camera back to it. This uses
  engine-to-UI events (`ui-events`), so it works in every engine topology.
  Changing focus from the pane's dropdown only updates the pads.
- Record pads are lit while that bank is recording.
- The pad layout is one table, `PAD_LAYOUT` in `modules/beatstep.orig.ts`.

Encoders edit the focused melody, in the original sketch's slider order:

| Encoders | Parameters |
| --- | --- |
| 1-8 (top) | base transpose, stretch, rotate, reverse, ornament, easing, noteLength, spread |
| 9-14 (bottom) | echo transpose, stretch, rotate, reverse, ornament, easing |
| 15, 16 | delayTime, delayEnabled (turn right for on, left for off) |

The factory encoders send absolute values, which would make a parameter jump
to the encoder's position whenever focus changes. The default **encoder mode**,
`delta`, instead applies the change since the last message, so nothing jumps.
Its limit is the encoder's own 0-127 range: at an end it stops sending until
turned back. For endless turning, set the encoders to Relative #1 in Arturia's
MIDI Control Center and choose the matching mode. `absolute` is available for
anyone who prefers the jump.

Pad LEDs are driven by sending each pad its own note, which works in the
factory Note mode without SysEx, on both the Deno and browser engines. If the
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
untouched. With a BeatStep, press each pad column, switch focus with canvas
follow on and off, and turn encoders after switching focus to check nothing
jumps.

The test also drives the BeatStep mapping with synthetic pad and encoder
events (layout, radio LEDs, relit pads, the follow toggle, every encoder mode)
and the recorder with synthetic takes. Recording was also checked live through
an IAC bus on macOS.

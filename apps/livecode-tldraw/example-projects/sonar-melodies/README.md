# Sonar melodies — tldraw port

Three editable source piano rolls (`dscale5`, `dscale7`, `d7mel`), each with its
own parameter object, pipeline instance, and one-shot/gate/stop buttons. All
controls live on the tldraw canvas. No LPD8 or TouchOSC input adapter is included.

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
and reopen to check the edited rolls and independent settings persist.

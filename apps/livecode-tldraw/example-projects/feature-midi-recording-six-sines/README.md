# feature-midi-recording-six-sines

Record an MPE controller into a piano roll, then hear the take played by the
packaged Six Sines synth with each note's recorded pitch, pressure and timbre.

This is the browser-engine companion of
[`feature-midi-recording`](../feature-midi-recording/README.md). That project
stays engine-agnostic so recording can be tested on native and Web MIDI; this
one adds Six Sines, which only runs in the browser engine's `AudioWorklet`
(`engineTarget: "browser"`). The recorder module is the same code under this
project's entity names (`six-sines-recording/...`), so both projects can be
open in one engine without sharing a take.

## Opening it

From the projects index, choose **engine in browser**. Browser autoplay rules
can leave a fresh engine tab's `AudioContext` suspended; if the player reports
that, click once inside the ENGINE tab and run it again. Web MIDI permission
is requested the same way (see the engine tab's MIDI status line).

## Flow

1. Run **MIDI recorder**, pick your controller in **MIDI input**, toggle
   **recording** on, play, toggle it off. The take lands in the roll with
   per-note pitch (on the note, MPE mode) and the **Pressure** / **Timbre**
   lanes (toggle them in the roll's control bar). See the recorder project's
   README for the trim toggles, bend range and thinning rules.
2. Run **take player (Six Sines)**. It plays the take, re-reading the roll each
   pass, so edits to notes or to any curve are heard on the next loop. Turn off
   **loop take** in the `six-sines-recording/playback` pane to play it once.
3. The synth starts on the factory MPE preset **Exp Bowed Glass**, which routes
   MPE Pressure and Timbre. Pick any other preset (the `MPE` category is made
   for this) or edit the sound in the Six Sines view; Save project keeps it.
4. Stop or Replace the player: held notes are released, then the synth
   disposes its worklet and closes its `AudioContext`.

## How the curves reach the synth

Each note gets its own CLAP note ID. At note-on, and then on one ~100 Hz tick
that batches every held note into a single message, the player sends CLAP note
expressions for that ID:

| Roll curve | Note expression | Value |
| --- | --- | --- |
| `mpePitch` | tuning | semitones |
| `mpePressure` | pressure | `value / 127` |
| `mpeTimbre` | brightness | `value / 127` |

Six Sines feeds pressure and brightness to its **MPE Pressure** and **MPE
Timbre** / **Timbre (Bipolar)** mod sources. That needs the packaged build from
the six-sines `claude/note-expression-pressure-brightness` branch (see
[`packages/six-sines/README.md`](../../../../packages/six-sines/README.md));
the synth's own MIDI MPE mode cannot be enabled in the headless build.

A pass ends at the last note's end: the roll has no length field, so the
recorder's reported take length (end silence) is not used for looping.

## Checks

- `node packages/six-sines/tests/note-expression.mjs` (repository root) checks
  against rendered PCM that per-note pressure and brightness change the sound
  under this preset.
- `verify-feature-projects.ts` opens this project, checks it type-checks under
  the browser lib, that the MPE preset restores from `data/`, and runs the
  recorder.
- `node livecode/tests/midi_recording_six_sines.e2e.mjs` (from
  `apps/deno-notebooks`, after building the livecode-tldraw UI) bakes a copy
  seeded with a take, runs the real Wasm in headless Chromium, and checks the
  player's note-ons/offs, the per-note tuning/pressure/brightness streams, and
  audio output. Set `PW_CHROMIUM_PATH` if Playwright's own browser is missing.
- Listening with an MPE controller is still a manual check.

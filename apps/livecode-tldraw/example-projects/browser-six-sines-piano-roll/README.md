# browser-six-sines-piano-roll

An editable livecode piano roll played directly by the packaged Six Sines
WebAssembly synth in the browser engine's `AudioWorklet`. It does not send MIDI.
The `Six Sines piano-roll helpers` shape is an ordinary project module, so its
startup, note-identity, per-note parameter modulation, piano-roll playback, and
cleanup helpers are visible and editable on the canvas.

The synth package is a browser port of the original
[baconpaul/six-sines](https://github.com/baconpaul/six-sines), built from the
[`browser-audio-worklet` branch of AvneeshSarwate/six-sines](https://github.com/AvneeshSarwate/six-sines/tree/browser-audio-worklet).

## Opening it

This project is browser-engine only (`engineTarget: "browser"`). From the
projects index, choose **engine in browser**. Alternatively, run the livecode
server with `--engine remote`, open `/engine/`, and then open the UI with this
directory as its `projectPath`.

Browser autoplay rules can leave a fresh engine tab's `AudioContext` suspended.
If the player reports that condition, click once inside the ENGINE tab and run
it again.

## Flow

1. Run `seed the synth loop`. The roll view fills with a four-note phrase.
2. Run `Six Sines loop player`. You hear the synth's default patch; no MIDI
   device or native plugin host is involved.
3. Draw, move, resize, or change the velocity of notes. Each pass re-reads the
   roll, so edits take effect at the next loop boundary.
4. Stop or Replace the player. Active note branches send note-offs, then the
   player sends all-notes-off, disposes the worklet, and closes its
   `AudioContext`.
5. The helper shape's default root only describes the module. It is not a
   separate service that must be run: the player imports the stable module
   instance and owns its lifecycle.

## Presets and generative use

`startSixSines({ presetUrl })` accepts the native `.sxsnp` format written by the
paired Six Sines CLAP build. Serve the preset from a URL reachable by the engine
tab, then call `startSixSines({ presetUrl: "/sounds/mine.sxsnp" })` before the
first `playPianoRollWithSixSines` call. A `presetBytes` option is also available
when another project module fetches or generates the bytes.

For generative scripts, import from `./six-sines.ts` and use:

- `noteOnSixSines(key, velocity)` → a non-negative CLAP-style `noteId`
- `noteOffSixSines(noteId)`
- `modulateSixSinesNote(noteId, paramId, amount)` for per-note
  `CLAP_EVENT_PARAM_MOD`
- `setSixSinesParameter(paramId, value)` for global parameter values

These calls are intentionally untimed: each is delivered on the next audio
render quantum. The livecode `TimeContext`/your own scheduler decides when to
call them; the synth wrapper does not require audio-frame scheduling.

Only `modules/*.orig.ts` files are canonical source. The server owns and
gitignores the generated `modules/*.ts` runtime files.

# Cursor chords with per-note Six Sines modulation

Open this directory from the projects page using **engine in browser** (a separate engine tab) or **engine in same tab**. Run **Cursor chord player + per-note macro LFOs**; the instrument helper does not need a separate run. Activate the engine tab if the browser requires an audio gesture.

1. Click an empty area of the piano-roll grid to position the green start cursor. **Play at cursor** releases the previous chord and latches every note intersecting that position. Intervals include their start and exclude their end. **Off** releases the latched notes.
2. Edit the Six Sines UI or import a native `.sxsnp` preset. The example's initial sound maps **Macro 1/2/3 Modulated** to the pans of operator outputs 1/4/6. Per-note offsets reach both *Amplitude* (raw knob plus offset) and *Modulated* (also includes the macro envelope/LFO) sources. A preset without these mappings simply ignores this modulation.
3. Each macro has **Off**, **On (sine)**, and **Random ramp** modes, plus rate, depth, and rate spread. On note start each macro independently samples `rate + (2 * ctx.random() - 1) * spread`. Rate and spread edits affect the next notes; mode and depth edits affect held notes immediately. Off clears the offset. Values are bipolar, bounded by ±depth, and add to the preset's macro value.
4. The animation editor contains four number lanes with random points over 3–4 units. In Random ramp mode each note/macro picks a lane independently, interpolates its points linearly, and loops from time zero to its last point. Rate is units per second (1 means 3–4 seconds per seeded loop); in sine mode it is cycles per second. A negative sampled rate traverses backward; zero holds the initial value.
5. A running ramp holds a private copy of its chosen lane. At each wrap it rereads that same lane, including its new duration. Thus edits take effect at the next loop, not mid-segment. Switching away from Random ramp discards the selection; switching back chooses again. Removing a selected lane picks another at the next boundary; no number lanes produces zero and retries at the next boundary. Points outside [-1, 1] are clamped at the modulation output. The initial endpoints are both zero for continuous loops; edits may intentionally introduce jumps.

Every note-on gets a fresh ID. Note-off targets the old ID, so repeated pitches retain their release tails while the new voices start. This piece enforces polyphonic mode, a 64-voice limit, and repeated-key reuse disabled, including after preset import. The finite voice limit can still cause stealing when exhausted. Off stops modulation of released voices, leaving their last offset in place during the release. Stop/Panic disposes the instance and its AudioContext.

The start cursor is durable `getPianoRoll(name).data.playStartPosition` (zero for older rolls), independently committed without adding an undo entry. Note edits and note undo/redo preserve it. Project Save persists the cursor, synth settings, controls, and animation tracks. Held notes, selected ramp copies, and oscillator phases are runtime module state, not entities. The 60 Hz loop batches per-note events directly to the AudioWorklet; it does not rewrite synth parameter state or publish envelopes to the UI.

After changing framework assets, restart the livecode server and Vite before opening the project. To check manually: enable a mode, Play twice over the same chord, move the cursor to beat four and Play, then Off. Edit all ramp lanes while a Random ramp chord is held and listen for the changes at subsequent boundaries. Save/reopen to check the cursor and edited lanes.

## Automated checks

From `apps/livecode-tldraw`, run `npm run type-check && npm run build`.
From `apps/deno-notebooks`, run:

```sh
deno test --allow-all livecode/tests/piano_roll_cursor_test.ts livecode/tests/params_dropdown_test.ts livecode/tests/repro/piano_roll_store_repro_test.ts livecode/tests/six_sines_cursor_chords_project_test.ts
node livecode/tests/cursor_chords.e2e.mjs
```

The browser check bakes a temporary copy, runs the real Wasm engine and controls
in separate tabs and in one tab, and checks cursor propagation, chord IDs,
per-note modulation, fresh ramp adoption, and cleanup. It edits test ramp copies
only. From the repository root, `node packages/six-sines/tests/note-release.mjs`
checks actual stereo PCM for simultaneous old-release and new-attack voices of
the same pitch.

# Piano lab

A project for interactive module authoring through chat. Browser engine; no MIDI device required.

Open this directory from the projects index using **engine in same tab**, then run **Play piano roll**. The saved four-beat C-major phrase is available immediately. Click in the engine/UI tab if audio needs a user gesture, then Stop and Run again.

The player loops at 120 BPM and reads `piano-lab/loop` again each pass, so piano-roll edits take effect at the next loop boundary. The loop ends at the last note end. Change `secondsPerBeat` in the player to change tempo; use Replace to apply source changes during playback. Stop releases notes and closes the synth.

`modules/player.orig.ts` owns playback. `modules/six-sines.orig.ts` contains the reusable synth and note helpers; it does not need to run separately. Future modules can read/write `piano-lab/loop` through the piano-roll store/helpers, or import synth helpers from `./six-sines.ts`. The player currently owns the shared synth lifetime: stopping it also stops notes sent by other modules. Revisit ownership before adding independent synth players.

Edit canonical `*.orig.ts` files only. Generated `*.ts` files belong to the server. Use the mounted client commands to add modules or reload external edits. Use **Save project** to persist piano-roll edits. Opening the project does not start playback.

Verification: run browser-target project diagnostics, run the player, edit notes across a loop boundary, Replace it, then Stop and check that the run has stopped without errors.

## Random harmony

Run **Generate random harmony** to read the current `piano-lab/loop` notes and write melody plus harmony into `piano-lab/harmony`. Each note independently gets a random diatonic third or fourth above it in C major, preserving timing and velocity. Re-run to regenerate after melody edits. The source is unchanged. To hear the combined roll, change the player's roll name to `piano-lab/harmony`. The second roll view is saved in the canvas layout; if it is not yet visible, use the piano-roll icon beside the module's output call to show it. Save project to persist generated notes.

During music lessons, perform only near-instant checks; skip diagnostics and playback verification unless requested.

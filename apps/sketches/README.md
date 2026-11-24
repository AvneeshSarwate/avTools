# sketches

Small audiovisual sketches, one Vite app. Pick a sketch with `?sketch=<name>`
(see `src/main.tsx`); the project file with `?project=<name>`.

```sh
cd apps/sketches
npm install
npm run dev          # http://localhost:5192
npm run type-check
```

Projects autosave to `projects/<name>/project.json` through the dev server
(`server/projectFiles.ts`, the same middleware as music-runners).

`src/shared/` holds what sketches share: a copy of the music-runners piano roll
and control kit (copied, not imported, so it can be edited freely here; the
roll gained `onHistoryKey` so Cmd-Z goes to the host's history), the Six Sines
engine wrapper and editor panel, MIDI input, the root core-timing clock, a
snapshot undo history, and `logisticSigmoid` (from browser-projections).

## split-sweep

A square cut into rectangles. Each rectangle drones one Six Sines voice.

**Edit mode** (Tab toggles): click a region to select it. **Split…**, then
click inside it to drop an anchor, then **Vertical** / **Horizontal** (V / H;
Esc cancels). Both halves keep the parent's settings. Per region: colours A
and B, a piano roll whose first two notes (in time) are A and B, slide
duration (seconds) and sharpness (`logisticSigmoid`, 0 linear .. 1 step).
**Solo**: only the selected region drones; click it to trigger, right-click
to stop. Cmd-Z / Shift-Cmd-Z undo everything (layout, region settings, synth).

**Play mode**: everything starts off. Click an off region: it ramps in on A,
then with 50% probability sweeps on to B. Click a sounding region: it sweeps
to the other side; clicking mid-sweep reverses it. Right-click: fade out and
release. The sweep line moves right-to-left for A to B (A left of the line, B
right of it), and pitch and colour follow the same curve.

**Sound**: per voice, the tuning note expression glides between the notes;
Macro 1/2/3 Level get the interpolated colour's R/G/B (0..1) and Macro 4
Level gets the fade level, all as per-note offsets. Six Sines has no per-note
volume: the ramp-in is heard through the patch's attack plus whatever you map
Macro 4 to, and a right-click sends the note-off at once (the patch's release
is the tail) while the colour fades over the slide duration. The dock at the bottom is the full Six Sines editor for the
patch. Live MIDI input plays a second engine with the same patch, so it never
steals drone voices.

Timing: every animation is a core-timing branch of one root context
(`src/shared/clock.ts`); a track's phase is computed from scheduler time and
its arrival is a `waitSec` branch, and one `waitFrame` loop draws the Konva
layer and sends per-voice updates.

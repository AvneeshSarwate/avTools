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
(`server/projectFiles.ts`, the same middleware as music-runners). The top bar
has a project chooser, a "new project" field, save now, **Export** and
**Import** (JSON files).

### As a static site

A static build has no dev server, so there is no autosave and no project
chooser. The app notices at startup (the request for the project list fails)
and switches to manual persistence, as music-runners does: it opens empty,
**Save** downloads the project as a JSON file, **Load** opens one, and the
status reads `unsaved` after any change, with the browser's leave-page warning
while it does. `src/shared/project.ts` holds both backends; a sketch plugs in
with `createProject({ kind, read, apply, isValid })`.

`tools/deploy-pages.sh` at the repo root builds and publishes it with the
other apps (`sketches` is in its `APPS` list).

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

The notes roll shows every region at once: the selected region's notes in
orange (A and B bright, any others dim) and editable, the others as faded
ghosts. Each region's A→B is joined by a line drawn with that region's
sigmoid, so you can see the glide's arc (orange for the selection, dashed grey
for the rest). **Full height** hides the other properties and gives the roll
the whole panel. The panel's left edge and the bar above the synth dock drag
to resize (double-click the bar to fit the panel again); sizes save with the
project but are not part of undo.

**Play mode**: everything starts off. Click an off region: it fades in on A (0.2 s, `FADE_SEC` in engine.ts),
then with 50% probability sweeps on to B. Click a sounding region: it sweeps
to the other side; clicking mid-sweep reverses it. Right-click: fade out and
release. The sweep line moves right-to-left for A to B (A left of the line, B
right of it), and pitch and colour follow the same curve.

**Sound**: per voice, the tuning note expression glides between the notes;
Macro 1/2/3 Level get the interpolated colour's R/G/B (0..1) and Macro 4
Level gets the fade level, all as per-note offsets. Six Sines has no per-note
volume: the ramp-in is heard through the patch's attack plus whatever you map
Macro 4 to, and a right-click sends the note-off at once (the patch's release
is the tail) while the colour fades out over 0.2 s. The dock at the bottom is the full Six Sines editor for the
patch. Live MIDI input plays a second engine with the same patch, so it never
steals drone voices.

Timing: every animation is a core-timing branch of one root context
(`src/shared/clock.ts`); a track's phase is computed from scheduler time and
its arrival is a `waitSec` branch, and one `waitFrame` loop draws the Konva
layer and sends per-voice updates.

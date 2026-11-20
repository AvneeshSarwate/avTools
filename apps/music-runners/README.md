# music-runners

A standalone prototyping app for piano-roll "runners": procedural playback
templates on a tldraw canvas, firing MIDI straight from the browser. It
borrows the piano-rolls-on-a-canvas workflow from `docs/livecode` and drops
that project's engine/UI split, entity registry and protocol so interactions
can be iterated on freely. Decisions and the roadmap live in
`implementation_plans/music_runners_plan.md` at the repository root.

## Relationship to `docs/livecode`

`docs/livecode` (the livecode system: `apps/livecode-tldraw`,
`apps/deno-notebooks/livecode`, `packages/livecode-engine`,
`packages/livecode-protocol`) is the formal system: an engine/UI split,
registered entity kinds, a sync protocol, and project files with `*.orig.ts`
modules. This app is its prototyping ground. Interactions, state shapes and
persistence are tried here first, with plain valtio stores and one JSON file,
because changing them here is cheap. Once a design and its interaction feel
settled, its state management and persistence are ported back into the formal
approach in `docs/livecode` in a separate effort. Nothing here is imported by
livecode.

So when adding a feature:

- Look in `docs/livecode` first for an existing version (for example, MIDI
  recording is `apps/livecode-tldraw/example-projects/feature-midi-recording`)
  and keep its **data shapes** where they fit, so the port back is mechanical.
  Recorded MPE curves here use livecode's `mpePitch` / `mpePressure` /
  `mpeTimbre` note fields for that reason.
- Do not copy livecode's **architecture** (entities, protocol, engine
  modules). Keep the simple store-and-shape layout described below.
- Write down what was learned (`implementation_plans/music_runners_plan.md`)
  so the port has more to go on than the code.

## Run

```sh
cd apps/music-runners
npm install
npm run dev          # http://localhost:5190
npm run type-check
```

Projects are saved to `projects/<name>/project.json` by the dev server
(`server/projectFiles.ts`): the tldraw snapshot, every instance's clip and
the bpm, in one file. Autosave runs about a second after any change; the
top bar also has a save button, a project chooser and a "new project" field (`?project=<name>` in the
URL). Nothing is kept in browser storage.

Web MIDI needs a user gesture in some browsers; the first click on the page
opens it, and the top bar shows the status. Everything plays on channel 0
unless an instance has **MPE Out** on (see below).

## Concepts

- **Runner**: a template under `src/runners/<name>/`: a tag schema for note
  metadata, params, a pure `generate(clip, random, params)` that makes one loop, and a
  `run(api)` that loops until stopped. `src/runners/runnerTypes.ts` is the
  thin contract; copy a runner directory to make a new one and register it in
  `src/runners/registry.ts`.
  Params are numbers (a draggable bar); with `kind: "scale"`, a scale
  (`{ root, degrees }`, edited with a root chooser and degree list); or with
  `kind: "text"`, a text field committed on Enter or blur, with an optional
  `validate` that refuses bad text (its message shows under the field and
  the last good value stays). Read them with `numberParam` / `scaleParam` /
  `textParam` from `runnerTypes.ts`. `generate` and `sourceGhostNotes`
  receive the instance's params; `generate` also gets `{ cursor }`.
  Optional runner flags: `usesCursor` (the source roll's cursor is input:
  always drawn, bold with a head, saved in the shape's `meta.cursor`, read
  with `api.getCursor()`) and `sourcePlayhead: false` (no playhead on the
  source roll, for loops that are not the clip). A runner can draw labelled
  lines on its source roll while running with `api.setMarkers`, each with an
  optional tinted `span`; a loop can sit anywhere on the timeline with
  `LoopNotes.start`; `api.publishLoop(null)` says nothing is sounding (the
  sidebar row shows "waiting"). Optional `sidebarPhase(phase)` sets the
  sidebar row's progress bar while the runner Runs: given the current pass
  (`{ elapsed, loopLength, start, loopCount }`, beats in its own tempo with
  speed applied) it returns 0..1 through whatever its cycle is, or null for
  no bar. Without it (and always for Play) the bar is elapsed / loopLength of
  the current pass. The arp returns the fraction of its cycle, so the bar
  looks the same wherever the cursor started it.
- **Clip**: an instance's piano roll data: notes (with the runner's tag
  metadata), loop length and scale. Every instance owns exactly one; nothing
  is shared between instances. Clips live in `src/store/clips.ts`, keyed by
  the instance's shape id, rather than in the shape's props, so note edits
  stay on the roll's own undo stack and out of tldraw's history. To reuse
  notes, duplicate the instance or copy notes from one roll and paste them
  into another (Cmd-C / Cmd-V in the rolls).
- **Scale**: each clip has one, edited in the Source roll's tool row: a root
  chooser (accidentals spelled both ways, F#/Gb) and a degree field, semitones
  above the root from 0 with the octave last (ionian is `0 2 4 5 7 9 11 12`;
  the 12 is added if left out). It is stored as `clip.scale = { root, degrees }`
  with `root` a MIDI note (60 = C4), the shape `new Scale(degrees, root)` takes
  in `packages/music-types`, so a runner can build one directly. Missing means
  C major. All three rolls shade from it: root rows lighter, out-of-scale rows
  darker (in C major the darker rows are the black keys). Scale edits are not
  on the roll's undo stack (like loop length).
- **Instance**: a tldraw shape (`runner-<type>`) with a name, its clip, a
  MIDI output, the runner's params (each runner declares its own; the ones here
  have transpose, applied now, and speed, at the next loop), two transports
  (**Run** the algorithm, **Play** the clip verbatim; pressing the lit one
  again stops), its own **tempo**, a queue toggle, and
  three collapsible rolls: **source** (editable, edits the clip), **generated**
  (the loop now sounding plus a live overlay of what actually played) and
  **preview** (output of **Regenerate**, a dry run). Layout below.
  Duplicating an instance (right-click Duplicate, Cmd-D, Alt-drag) gives
  the copy its own copy of the clip and the next free name (`melody` →
  `melody 2`), so the two diverge. Copying an instance (Cmd-C) takes a
  snapshot of its clip, so pasting, also into another project, brings the
  notes as they were when copied; a cut-and-paste keeps the name. Undo,
  redo and undoing a delete keep the clip (`src/shapes/clipOnCopy.ts`; the
  shape's `meta.clipOwner` is how a fresh duplicate finds its original).
- **Sidebar**: lists every runner type with a **+** that adds an instance
  of it (placed right of the rightmost instance and brought into view), and
  under each type its instances on the current page. A row shows the
  instance's state with the transport colours: the loop count while playing
  or running ("waiting", "take", or "error" when a start failed; nothing when
  idle) and a loop-progress bar along its bottom edge; a **Q** toggle
  (the instance's queue flag, same as its title bar's Q); Play, Run and Stop
  buttons (Play/Run stop when pressed again). Click a row to select the
  instance and bring it into view; double-click its name to rename it (the
  title bar's name field edits the same name). Drag the sidebar's right edge
  to resize it (220-640px, remembered in the browser; double-click the edge
  for the default width); the chevron hides it.
- **Events**: plain objects (`{ type, ...fields }`) sent with `api.emit` and
  received with `api.onEvent`. A runner lists the types it sends in its
  definition's `emits`. Routing is by **connection arrows** (see below).
  Pick the arrow tool, press on the sending instance's title bar (the top row
  with the grip, name and loop), drag onto the receiving instance
  anywhere, and release. The title bar's background is also the grip for
  moving an instance with the select tool; everything below it belongs to
  the instance, so clicks there never reach the canvas.
- **Clock**: one shared root `TimeContext` (`src/store/clock.ts`); each
  running instance is a branch of it with its own cloned tempo map
  (`branch(fn, name, { tempo: "cloned" })`), set to the instance's **tempo**
  (the box in the source section's header, in BPM) and following it live
  through `ctx.setBpm`. Runner code waits in beats of its own tempo; a `speed`
  param multiplies on top (default 1). The top bar's bpm is the project tempo
  new instances start at. The playhead and overdubs use the instance's beats;
  free takes are measured at its tempo setting. The top bar's **queued**
  group (**Play**, **Run**) plays or runs every
  queued instance at once.

## Connections

An arrow from one instance to another is a connection for exactly one event
type, the tuple (from, type, to). The type is stored in the arrow's
`meta.eventType` and the arrow's label is a chooser over the sender's `emits`
(`src/ui/ConnectionLayer.tsx`, drawn in tldraw's `OnTheCanvas` slot). An event
goes along every connection from its sender whose type matches.

- A new connection gets the sender's first declared type. A sender that emits
  nothing shows "no events" and routes nothing.
- Several arrows with the same tuple are duplicates: the oldest (by
  `meta.connectedAt`, stamped when the arrow first became a connection) routes,
  the others show a dashed "dup" label and do nothing. Delivery is once per
  target either way.
- A second (third, fourth) arrow between the same two instances, in either
  direction, is bent automatically so parallel arrows fan out.
- The arrow's own text label stays empty on connections, so free text cannot
  disagree with the type.
- When an event is sent, each arrow that carried it flashes (a bright stroke
  and label that fade in about 0.4 s). Pulses come from the event bus
  (`src/store/pulses.ts`) and never touch the tldraw store.
- An event type a runner emits without declaring it still routes; the console
  warns once so it gets added to `emits`.

Arrows with a loose end, ending on something other than an instance, or
pointing back at their own instance are not connections. The rules live in
`src/store/connections.ts` (`installConnectionRules`, `listConnections`,
`routesFrom`).

## Instance layout and UI conventions

The chrome follows Ableton Live's dark themes: grey surfaces in a few tonal
steps, flat controls (26px tall, about 14px type), and colour only where it means
something. An instance is laid out top to bottom in fixed regions:

The app top bar holds the project, save state, note labels, bpm, the
transport for queued instances and MIDI status. New instances are made from
the sidebar.
Controls inside instances (and the connection labels) are a further 30%
larger than the top bar's (34px, 20px text), since the canvas is usually seen
zoomed out; the control strip and the Source tool row wrap onto a second line
when an instance is too narrow for them. Piano roll scrollbars are 24px thick. Instances default to 1040px wide so
the control strip and the Source roll's tool row fit.

| Region | Holds | Rule |
| --- | --- | --- |
| Title bar | grip, runner type, instance name, loop length, mode readout, **Q** (queue) | identity and the clip's loop; its background is the drag grip |
| Control strip | **Play**, **Run**, stop, **Rec** · **out**, **in**, **Thru**, **MPE Out**, **bend** | the same items for every runner; never wraps (port choosers shrink) |
| Source section | **source** roll; its header holds the instance's **tempo** and the roll's common tools | the same for every runner |
| Params | "<runner> params": the runner's own params, all declared by the runner (no shared base params; playback honours `transpose` and `speed` when a runner defines them) | below the source roll, titled, so they never read as the roll's common tools; the only region whose size depends on the runner; a wrapping grid |
| Output sections | **generated**, **preview** (header holds **Regenerate**) | an empty generated/preview roll collapses to a one-line hint |
| Status line | errors, recording state, last event, runner log | transient text, at the bottom like Ableton's status bar |

Colour roles, defined as tokens in `src/styles.css`, are exclusive so a colour
always reads the same:

| Colour | Meaning |
| --- | --- |
| green | Play: its button, mode lamp, playhead and shape outline |
| amber | Run: the same places |
| red | Rec and live MIDI input (held keys, notes being recorded), error text |
| blue | selection and focus, toggles that are on (Snap, Thru, MPE Out, Q, Notes/MPE), selected notes |
| yellow | unsaved project |

Note fills are not chrome: runners pick them by convention (tag colours,
`generatedNoteColor`).

Controls come from `src/ui/controls/` and no native form widgets are shown:

- **NumberBox**: drag up/down to change (Shift for fine steps), double-click
  to type, arrow keys when focused. Params use its bar form, which fills from
  zero for a bipolar range. `onCommit` fires once per gesture, for undoable
  edits such as tag fields.
- **Chooser**: a flat dropdown whose list opens over the canvas.
- **Toggle**: a text or icon toggle, filled when on.
- **Button**: label and/or icon; `tone` colours it by the roles above.
- **TextField**, **Field** (a caption next to a control) and **Lamp** (a
  status dot).

Every control carries `data-control`, which the title bar uses to tell a
control from its draggable background. Icons are SVGs in `icons.tsx`, not
emoji. The roll's canvas defaults match: a dark grid, rows shaded by the
clip's scale (root lighter, out-of-scale darker), bar lines brighter than beat
lines, the area past the loop shaded.

## Piano roll

Laid out after Ableton Live's MIDI clip editor (checked against screenshots
of Live 12):

- **Keyboard column** left of the grid: piano keys on the note rows, C
  labels plus the label of the row under the pointer, a purple strip on keys
  in the clip's scale (lighter on the root), and value rulers beside the
  lanes. Pressing a key plays it on the instance's output while held (the
  key turns orange); dragging across keys glides. The wheel scrolls the grid.
- **Notes / MPE** in the tool row switch the editing mode, like Live's Notes
  and MPE tabs.
- **Notes mode**: notes edit as before, with a **Velocity** lane under the
  grid. Each note has a marker: a circle at its start at the height of its
  velocity and a line to its end. Drag a marker (the selected notes move
  together, Shift for fine steps); Alt/Cmd-drag a note in the grid; with
  draw mode on, drag in the lane to paint velocities (only the selected notes
  when any are selected). The lane bar's field sets the selection's velocity.
  Hovering a marker shows its value.
- **MPE mode**: notes do not move, resize or get added; clicking selects.
  Unselected notes are greyed. Each selected note gets a translucent column
  through the grid and the lanes; its pitch envelope is edited on the note,
  its **Pressure** and **Timbre** (CC74) envelopes in lanes. Hover zones,
  nearest first: on a point (it gets a ring and its value shows, e.g.
  `+2.73 st`); within 4px of the line (a ghost point locked to the line
  follows the pointer and a click adds it there); within 12px of a segment
  (it highlights, and dragging it moves both of its points by the same delta;
  the flat runs before the first and after the last point move that point).
  Drag a point to move it (selected points move together and stay between
  their neighbours; the value shows while dragging), click a point to delete
  it, drag in the note's column for a time-range selection (it stays shaded
  until the selection changes), Delete removes the selection, R toggles
  rooted on selected pitch points, Escape clears. Shift is fine adjustment;
  Cmd/Ctrl snaps pitch to semitones. A note with no envelope shows a dashed
  line at the rest value.
- **Right-click** a breakpoint or a velocity marker: **Edit Value** (type an
  exact number; pitch accepts `+2.73 st`), **Delete**, and **Root / Unroot**
  on pitch points. The roll keeps the browser's and tldraw's menus out.
- **Lane bar** under the lanes: which lanes show, the lane's tools, and the
  note count.
- **Resizing notes**: there are no handles; near a note's left or right
  edge (6px, a third of the note when it is short) the cursor becomes a
  resize cursor, and dragging there resizes. An unselected note is selected
  first (Shift adds it); a selection resizes together. Both modes (in MPE
  mode a breakpoint on the edge wins). Below one grid step the edge follows
  the pointer, so notes can be shorter than the grid.
- **Adding and selecting**: a double click on the grid adds a note and
  leaves it selected; holding the second press and dragging draws its end out
  (one undo step, as draw mode does). With several notes selected, a click on
  one of them selects just it; dragging it moves the whole selection.
- **Auditioning**: clicking or drawing a note plays it. Moving notes replays
  the whole moved set at its new pitches (each pitch row a drag crosses, each
  arrow up/down), pressing a note of a multi-note selection plays the group,
  and a marquee plays notes as it reaches them (a note that leaves and comes
  back plays again). At most 12 notes sound at once, one per pitch.
- **Pitch labels**: the top bar's **Name / MIDI** switch labels notes and
  keyboard rows with note names (C3 = 60) or MIDI numbers, in every roll; it
  is saved with the project (`pitchLabels`). Hovering a note shows the other
  form above it (`MIDI 67`, or `G3` in MIDI mode), and the label follows the
  note while it is dragged.
- **Cmd/Ctrl-A** depends on where focus is: in a text field it selects the
  field's text; in the Source roll (its grid, keyboard column, lanes, lane bar
  or tool row) it selects all notes, except in MPE mode right after working
  on an envelope (a point, the line, a segment or a range) with notes
  selected, where it selects all of that envelope's breakpoints on the
  selected notes (Ableton's "click the envelope, Cmd-A"). In the Generated
  and Preview rolls and on the instance's controls it does nothing (no page
  text, no tldraw select-all). On the empty canvas it is tldraw's.
- **Generated / Preview views** follow the Source roll's view by default.
  Their headers have **Follow**, zoom and **Fit** (Fit includes ghost notes,
  so trills come into view); scrolling or zooming one turns Follow off, and
  turning Follow on snaps it back to the Source view.
- **Roll heights**: drag the bar along the bottom of a section (Source,
  Generated, Preview) to make its roll taller or shorter (80 to 1200 px). The
  heights are saved per instance in the shape's meta (`rollHeights`), outside
  undo, like the saved view.

Every edit is one step on the roll's undo stack. Lanes and the mode switch
appear only on the editable Source roll; Generated and Preview show the
keyboard column. Not done yet: Live's chance, velocity deviation, release
velocity, randomize/ramp tools, curved segments and draw mode for envelopes.
Right-click on a pressed point only opens the menu; only the primary button
edits.
The code is `src/pianoRoll/expression.ts` (lanes and gestures), `lanes.ts`
(layout) and `gutter.ts` (keyboard column).

## Live input and recording

The **in** chooser and the toggles after it in the control strip are the
instance's live MIDI input:

| Control | Effect |
| --- | --- |
| **In** | The MIDI input this instance listens to. Several instances can share one input, like several armed tracks in a DAW. Opening the list re-scans ports, so a device plugged in later shows up. |
| **Rec** | Records into the instance's clip (see below). Needs an input. |
| **Thru** | Echoes the input to the instance's MIDI output, with transpose applied. Turn it off if the controller already drives the synth. |
| **MPE Out** | MPE output: every played note gets its own member channel (2-16, lower zone) with its pitch bend, pressure and timbre. Off: everything on channel 0 and expression is not sent. Always on (and greyed out) for a Six Sines output, which takes each note's tuning, pressure and brightness natively. |
| **bend** | Semitones at full pitch bend, used both to read recorded bend and to send MPE bend. 48 is the MPE default; ordinary keyboards are usually 2. Must match the controller and the synth. |
| **Root** and **¢** | Auto-root (on by default, 15 cents): recorded pitch-curve points where the pitch rests on a semitone are marked `rooted` (see below). |

While an input is selected, held keys are highlighted on the source roll
(their row, a marker at the left edge, and a tick showing their current bend),
like the keyboard strip in Ableton. While recording, each note grows on the
roll from its start until its note-off, with its bend drawn live.

Rec behaves like Ableton's session view:

- **Playing or running**: overdub. A note lands at the loop position it was
  played at (wrapping at the loop end, scaled by speed) and joins the clip at
  its note-off, so the next pass plays it.
- **Idle, clip has notes**: starts **Play** and overdubs.
- **Idle, empty clip**: a free take from the moment Rec is pressed. Stopping
  sets the loop length to the take rounded up to a whole bar (4 beats). It
  does not start playback.

Stopping playback ends an overdub. Notes still held when Rec stops are cut at
that moment. The whole take is one undo step in the source roll (Undo in its
control panel), as long as the source section is open.

### MPE

Recording keeps per-note expression the way livecode's recorder does: pitch
bend, channel pressure and timbre (CC74) are tracked per channel, and MPE
controllers send each note on its own channel, so each note gets its own
curves. Poly pressure is recorded for its key. Curves start from the values
their channel had at note-on, are thinned to stay within 0.05 semitones (bend)
or one step (pressure, timbre), and are stored only when they leave their rest
value (no bend, zero pressure, timbre 64). On an ordinary keyboard a channel's
pitch wheel applies to every note held on it. If a take used several channels
and MPE output is off, the status line says so.

Playback with **MPE** on sends a note's starting bend, pressure and CC74 on its
channel just before the note-on, then follows the curves about 100 times a
second while it is held. Channels are allocated per output port, so instances
that share a port do not collide. A free channel that was released longest ago
is reused first. With all fifteen busy, the oldest is shared. Thru keeps the
controller's own channels, which can overlap with channels used by playback on
the same port.

**Rooted points.** A pitch-curve point marked `rooted` sits on a pitch rather
than between pitches. Scale-aware transposition (`scaleTransposeMPE` in
`packages/music-types/ableton_clip.ts`) moves each run of rooted points
through the scale on its own and interpolates the points between, so a slide
from one scale degree to another still lands on scale degrees after the
transpose. Music runners has no scale-aware operations yet (its transpose is
chromatic and moves every point equally), so the flag is metadata for runner
algorithms to use. With **Root** on, a run of recorded points within the
tolerance of one semitone is rooted when the pitch rests there at least
60 ms (`ROOT_MIN_DWELL_SEC` in `src/model/mpe.ts`), so the note's start and a
held target are rooted and a slide passing through a semitone is not. Each
rooted run keeps its first and last point through curve thinning.

The roll draws a note's pitch curve over it, light with a dark halo; at
readable zoom its points show as filled dots when rooted and hollow ones
otherwise. All three curves are edited in the roll's MPE mode (see "Piano
roll" below). Dragging or resizing a note keeps its curves (their time axis
is 0..1 across the note, so a resize stretches them).

## Starting runners

- **Variants**: tag notes `variant` (alt steps + probability) and `trill`.
  Alt steps are moves from the note within the instance's **scale** param
  (a root chooser and degree list in the params row; C major by default), so
  they follow the note when it moves: `+1`, `-5` (scale degrees; no sign means up), `+2+` (two degrees
  and a semitone; a bare trailing sign is 1), `+2+2` (two degrees and a whole
  tone), `-1-`, `+0+`. A note not in the scale counts from its nearest scale
  note. Ghost notes show each step's result, labelled with the step
  (`src/runners/variants/steps.ts`, built on `Scale` from
  `packages/music-types`).
  A trill trigger has a **probability** (0..1, chance it fires each time the
  note plays) and **trill notes**, a list like `8` or `3 4 5`: each firing
  picks one uniformly and sends it as the event's `count`; left empty, the
  receiver uses its own trill notes param.
  Hotkeys `v` and `t` while the source roll has focus toggle them on the
  selection; the metadata panel edits the fields.
- **Extender**: each loop one random note (not tagged `noExtend`, hotkey `x`)
  is held a full extra loop. On a received trill event it plays a trill between
  its last pitch and the event's pitch.
- **Arp**: arpeggiates the chord under the source roll's **cursor** (click
  the empty grid to move it; it snaps to the roll's grid). The chord is the
  notes sounding at the cursor, low to high, numbered 0, 1, 2, … The
  **pattern** param is [Tidal/Strudel
  mini-notation](https://strudel.cc/learn/mini-notation), parsed by
  `@strudel/mini`, whose only atoms are those indexes and `~` rests:
  `0 1 2`, `[0 1] 2`, `<0 2>` (one per cycle), `0*2`, `0(3,8)`, `[0,2]`
  (together), `0@3 1`, `0?`, `0|2`, `{0 1 2}%4`. Indexes wrap around the
  chord both ways (`-1` is the top note, `3` on a triad is the bottom
  again); **wrap shift** adds semitones per wrap (0 wraps in place, 12 goes
  up an octave, and `-1` lands an octave down). One cycle lasts **cycle**
  beats; **gate** is the note length as a fraction of its step; velocity
  comes from the chord note. The chord is read at the start of each cycle,
  so a cursor move takes effect on the next one. Until then the source roll
  shows two lines: the amber **playing** line, with the playing chord's
  extent tinted, and the blue cursor over the next chord. The Generated
  roll shows the cycle under the chord it came from. With no notes under the
  cursor the arp goes quiet after the current cycle ("waiting" in the
  sidebar) and starts a new cycle as soon as there is a chord under it
  again. **Play** plays the clip's chords as written. Code:
  `src/runners/arp/` (`pattern.ts` for parsing and chord lookup).
  `@strudel/mini` and `@strudel/core` are AGPL-3.0-or-later.

## State management

UI-facing state is valtio proxies (`src/store/*.ts`, and the roll's own
`uiState`); components read them with `useSnapshot`. Hot state (the roll's
Konva core, the clock, MIDI ports, running branches) is plain mutable objects
outside React. Per-frame data (the playhead) goes through the roll's
`setPlayheadMarkers` handle, never through props. The full rule set is in
`implementation_plans/music_runners_plan.md`.

## Layout

```
server/projectFiles.ts      Vite middleware: GET/PUT /api/projects/<name>
src/model/mpe.ts            MPE curves, bend conversion, member-channel pool
src/pianoRoll/              React + Konva piano roll (types.ts is the contract)
src/store/                  clips, clock, midi, events, connections, pulses,
                            playback, project, recording (live input),
                            rollHandles
src/ui/ConnectionLayer.tsx  connection labels (type choosers) and send flashes
src/runners/base/           RunnerShape (instance chrome + rolls), TagEditor
src/runners/<name>/         one runner per directory
src/shapes/                 shape util registration, createInstance,
                            clip copying on duplicate and paste
src/ui/                     TopBar, RunnerSidebar
src/debugHook.ts            window.__musicRunners for scripts and the console
demo.html + demo/           standalone piano roll demo and its Playwright checks
```

## Verifying

- `npm run type-check`.
- Unit tests: `npx tsx --test src/model/mpe.test.ts src/pianoRoll/scale.test.ts src/pianoRoll/metadata/groupEdit.test.ts`.
  Variant steps run under Deno (they import `packages/music-types`):
  `deno test --no-check --sloppy-imports src/runners/variants/steps.test.ts`.
- Variant steps in the app: `demo/variants.e2e.mjs`.
- The arp (pattern validation, cursor switch on the next cycle, waiting and
  restarting, wrapping): `demo/arp.e2e.mjs` (same setup as the recording
  check below).
- Connections without a device: `demo/connections.e2e.mjs` (same setup as
  the recording check below).
- Velocity lane, keyboard column and MPE editing: `demo/lanes.e2e.mjs`
  (same setup).
- Duplicating, pasting and moving instances: `demo/duplicate.e2e.mjs`
  (same setup).
- The sidebar (adding, transport state, reveal, rename, queue, resize):
  `demo/sidebar.e2e.mjs` (same setup).
- Note resizing from the edges: `demo/resize.e2e.mjs` (same setup).
- Double-click add, double-press-and-drag, click to narrow a selection: `demo/click-edit.e2e.mjs`.
- Auditioning moved notes and marquee selections: `demo/audition.e2e.mjs`
  (same setup).
- Cmd-A scoping, focus, and the output rolls' view tools:
  `demo/focus-and-views.e2e.mjs` (same setup).
- Recording and MPE playback without a device: `demo/recording.e2e.mjs`
  replaces Web MIDI in the page with a fake input and output, then drives a
  free take, MPE playback, an overdub, undo and a reload (see its header for
  how to run it).
- Headed checks: Playwright with the installed Chrome
  (`chromium.launch({ channel: "chrome" })`) and
  `context.grantPermissions(["midi", "midi-sysex"], { origin })` so Web MIDI
  opens without a prompt; `window.__musicRunners` exposes the editor and
  stores.
- Real MIDI: open an IAC bus input natively (`@avtools/midi/native`) while the
  browser plays to that bus and check note-on/off bytes arrive.

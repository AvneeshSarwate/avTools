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
(`server/projectFiles.ts`): the tldraw snapshot, every bank and the bpm, in
one file. Autosave runs about a second after any change; the top bar also has
a save button, a project chooser and a "new project" field (`?project=<name>` in the
URL). Nothing is kept in browser storage.

Web MIDI needs a user gesture in some browsers; the first click on the page
opens it, and the top bar shows the status. Everything plays on channel 0
unless an instance has **MPE Out** on (see below).

## Concepts

- **Runner**: a template under `src/runners/<name>/`: a tag schema for note
  metadata, params, a pure `generate(bank, random)` that makes one loop, and a
  `run(api)` that loops until stopped. `src/runners/runnerTypes.ts` is the
  thin contract; copy a runner directory to make a new one and register it in
  `src/runners/registry.ts`.
- **Bank**: one piano roll (notes, loop length, scale, note metadata) tagged
  with a runner type. The left sidebar lists banks by type. Several instances
  can reference one bank.
- **Scale**: each bank has one, edited in the Source roll's tool row: a root
  chooser (accidentals spelled both ways, F#/Gb) and a degree field, semitones
  above the root from 0 with the octave last (ionian is `0 2 4 5 7 9 11 12`;
  the 12 is added if left out). It is stored as `bank.scale = { root, degrees }`
  with `root` a MIDI note (60 = C4), the shape `new Scale(degrees, root)` takes
  in `packages/music-types`, so a runner can build one directly. Missing means
  C major. All three rolls shade from it: root rows lighter, out-of-scale rows
  darker (in C major the darker rows are the black keys). Scale edits are not
  on the roll's undo stack (like loop length).
- **Instance**: a tldraw shape (`runner-<type>`) bound to one bank, with a
  MIDI output, params (transpose now, speed at the next loop), two transports
  (**Run** the algorithm, **Play** the bank verbatim), a queue toggle, and
  three collapsible rolls: **source** (editable, edits the bank), **generated**
  (the loop now sounding plus a live overlay of what actually played) and
  **preview** (output of **Regenerate**, a dry run). Layout below.
- **Events**: plain objects (`{ type, ...fields }`) sent with `api.emit` and
  received with `api.onEvent`. A runner lists the types it sends in its
  definition's `emits`. Routing is by **connection arrows** (see below).
  Pick the arrow tool, press on the sending instance's title bar (the top row
  with the grip, name, bank and loop), drag onto the receiving instance
  anywhere, and release. The title bar's background is also the grip for
  moving an instance with the select tool; everything below it belongs to
  the instance, so clicks there never reach the canvas.
- **Clock**: one shared root `TimeContext` (`src/store/clock.ts`) with the
  global bpm; each running instance is a branch of it. **Play queued** starts
  every queued instance at once.

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
steps, flat controls, about 11px type, and colour only where it means
something. An instance is laid out top to bottom in fixed regions:

| Region | Holds | Rule |
| --- | --- | --- |
| Title bar | grip, runner name, bank, loop length, mode readout, **Q** (queue) | identity and the bank's data; its background is the drag grip |
| Control strip | **Play**, **Run**, stop, **Rec** · **out**, **in**, **Thru**, **MPE Out**, **bend** | the same items for every runner; never wraps (port choosers shrink) |
| Params | transpose, speed, then the runner's own params | the only region whose size depends on the runner; a wrapping grid |
| Sections | **source** (its header holds the roll's tools), **generated**, **preview** (header holds **Regenerate**) | an empty generated/preview roll collapses to a one-line hint |
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
bank's scale (root lighter, out-of-scale darker), bar lines brighter than beat
lines, the area past the loop shaded.

## Piano roll

Laid out after Ableton Live's MIDI clip editor (checked against screenshots
of Live 12):

- **Keyboard column** left of the grid: piano keys on the note rows, C
  labels plus the label of the row under the pointer, a purple strip on keys
  in the bank's scale (lighter on the root), and value rulers beside the
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
- **MPE mode**: notes do not move, resize or get added; clicking selects.
  Unselected notes are greyed. Each selected note gets a translucent column
  through the grid and the lanes; its pitch envelope is edited on the note,
  its **Pressure** and **Timbre** (CC74) envelopes in lanes. Click a line to
  add a breakpoint, drag to move it (selected points move together and stay
  between their neighbours), click a point to delete it, drag in the note's
  column for a time-range selection (it stays shaded until the selection
  changes), Delete removes the selection, R toggles rooted on selected pitch
  points, Escape clears. Shift is fine adjustment; Cmd/Ctrl snaps pitch to
  semitones. A note with no envelope shows a dashed line at the rest value.
- **Lane bar** under the lanes: which lanes show, the lane's tools, and the
  note count.

Every edit is one step on the roll's undo stack. Lanes and the mode switch
appear only on the editable Source roll; Generated and Preview show the
keyboard column. Not done yet: Live's chance, velocity deviation, release
velocity, randomize/ramp tools, curved segments and draw mode for envelopes.
The code is `src/pianoRoll/expression.ts` (lanes and gestures), `lanes.ts`
(layout) and `gutter.ts` (keyboard column).

## Live input and recording

The **in** chooser and the toggles after it in the control strip are the
instance's live MIDI input:

| Control | Effect |
| --- | --- |
| **In** | The MIDI input this instance listens to. Several instances can share one input, like several armed tracks in a DAW. Opening the list re-scans ports, so a device plugged in later shows up. |
| **Rec** | Records into the instance's bank (see below). Needs an input. |
| **Thru** | Echoes the input to the instance's MIDI output, with transpose applied. Turn it off if the controller already drives the synth. |
| **MPE Out** | MPE output: every played note gets its own member channel (2-16, lower zone) with its pitch bend, pressure and timbre. Off: everything on channel 0 and expression is not sent. |
| **bend** | Semitones at full pitch bend, used both to read recorded bend and to send MPE bend. 48 is the MPE default; ordinary keyboards are usually 2. Must match the controller and the synth. |
| **Root** and **¢** | Auto-root (on by default, 15 cents): recorded pitch-curve points where the pitch rests on a semitone are marked `rooted` (see below). |

While an input is selected, held keys are highlighted on the source roll
(their row, a marker at the left edge, and a tick showing their current bend),
like the keyboard strip in Ableton. While recording, each note grows on the
roll from its start until its note-off, with its bend drawn live.

Rec behaves like Ableton's session view:

- **Playing or running**: overdub. A note lands at the loop position it was
  played at (wrapping at the loop end, scaled by speed) and joins the bank at
  its note-off, so the next pass plays it.
- **Idle, bank has notes**: starts **Play** and overdubs.
- **Idle, empty bank**: a free take from the moment Rec is pressed. Stopping
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

- **Variants**: tag notes `variant` (alt pitches + probability) and `trill`.
  Hotkeys `v` and `t` while the source roll has focus toggle them on the
  selection; the metadata panel edits the fields.
- **Extender**: each loop one random note (not tagged `noExtend`, hotkey `x`)
  is held a full extra loop. On a received trill event it plays a trill between
  its last pitch and the event's pitch.

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
src/store/                  banks, clock, midi, events, connections, pulses,
                            playback, project, recording (live input),
                            rollHandles
src/ui/ConnectionLayer.tsx  connection labels (type choosers) and send flashes
src/runners/base/           RunnerShape (instance chrome + rolls), TagEditor
src/runners/<name>/         one runner per directory
src/shapes/                 shape util registration, createInstance
src/ui/                     TopBar, BankSidebar
src/debugHook.ts            window.__musicRunners for scripts and the console
demo.html + demo/           standalone piano roll demo and its Playwright checks
```

## Verifying

- `npm run type-check`.
- Unit tests: `npx tsx --test src/model/mpe.test.ts src/pianoRoll/scale.test.ts src/pianoRoll/metadata/groupEdit.test.ts`.
- Connections without a device: `demo/connections.e2e.mjs` (same setup as
  the recording check below).
- Velocity lane, keyboard column and MPE editing: `demo/lanes.e2e.mjs`
  (same setup).
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

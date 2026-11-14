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
unless an instance has **MPE** on (see below).

## Concepts

- **Runner**: a template under `src/runners/<name>/`: a tag schema for note
  metadata, params, a pure `generate(bank, random)` that makes one loop, and a
  `run(api)` that loops until stopped. `src/runners/runnerTypes.ts` is the
  thin contract; copy a runner directory to make a new one and register it in
  `src/runners/registry.ts`.
- **Bank**: one piano roll (notes, loop length, note metadata) tagged with a
  runner type. The left sidebar lists banks by type. Several instances can
  reference one bank.
- **Instance**: a tldraw shape (`runner-<type>`) bound to one bank, with a
  MIDI output, params (transpose now, speed at the next loop), two transports
  (**Run** the algorithm, **Play** the bank verbatim), a queue toggle, and
  three collapsible rolls: **source** (editable, edits the bank), **generated**
  (the loop now sounding plus a live overlay of what actually played) and
  **preview** (output of **Regenerate**, a dry run). Layout below.
- **Events**: an instance emits events to the instances that tldraw arrows
  drawn from it point at. Pick the arrow tool, press on the sending
  instance's title bar (the top row with the grip, name, bank and loop),
  drag onto the receiving instance anywhere, and release: the arrow binds to
  both and the trill triggers reach the target. The title bar's background is
  also the grip for moving an instance with the select tool; everything below
  it belongs to the instance, so clicks there never reach the canvas.
- **Clock**: one shared root `TimeContext` (`src/store/clock.ts`) with the
  global bpm; each running instance is a branch of it. **Play queued** starts
  every queued instance at once.

## Instance layout and UI conventions

The chrome follows Ableton Live's dark themes: grey surfaces in a few tonal
steps, flat controls, about 11px type, and colour only where it means
something. An instance is laid out top to bottom in fixed regions:

| Region | Holds | Rule |
| --- | --- | --- |
| Title bar | grip, runner name, bank, loop length, mode readout, **Q** (queue) | identity and the bank's data; its background is the drag grip |
| Control strip | **Play**, **Run**, stop, **Rec** · **out**, **in**, **Thru**, **MPE**, **bend** | the same items for every runner; never wraps (port choosers shrink) |
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
| blue | selection and focus, toggles that are on (Snap, Thru, MPE, Q), selected notes |
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
emoji. The roll's canvas defaults match: a dark grid, black-key rows a step
darker, bar lines brighter than beat lines, the area past the loop shaded.

## Live input and recording

The **in** chooser and the toggles after it in the control strip are the
instance's live MIDI input:

| Control | Effect |
| --- | --- |
| **In** | The MIDI input this instance listens to. Several instances can share one input, like several armed tracks in a DAW. Opening the list re-scans ports, so a device plugged in later shows up. |
| **Rec** | Records into the instance's bank (see below). Needs an input. |
| **Thru** | Echoes the input to the instance's MIDI output, with transpose applied. Turn it off if the controller already drives the synth. |
| **MPE** | MPE output: every played note gets its own member channel (2-16, lower zone) with its pitch bend, pressure and timbre. Off: everything on channel 0 and expression is not sent. |
| **bend** | Semitones at full pitch bend, used both to read recorded bend and to send MPE bend. 48 is the MPE default; ordinary keyboards are usually 2. Must match the controller and the synth. |

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

The roll draws a note's pitch curve over it. Pressure and timbre are stored
and played but have no lanes yet, and curves cannot be edited in the roll.
Dragging or resizing a note keeps its curves (their time axis is 0..1 across
the note, so a resize stretches them).

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
src/store/                  banks, clock, midi, events, playback, project,
                            recording (live input), rollHandles
src/runners/base/           RunnerShape (instance chrome + rolls), TagEditor
src/runners/<name>/         one runner per directory
src/shapes/                 shape util registration, createInstance
src/ui/                     TopBar, BankSidebar
src/debugHook.ts            window.__musicRunners for scripts and the console
demo.html + demo/           standalone piano roll demo and its Playwright checks
```

## Verifying

- `npm run type-check`.
- Unit tests: `npx tsx --test src/model/mpe.test.ts src/pianoRoll/metadata/groupEdit.test.ts`.
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

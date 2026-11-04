# music-runners

A standalone prototyping app for piano-roll "runners": procedural playback
templates on a tldraw canvas, firing MIDI straight from the browser. It
borrows the piano-rolls-on-a-canvas workflow from `docs/livecode` and drops
that project's engine/UI split, entity registry and protocol so interactions
can be iterated on freely. Decisions and the roadmap live in
`implementation_plans/music_runners_plan.md` at the repository root.

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
Save, a project picker and a "new project" field (`?project=<name>` in the
URL). Nothing is kept in browser storage.

Web MIDI needs a user gesture in some browsers; the first click on the page
opens it, and the top bar shows the status. Everything plays on channel 0.

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
  **preview** (output of **Regenerate**, a dry run).
- **Events**: an instance emits events to the instances that tldraw arrows
  drawn from it point at. Pick the arrow tool, press on the sending
  instance's header bar (the strip with the grip, bank and MIDI selectors),
  drag onto the receiving instance anywhere, and release: the arrow binds to
  both and the trill triggers reach the target. The header bar is also the
  grip for moving an instance with the select tool; everything below it
  belongs to the instance, so clicks there never reach the canvas.
- **Clock**: one shared root `TimeContext` (`src/store/clock.ts`) with the
  global bpm; each running instance is a branch of it. **Play queued** starts
  every queued instance at once.

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
src/pianoRoll/              React + Konva piano roll (types.ts is the contract)
src/store/                  banks, clock, midi, events, playback, project
src/runners/base/           RunnerShape (instance chrome + rolls), TagEditor
src/runners/<name>/         one runner per directory
src/shapes/                 shape util registration, createInstance
src/ui/                     TopBar, BankSidebar
src/debugHook.ts            window.__musicRunners for scripts and the console
demo.html + demo/           standalone piano roll demo and its Playwright checks
```

## Verifying

- `npm run type-check`.
- Headed checks: Playwright with the installed Chrome
  (`chromium.launch({ channel: "chrome" })`) and
  `context.grantPermissions(["midi", "midi-sysex"], { origin })` so Web MIDI
  opens without a prompt; `window.__musicRunners` exposes the editor and
  stores.
- Real MIDI: open an IAC bus input natively (`@avtools/midi/native`) while the
  browser plays to that bus and check note-on/off bytes arrive.

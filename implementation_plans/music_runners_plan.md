# Music Runners: plan and decisions

Status: decisions agreed 2026-11-03. Phases 0 and 2-5 implemented the same day in `apps/music-runners/` (see its README); Phase 1 (React+Konva piano roll) delivered by a subagent and integrated: the three rolls share one view (saved in shape meta), audition, tag hotkeys, ghost variants, loop-end line, playhead and reload all verified in Chrome with a native IAC listener.
Owner conversation: piano-roll "runners" offshoot of `docs/livecode`.

This file is the memory of the decisions. Re-read it after any context
compaction before continuing implementation.

## What this is

A new standalone prototyping app at `apps/music-runners/`. It borrows the
"piano rolls on a tldraw canvas" workflow from `docs/livecode` but deliberately
drops the architecture: no Deno server, no engine/UI transport split, no
entity registry, no protocol package, no `*.orig.ts` modules. Everything runs
in one browser tab and fires MIDI directly. Once interactions feel good, ideas
get brought back into livecode in a separate effort.

Must reuse, as raw-TS workspace packages via Vite aliases (same mechanism as
`apps/livecode-tldraw/vite.config.ts`):

- `@avtools/core-timing` (`packages/core-timing/mod.ts`): `launchBrowser`,
  `TimeContext.wait/waitSec/branch/branchWait/random/setBpm`.
- `@avtools/midi/browser` (`packages/midi/browser.ts`): `openMidiAccess`,
  `listOutputs`, `openOutput`, `noteOn/noteOff`. Zero-based channels.
- `@avtools/music-types` (`packages/music-types/mod.ts`): `Scale`,
  `AbletonClip` helpers where useful.
- `tldraw` (v5, React 19) for the canvas; same versions as livecode-tldraw.

## Core concepts (agreed)

- **Runner** = a template. One directory `src/runners/<name>/` holding: the
  note-metadata (tag) schema, the loop-generating/playing algorithm, the
  param schema, and a custom tldraw shape that extends the base runner shape.
  Multiple instances of one runner can exist. Runner code is a *soft pattern*
  for coding agents to copy and customize per piece, not a hard API for reuse.
- **Bank** = one piano roll data object (`notes`, `loopLength`, metadata on
  notes) tagged with a runner type. A sidebar lists all banks grouped by
  runner type and has "new bank" per type. Many instances may reference one
  bank.
- **Runner instance** = a tldraw shape that always references exactly one
  bank. Editing the source roll in the instance edits the bank in place.
- **Events** = a minimal bus. An instance emits events; they are delivered to
  the instances it points at. Targets are the tldraw **arrows** drawn from the
  instance shape to other instance shapes (arrow bindings are the routing).
  The receiving runner's code decides what to do with an event.
- **Queue** = per-instance toggle plus a global "play all queued" button.

## Decisions from the Q&A (2026-11-03)

1. **Piano roll**: full reproduction of the existing Vue + Konva piano roll
   (`apps/browser-projections/src/pianoRoll/`) as a **React + Konva**
   component. Konva kept for performance. This is a clean reproduction task
   suitable for a subagent (or its own conversation before implementation).
   Feature floor = parity with the existing component minus the WebSocket
   client pieces; MPE lanes can be dropped for the first pass if they cost a
   lot, but note metadata, undo/redo, copy/paste, marquee, drag/resize with
   overlap handling, snap, zoom/scroll/scrollbars, keyboard nudges, playhead
   markers, fit-to-content, and the control panel all stay.
2. **Tagging flow**: the existing component already has a structured
   group-edit metadata editor (`NoteMetadataEditor.vue`, `MetadataNode.vue`,
   `metadataGroupEdit.ts`, `noteMetadataRules.ts`), with a raw-JSON fallback
   textbox. Port the pure group-edit logic. Replace the freeform JSON textbox
   with a small **structured editor driven by the runner's tag schema**
   (fields with types, defaults, hotkeys). This will be iterated on.
3. **Persistence**: must be **disk-savable, not browser localStorage**.
   Human-readable diffs do not matter. Plan: a tiny Vite dev-server middleware
   (`GET/PUT /api/projects/<name>`) that reads/writes
   `apps/music-runners/projects/<name>/project.json`. One JSON file holds the
   tldraw store snapshot, all banks, and global settings (bpm). Debounced
   autosave plus an explicit Save button and a project picker.
4. **Event routing UI**: tldraw arrows between instance shapes (see above).
5. **Clock**: one shared root `launchBrowser` TimeContext created on the
   first user gesture, global BPM in the top bar. Each running instance is a
   `branch` of the root. "Play all queued" starts every queued instance at the
   same instant. Starting one instance is immediate, not bar-quantized.
   Per-instance **speed** is a multiplier sampled at the start of each loop.
6. **Loop length**: the current wire type has no loop length (the Vue state
   only has a growing `grid.maxLength`). Add an explicit `loopLength` in beats
   to bank data, editable via a plain text field in the instance chrome.
   Trimming shorter than the last note is allowed; notes beyond the loop are
   kept in data (not deleted) and reappear when the length grows. Empty
   space after the last note is a normal case.
7. **Instance rolls**: three collapsible sub-sections per instance:
   - **Source** (interactive, edits the bank),
   - **Generated** (read-only: the loop currently being played, plus a live
     overlay of what actually played, including reactive things like trills,
     plus a playhead marker),
   - **Preview** (read-only: output of a "regenerate" button that dry-runs the
     algorithm without playing; a cheap version of the preview-shadow idea).
8. **Params** live on the instance, not the bank: `transpose` (semitones,
   applied immediately) and `speed` (multiplier, applied at the next loop).
   Shown as sliders in the instance chrome. Directory name: `apps/music-runners`.

Smaller agreed assumptions:

- Runner 1 variants are a list of alternate pitches with weights, drawn as
  ghost notes at those pitches, linked to the source note.
- Runner 2's trill plays on Runner 2's own output as a branch layered over its
  loop, immediately when the event arrives.
- MIDI channel 0 everywhere; channel selector can come later.
- Note preview: drawing/clicking/dragging a note in the source roll sends a
  short note to the instance's MIDI output (Ableton style). Transports:
  **Run** (the runner algorithm) and **Play** (verbatim looping playback of
  the bank with transpose). Play state is shown in the chrome.

## Starting runners

**Runner 1: `variants`**
- Tags: `variant { pitches: number[]; weights?: number[]; probability: number }`
  (probability that a variant replaces the note), `trillTrigger: true`.
- Each loop: build the loop by resolving variants with `ctx.random()`. When a
  `trillTrigger` note plays, emit `{ type: "trill", pitch, velocity }` to all
  arrow targets.

**Runner 2: `extender`**
- Each loop around: pick one random note and extend its duration by a full
  loop length (it sustains across the boundary into the next loop).
- On a `trill` event: compute a trill phrase from the last note this runner
  played and the incoming pitch, play it as a branch on its own output, and
  show it in the Generated roll's live overlay.

## Architecture sketch

```
apps/music-runners/
  package.json  vite.config.ts  tsconfig.json  index.html
  projects/<name>/project.json            # disk persistence (git-tracked ok)
  src/
    main.tsx  App.tsx  styles.css
    pianoRoll/                            # React+Konva reproduction (Phase 1)
      PianoRoll.tsx  state.ts  core.ts  viewport.ts  scrollbars.ts
      keyboard.ts  commandStack.ts  metadata/ (group edit + schema editor)
    store/                                # plain mutable stores, no engine
      banks.ts        # Bank records, create/update/list by runner type
      project.ts      # load/save project.json via /api, autosave
      clock.ts        # root TimeContext, bpm, start/stop helpers
      midi.ts         # MidiAccess singleton, output cache by port name
      events.ts       # emit(fromShapeId, event) -> arrow targets
      playback.ts     # per-instance run state (idle/playing/running), queue
    runners/
      runnerTypes.ts  # RunnerDefinition, TagSchema, ParamSpec, LoopNotes
      registry.ts     # all runner definitions by type
      base/           # BaseRunnerShape: chrome + 3 collapsible rolls
      variants/       # runner 1: schema.ts  algorithm.ts  shape.tsx
      extender/       # runner 2
    shapes/           # tldraw ShapeUtils registration, arrow helpers
    ui/               # TopBar (bpm, play-all-queued, save, project), BankSidebar
```

Runner definition is intentionally thin:

```ts
interface RunnerDefinition {
  type: string; label: string;
  tags: TagSchema;                 // drives the structured metadata editor
  params: ParamSpec[];             // transpose + speed at minimum
  run(api: RunnerApi): Promise<void>;   // loop forever until cancelled
}
// RunnerApi: ctx (branch of root), getBank(), getParams(), output (noteOn/Off
// with transpose applied), emit(event), onEvent(handler), publishLoop(notes)
// for the Generated roll, reportPlayed(note) for the live overlay,
// playLoop(notes) helper that handles note branches and speed.
```

Instance shape props: `w, h, runnerType, bankId, midiOutputName, params,
queued, collapsed: {source, generated, preview}`. Run state is not persisted.

## Phases

0. Scaffold the app (Vite + React + tldraw), aliases to workspace packages,
   `npm run dev`, `tsc --noEmit`, empty canvas with top bar.
1. React + Konva piano roll reproduction (subagent or separate conversation).
   Deliver as a standalone component with a demo page, verified by screenshot
   against the Vue component rendering the same notes.
2. Banks store, loopLength, project.json persistence middleware, sidebar.
3. Base runner shape: chrome (bank selector, MIDI output selector, params,
   Run/Play/Stop, queue toggle, state badge, loop length), three collapsible
   rolls, note preview on edit, clock + MIDI singletons.
4. Runner 1 and Runner 2 with their tag schemas, structured metadata editor,
   ghost-note rendering for variants.
5. Arrow-based events, queue + play-all-queued, live overlay, preview roll.
6. Polish pass on whatever felt bad while using it.

## Progress notes (2026-11-03)

- Runtime chain verified end to end with Playwright driving Chrome
  (`channel: "chrome"`, `grantPermissions(["midi","midi-sysex"])`) and a native
  listener on IAC Driver Bus 1: variants resolve per loop, trill events cross
  the arrow, the extender holds one note a full extra loop, notes past the
  loop length stay silent, Stop releases everything.
- Playwright browsers are not installed on this machine; use the Chrome channel.
- Web MIDI in headless Chrome needs both `midi` and `midi-sysex` granted.
- `window.__musicRunners` (src/debugHook.ts) exposes editor, stores and the
  source-roll handles (`sourceRollHandles`) for scripts.
- Known polish items: the Generated roll dims notes that have not sounded yet
  this loop and shows ad hoc (trill) notes as pink ghosts; played ghosts that
  coincide with their note are otherwise invisible. Trill notes outside the
  fitted pitch range need a manual zoom-out. No MIDI channel selector yet.

## State and rendering rules (performance pass, 2026-11-03)

The piano roll and the app follow one split, and new code (custom runner
views, new panels) should keep to it:

1. **Imperative core, plain objects.** Everything touched per pointer event
   or per frame (the roll's `PianoRollState`, Konva layers, the TimeContext,
   open MIDI ports, active runs) is plain mutable module/instance state. It is
   never proxied, never in React state, never read through a store.
2. **UI-facing projection in valtio.** What chrome needs to display lives in
   `proxy()` objects (`banksStore`, `playbackStore`, `midiStore`,
   `clockStore`, `projectStore`, `eventLogStore`, and the roll's private
   `uiState`). Components read them with `useSnapshot` and re-render only
   for the fields they read, so there is no `useMemo` discipline to forget.
   The core writes the projection at commit points (selection change, note
   edit, command stack change, loop published, note sounded), not per frame.
3. **Per-frame data bypasses React.** Playhead markers go through the roll's
   `setPlayheadMarkers` handle method, scroll thumbs are written to the DOM,
   Konva redraws use per-layer dirty flags (`state.dirty.{ghosts,notes,
   overlay}`; `needsRedraw` means every layer). A prop that changes per frame
   is a bug.
4. **Identity is the change signal for arrays.** `bank.notes` is replaced as
   one array per edit; the roll hydrates by reference first and by JSON only
   when the reference changed. Pass stable arrays (module constants or
   memoized) for empty/static overlays.

Measured during a run with 600 notes across two instances (Playwright, system
Chrome): Konva layer rebuilds per second went from about 250 to about 33 (the
remaining ones are real note-sounded updates); frame rate stayed at 60 fps in
both cases, so the headroom is for larger pieces, not a visible fix.

5. **Immediate-mode Konva core.** `src/pianoRoll/core.ts` draws each layer
   through one custom `Konva.Shape` with raw canvas calls, hit-tests
   geometrically (`hitTest`), and culls through a sorted note index
   (`src/pianoRoll/noteIndex.ts`). No per-note Konva nodes exist. Measured by
   `demo/perfRoll.mjs` (10,000 notes, about 1,000 visible, headless Chrome):

   | metric | retained nodes (before) | immediate mode (after) |
   | --- | --- | --- |
   | redraw per wheel event, avg / p95 / max | 12.9 / 14.2 / 15.4 ms | 2.7 / 5.1 / 7.5 ms |
   | marquee of 221 notes, CPU | 176 ms | 47 ms |
   | drag 221 notes by 2 beats, CPU | 833 ms | 111 ms |
   | hydrate 10,000 notes, core time | 5.5 ms | 0.6 ms |

   The retained version spent most of a 16 ms frame per scroll step at that
   size, so a second roll on screen would have dropped frames; the rewrite
   leaves about 2.6 ms of unavoidable rect fill and stroke. Before/after
   screenshots under `demo/screenshots/` are pixel-identical.

## Live input, recording and MPE (2026-11-14)

Added per instance: a MIDI input selector, thru, Rec, an MPE output toggle and
a bend range (shape props `midiInputName`, `midiThru`, `mpe`, `bendRange`, with
a tldraw props migration so older projects load). Behaviour is in the app
README; the decisions worth carrying into the livecode port:

- **Data shape is livecode's.** Notes carry `mpePitch` / `mpePressure` /
  `mpeTimbre` with `time` 0..1 across the note, as in
  `packages/music-types/ableton_clip.ts` and the livecode recorder
  (`apps/livecode-tldraw/example-projects/feature-midi-recording`). Capture
  rules (per-channel tracking, values at note-on, thinning tolerances, rest
  values) are copied from that recorder.
- **Rec follows Ableton session view**, not livecode's take-replaces-roll
  toggle: overdub at the loop position while playing, Play+overdub when idle
  with notes, and a free take on an empty bank that sets the loop length to
  whole bars on stop. Notes join the bank at their note-off so later passes
  play them; the take is pushed as one undo step through a new roll handle
  method (`commitExternalEdit`).
- **Live preview is per-frame data**: held keys and growing notes go through
  the roll handle (`setLiveInput`) from the existing playhead tick, never
  through props or valtio, per the rendering rules above.
- **MPE output**: one member channel per sounding note, pooled per output port
  (`src/model/mpe.ts`), expression sent before note-on and then at ~100 Hz.
  Off means channel 0 and no expression, so non-MPE synths are unaffected.
- Open: no pressure/timbre lanes or curve editing in the roll; no MPE
  Configuration Message is sent (the synth's zone and bend range are set on
  the synth); thru keeps controller channels, which can overlap playback's
  channels on a shared port; a free take does not start looping on stop.
- Verified with `apps/music-runners/demo/recording.e2e.mjs` (fake Web MIDI in
  headless Chromium); not yet with a physical MPE controller.

## Chrome redesign (2026-11-14)

Reorganized the instance chrome after Ableton Live (layout and conventions in
the app README). Decisions:

- Fixed regions: title bar (identity + bank data), a non-wrapping control
  strip (transport + I/O, identical for every runner), a separate params
  grid (the only runner-dependent region), sections whose headers hold their
  own tools (roll toolbar portaled into the Source header via the roll's new
  `toolbarTarget` prop; Regenerate on Preview), and a status line at the
  bottom.
- Runner customization is expected in the roll canvas (event handling and
  drawing), not in the chrome, so the chrome is not a slot system.
- Colour roles are exclusive (green play, amber run, red rec/live input,
  blue selection). Note fills stay runner conventions and were not changed.
- Custom controls replace every native widget (`src/ui/controls/`). Value
  fields commit once per drag (`onCommit`) where an edit is undoable.
- Canvas defaults went dark (grid, handles, selection colour). Measured with
  `demo/perfRoll.mjs`: redraw per wheel event 1.58 ms before, 1.61 ms after.

## Auto-root on record (2026-11-14)

`rooted` on pitch points exists in `packages/music-types` (used by
`scaleTransposeMPE`) and the livecode protocol type, but nothing marked it
automatically; the livecode recorder does not set it. Music runners now does,
behind a per-instance toggle (props `autoRoot`, `rootToleranceCents`; shape
migration step 2). Decision: a point needs both closeness (tolerance, default
15 cents) and a dwell (60 ms constant) so slides passing through a semitone
are not rooted. Rooted runs are thinning anchors. No scale-aware operations
exist in music runners; they belong to runner algorithms when needed. The roll
shows rooted points as filled dots (display only, no curve editing yet).

## Verification

- `tsc --noEmit` in the app; `deno check` is not involved.
- Headed check via Playwright/dev-browser screenshots for rendering.
- MIDI: use the IAC bus and `packages/midi/tests/iac_browser_receiver.ts` to
  confirm note-on/off from the browser.
- No Claude attribution trailers on commits (user rule).

# Livecode Tldraw Architecture And File Index

This is the quick entrypoint for future agent chats about the React/tldraw
livecoding canvas. Start here, then read
`apps/deno-notebooks/livecode/architecture.md` for the Deno server/runtime side.

## Agent Jumpstart

`apps/livecode-tldraw` is a local-only React + tldraw client for the Deno
livecode visualizer in `apps/deno-notebooks/livecode`.

Core constraints:

- tldraw owns the canvas, shape placement, resizing, and selection.
- The Deno visualizer server owns analysis, generated module files, dynamic
  execution, Deno LSP, active wait snapshots, and the shared piano-roll store.
- Livecode source text is stored in `livecode-editor` shape props, then mirrored
  into the React runtime state for debounced analysis and execution.
- Piano-roll note data is not stored canonically in tldraw shape props. Shapes
  are named views onto server-owned piano-roll objects, currently defaulting to
  the `melody` roll.
- The app intentionally does not pass a tldraw `persistenceKey`; current canvas
  state is dev/test state, not migration-sensitive product data.
- `@avtools/piano-roll` is aliased to the built bundle at
  `webcomponents/piano-roll/dist/piano-roll.js`. When changing the Vue
  piano-roll source in `apps/browser-projections/src/pianoRoll`, rebuild that
  bundle before testing in this app.

## Current Shape

Run the Deno server:

```sh
cd apps/deno-notebooks
deno run --allow-all livecode/visualizer/main.ts --host 127.0.0.1 --port 7777 --log-level debug
```

Run the tldraw app:

```sh
cd apps/livecode-tldraw
npm run dev
```

Open:

```txt
http://127.0.0.1:5173/
```

The server URL input defaults to:

```txt
http://127.0.0.1:7777
```

The app accepts the same override convention through the runtime provider:

```txt
http://127.0.0.1:5173/?serverBaseUrl=http://127.0.0.1:7777
```

## Runtime Flow

1. `App.tsx` mounts `LivecodeRuntimeProvider`, then the tldraw canvas, then
   `PianoRollRuntimeProvider` scoped to the current server URL.
2. On first empty canvas mount, the app creates one `livecode-editor` shape and
   one `piano-roll-view` shape named `melody`.
3. `App.tsx` listens to the tldraw store. Added, removed, and updated
   `livecode-editor` shapes register/unregister/update module records in
   `livecodeRuntime.tsx`.
4. `livecodeRuntime.tsx` connects to `/health`, `/lsp`, and
   `/runtime/snapshots` when the user clicks Connect.
5. Source edits update the tldraw shape prop and schedule `/runtime/analyze`
   with a 100 ms debounce.
6. Run uses the latest matching prepared build if possible; otherwise it
   analyzes immediately, then posts `/runtime/launch`.
7. Active wait snapshots from `/runtime/snapshots` update the module record.
   `LivecodeEditorShape.tsx` maps active callsite IDs through the manifest and
   passes source ranges into CodeMirror for highlighting.
8. `pianoRollRuntime.tsx` independently opens `/piano-roll/snapshots` for the
   current server URL. Server snapshots update named roll objects by revision.
9. `PianoRollShape.tsx` mounts the `piano-roll-component`, applies server notes
   into the component, and posts component edits back to `/piano-roll/set`.
10. Livecode helper code can read, mutate, and play the same named rolls through
    `piano-roll-helpers`, so piano-roll UI edits and running livecode share one
    server-owned object.

## File Index

### Tldraw App

- `src/App.tsx` owns top-level providers, the server toolbar, shape utilities,
  default shape creation, and tldraw store-to-runtime registration.
- `src/LivecodeEditorShape.tsx` defines the `livecode-editor` custom tldraw
  shape, Run/Stop controls, status rows, CodeMirror mounting, diagnostics, and
  active wait range mapping.
- `src/CodeMirrorEditor.tsx` owns the CodeMirror instance, Deno LSP extension,
  diagnostics display, editor event shielding, and active wait decorations.
- `src/PianoRollShape.tsx` defines the `piano-roll-view` shape. It is a named
  view onto a server piano-roll object. The embedded piano-roll stage is fixed
  at 640 x 320; tldraw resizing changes the outer scroll viewport, not the
  internal note grid size.
- `src/livecodeRuntime.tsx` is the React runtime store for livecode modules,
  build state, run state, prepared builds, active snapshots, health, Deno LSP,
  and server connection state.
- `src/pianoRollRuntime.tsx` is the React runtime store for named piano-roll
  objects. It consumes `/piano-roll/snapshots` and writes `/piano-roll/set`,
  `/piano-roll/undo`, and `/piano-roll/redo`.
- `src/denoLsp.ts` bridges CodeMirror LSP to the Deno server `/lsp` WebSocket.
- `src/livecodeProtocol.ts` mirrors the Deno runtime protocol types needed by
  the browser app.
- `src/pianoRollTypes.ts` mirrors the Deno piano-roll protocol types needed by
  the browser app.
- `src/defaultSource.ts` is the initial module source. It currently demonstrates
  `getPianoRollClip`, transposition, `setPianoRollClip`, `playPianoRoll`, MIDI
  playback, and live wait highlighting.
- `src/styles.css` owns app, shape, CodeMirror, and piano-roll shape styling.
- `vite.config.ts` aliases `@avtools/piano-roll` to the generated web component
  bundle in `webcomponents/piano-roll/dist/piano-roll.js`.

### Deno Server And Helpers

- `apps/deno-notebooks/livecode/architecture.md` is the Deno-side handoff doc.
- `apps/deno-notebooks/livecode/visualizer/server.ts` exposes:
  - `GET /health`
  - `GET /lsp?session=...`
  - `POST /runtime/analyze`
  - `POST /runtime/launch`
  - `POST /runtime/stop`
  - `GET /runtime/snapshots`
  - `GET /piano-roll/snapshots`
  - `GET /piano-roll/list`
  - `POST /piano-roll/set`
  - `POST /piano-roll/undo`
  - `POST /piano-roll/redo`
- `apps/deno-notebooks/livecode/visualizer/piano_roll_store.ts` is the
  server-owned named piano-roll object store. It seeds `melody`, normalizes
  notes, tracks revisions, and keeps per-object undo/redo history.
- `apps/deno-notebooks/livecode/helpers/piano_roll_helpers.ts` is the livecode
  API for the same store. It converts between piano-roll data and `AbletonClip`,
  exposes `getPianoRollClip` / `setPianoRollClip`, and `playPianoRoll`.
- `apps/deno-notebooks/livecode/helpers/midi_helpers.ts` manages MIDI outputs
  used by `playPianoRoll`. Output selection uses an explicit option,
  `LIVECODE_MIDI_OUTPUT`, `IAC Driver Bus 1`, then the first available output.

### Embedded Piano Roll

- Source lives in `apps/browser-projections/src/pianoRoll`.
- The custom element entrypoint is
  `apps/browser-projections/src/pianoRoll/web-component.ts`.
- The tldraw app imports the generated bundle
  `webcomponents/piano-roll/dist/piano-roll.js`; this directory is ignored by
  git but must be rebuilt locally after source edits.
- The internal scrollbar drag controllers live in
  `apps/browser-projections/src/pianoRoll/pianoRollScrollbars.ts`. They use
  pointer capture plus capture-phase `window` listeners so scrollbar drags keep
  working even when an embedding wrapper stops bubbling pointer events for
  tldraw.

## Event Boundaries

Interactive content inside tldraw shapes must shield the canvas from starting
shape drag/selection gestures.

- CodeMirror stops pointer and keyboard events inside `CodeMirrorEditor.tsx`.
- `LivecodeEditorShape.tsx` stops pointerdown on Run/Stop and footer controls.
- `PianoRollShape.tsx` stops pointer events in the piano-roll body to protect
  tldraw. Because of that, any embedded widget that tracks drags through global
  bubbling listeners should use pointer capture or capture-phase listeners.
- The piano-roll shape header remains outside the stopped body so the shape can
  be dragged through the normal tldraw interaction model.

## Verification Commands

From `apps/livecode-tldraw`:

```sh
npm run type-check
npm run build
```

After changing the piano-roll Vue source:

```sh
cd apps/browser-projections
npm run buildPianoRoll
```

If Vite fails with `node:fs/promises` export errors, run with Node 20+ / Node
22. Existing local sessions have used:

```sh
export PATH=/Users/avneeshsarwate/.nvm/versions/node/v22.20.0/bin:$PATH
```

From `apps/deno-notebooks`:

```sh
deno task test:livecode:unit
deno task test:livecode:server
deno task test:livecode:e2e
```

Known broad-check caveat: `npm run type-check` in `apps/browser-projections`
currently reports unrelated repo-wide TypeScript errors. Prefer the focused
`apps/livecode-tldraw` type-check, `buildPianoRoll`, and the livecode Deno test
tasks unless intentionally fixing the broader app.

## Current Defaults

The first created livecode module imports:

```ts
import { getPianoRollClip, playPianoRoll, setPianoRollClip } from "piano-roll-helpers";
```

It reads the `melody` roll, randomly transposes the phrase up or down five
semitones, writes the transposed phrase back into the server store, plays it
over MIDI, and waits briefly between iterations. This is intended to show both
the ergonomic named piano-roll API and realtime callsite highlighting.

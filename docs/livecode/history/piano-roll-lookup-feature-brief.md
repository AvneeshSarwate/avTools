# Feature: Piano-roll lookup decorations in tldraw code modules

> Historical feature brief. This is preserved for rationale, not as a current
> implementation contract. Start at `docs/livecode/README.md`.

This is context for a code review session. The description below is what was
asked of the implementing agent. The agent's job was to implement the feature
across both the tldraw frontend (`apps/livecode-tldraw`) and the Deno
backend/runtime (`apps/deno-notebooks/livecode`), plus add tests. The reviewer
should evaluate the implementation against this intent and the project's
existing conventions.

## Background / project shape

The project has two halves that share a server-owned piano-roll store:

- `apps/livecode-tldraw` — a local-only React + tldraw client. Code modules are
  `livecode-editor` tldraw shapes embedding a CodeMirror editor. Piano rolls are
  `piano-roll-view` tldraw shapes that are named views onto server-owned
  piano-roll objects. Start with `apps/livecode-tldraw/architecture.md`.
- `apps/deno-notebooks/livecode` — the Deno server/runtime. It owns analysis
  (ts-morph transform), generated module files, dynamic execution, the Deno LSP
  bridge, active-wait snapshots, and the shared piano-roll store. Start with
  `apps/deno-notebooks/livecode/architecture.md`.

The existing visualization convention (the one this feature should follow) is
the **wait-callsite instrumentation** pipeline:

1. `analyze_transform.ts` parses user source with **ts-morph**, finds supported
   awaited callsites, and rewrites them with `magic-string`, wrapping each call
   in `visualizedAwait(moduleId, callsiteId, promise)`. It emits a manifest with
   stable callsite IDs + source ranges.
2. `runtime.ts` is a singleton store that tracks active wait counts by
   `moduleId` + callsiteId and produces `ActiveWaitSnapshot`s.
3. The server broadcasts snapshots over the `/runtime/snapshots` WebSocket.
4. The frontend maps snapshot active IDs through the manifest and renders
   CodeMirror decorations (line + mark) for active waits.

Piano-roll store access from livecode happens through helpers in
`apps/deno-notebooks/livecode/helpers/piano_roll_helpers.ts`
(`getPianoRollClip`, `setPianoRollClip`, and lower-level `getPianoRoll` /
`setPianoRoll`), which read/write the server-owned named piano-roll store in
`visualizer/piano_roll_store.ts`.

## The feature requested

When a tldraw code module accesses a piano roll from the store (e.g. calls
`getPianoRollClip(...)` / `setPianoRollClip(...)` from `piano-roll-helpers`),
there should be a decorator shown inline in CodeMirror that exposes a button.
Clicking the button opens (or focuses) a `piano-roll-view` tldraw shape for
that specific piano roll next to the code module.

### Key requirement: follow the existing instrumentation convention

This must NOT be a regex/source-text scan in the editor. It should follow the
same convention as wait-callsite visualization:

- **Parse with ts-morph** in `analyze_transform.ts` to detect piano-roll store
  access calls (type-safely, using the import graph — only genuine imports from
  `piano-roll-helpers` / the store module should be instrumented, not
  same-named helpers from unrelated modules).
- **Instrument the call** so the runtime can track what roll name was actually
  looked up at runtime. The natural design wraps the roll-name *argument* in a
  transparent pass-through (analogous to `visualizedAwait`) that records the
  resolved name and returns it unchanged, so the call behaves identically.
- **Track at runtime** in `runtime.ts` (a per-moduleId, per-callsiteId map of
  resolved roll names), and include it in the active-wait snapshot.
- **Send to the frontend** via the existing `/runtime/snapshots` WebSocket
  (extend the snapshot shape).
- **Map through the manifest** in the editor: each instrumented callsite has a
  manifest entry with a source range (for the call) and a name-argument range
  (so the widget can be placed after the argument). Use the runtime-resolved
  name when available; fall back to a static literal name (when the argument is
  a string literal) before the module runs.

The point is that the button should show **accurate runtime data** — the actual
roll name the code looked up — not a guess from reading source text. This
matters because the default source uses an identifier (`const melodyName =
"melody"; getPianoRollClip(melodyName)`), so a source-text scan can't reliably
know the name, but runtime instrumentation can.

### Frontend behavior

- The CodeMirror decoration is a small inline button (e.g. `🎹 open <name>`)
  placed after the roll-name argument of the instrumented call.
- Clicking it focuses an existing `piano-roll-view` shape for that roll name if
  one exists, or creates one next to the code module and zooms the canvas to it.
- Before the module has run (no runtime data yet), show the static literal name
  as a fallback (the user/agent asked for this to be visually distinguishable so
  it's clear the name hasn't been confirmed at runtime yet).
- The decoration must shield tldraw from starting drag/selection gestures
  (stop pointer events), consistent with how other interactive content inside
  tldraw shapes behaves (see "Event Boundaries" in the frontend architecture
  doc).

## Tests requested

- The reviewer should confirm the feature is tested. The agent was asked to add
  both unit tests (ts-morph transform + runtime store, in the Deno test suite)
  and an end-to-end Playwright test for the tldraw app (there was already an
  analogous Playwright e2e for the Vue livecode visualizer at
  `apps/browser-projections/tests/livecodeVisualizer.e2e.mjs` to model from).
  Playwright is available in the repo (installed at the repo root and in
  `apps/browser-projections`).
- The tldraw app had no debug/test hooks before; the agent was expected to add
  a `window.__livecodeTldrawRuntimeDebug`-style debug API (mirroring the Vue
  app's `window.__livecodeVisualizerDebug`) so the e2e test can drive the page.

## Review focus

The reviewer should check, at minimum:

- The ts-morph instrumentation is type-safe (import-graph-restricted) and
  produces a correct manifest (callsite kind, `nameArgRange`, `staticName`).
- The runtime wrapper is a transparent pass-through (records name, returns
  unchanged) and the snapshot correctly carries the resolved names.
- Snapshot broadcast logic accounts for the new data (so a lookup change
  triggers a broadcast even when no wait is active).
- The lifecycle of the runtime lookup map is sensible: cleared when source
  changes/stale (new analyze produces new callsite IDs) but ideally persists
  after a module *completes* (so the button keeps showing the resolved name).
- The frontend maps manifest + runtime data correctly and renders the widget at
  the right offset, with the static-name fallback and runtime-resolution
  distinction.
- The open-button callback focuses-or-creates the `piano-roll-view` shape and
  shields tldraw from stray pointer gestures.
- Tests cover the transform, the runtime store/snapshot, and the end-to-end
  browser flow (manifest → static widget → runtime-resolved widget → open
  creates shape → open focuses existing shape).

## Verification commands

Backend (from `apps/deno-notebooks`):

```sh
deno task test:livecode:unit
deno task test:livecode:server
```

Frontend (from `apps/livecode-tldraw`):

```sh
npm run type-check
npm run build
npm run test:e2e   # requires playwright resolvable via NODE_PATH
```

Node 20+ is required for the Playwright/Vite path.

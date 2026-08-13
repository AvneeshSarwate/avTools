# Canvas params implementation plan (2026-08)

Status: active implementation plan, written after the owner design-sparring
session distilled into `docs/livecode/user-level-project-goals.md` and the
2026-08 additions to `docs/livecode/principles/principles.md`. When the work is
complete this file remains as history; current behavior must be documented in
`docs/livecode/current/` per the maintenance contract.

## Goal

A user module declares a clean parameter object in one call; a tweakpane-based
tldraw shape edits and monitors it live. This is item 3 of the owner's
six-item sequence (rolls-from-GUI, store serialization, **params**, playhead,
automation viz, signal scope) pulled forward as the first vertical slice
because its API design is fully settled. It is deliberately the **second
entity type** in the system, so it introduces the minimal generic entity-store
seam that `stability-review-2026-07.md` ("Unified entity store... generalize
`piano_roll_store.ts` to `(type, id)`-keyed entities") already calls for.

User-facing API (settled with owner; do not redesign):

```ts
import { canvasParams } from "canvas-params";

export const params = canvasParams("kinaree/rects", {
  launchRate: 10.5,
  travelSpeed: 1170,
  color: "#e14a3a",
  strobe: { rate: 0, widthPercent: 10, jitter: 0 },
}, {
  launchRate: { min: 0, max: 20, step: 0.1, label: "Launch Rate (Hz)" },
});

// elsewhere in the module, at any rate:
const r = params.launchRate;   // plain property read
params.launchRate = 2;         // plain property write
```

Settled design rulings this plan implements (from the owner conversation):

1. Code (e.g. a fast LFO) writes the durable param entity **directly**; there
   is no base/modulation split and no ephemeral sidecar. The UI is a conflated
   monitor of real state, updating slower than writes.
2. Plain objects, **no Proxy**: reads/writes are unwrapped property access.
   Change detection is sampling (serialize-and-compare), matching the existing
   `/runtime/snapshots` gate, not mutation trapping.
3. The helper is the wiring; the analyzer only observes/enriches. No
   type-annotation-triggered codegen.
4. Explicit string names are the identity tokens (survive relaunch/refactor).
5. No params undo in v1. Undo records operator actions only, never code
   writes; wiring GUI-edit undo through a generic action layer is deferred.
6. Disk serialization of entities is item 2 of the sequence, **not this
   slice**. Params are in-memory, like piano rolls today.

## Phase 0 — prep

- Add `tweakpane@^4.0.5` as a direct dependency of `apps/livecode-tldraw`.
  Rationale: the existing `@avtools/tweakpane-client` webcomponent is a
  WS-bridge client for the Deno window manager (different use case), and the
  piano-roll experience shows unbuilt `webcomponents/*/dist` bundles are a
  first-run hazard. A plain npm dep avoids a build step and suits a pane that
  is pure browser UI.
- Add to root `deno.json` imports: `"canvas-params":
  "./apps/deno-notebooks/livecode/helpers/canvas_params.ts"` (pattern:
  existing `"piano-roll-helpers"` alias).

## Phase 1 — server: generic entity store with params as first type

New file `apps/deno-notebooks/livecode/visualizer/entity_store.ts`:

- `(type, name)`-keyed records: `{ type, name, rev, value, meta?, updatedAt,
  updatedBy }`. Follow `piano_roll_store.ts` discipline exactly: normalize
  names (non-empty, trimmed), rev starts at 1, `expectedRev` CAS returning
  `conflict: true`, no-op detection via cached `lastValueJson` string compare,
  never-throw writes (safe stringify/clone fallbacks) because writes run
  inside caller-owned livecode timing, snapshot `seq` counter.
- No undo stacks in the generic layer (v1). `piano_roll_store.ts` is NOT
  migrated in this slice; it stays untouched and its later migration onto
  this layer is noted in "Deferred" below.
- Params type registration lives in
  `apps/deno-notebooks/livecode/visualizer/params_store.ts` (thin wrapper over
  `entity_store.ts`): `registerParams(name, defaults, meta?)` implementing
  create-or-reattach:
  - absent → create with structured-cloned defaults; store the **live value
    object** and return that same object (object identity is the contract:
    code mutates it; HTTP actions mutate it in place too, so running code
    observes GUI edits immediately).
  - present → reconcile: keep existing values for fields present in the new
    defaults shape, add new fields at defaults, drop removed fields; replace
    `meta` from the declaration (declaration wins); return the existing live
    object so prior module instances keep working. Bump rev when the
    reconcile changed anything.
  - Validate JSON-simple values (finite numbers, strings, booleans, plain
    nested objects). Reject functions/class instances/BigInt at registration
    with a thrown error naming the field (registration runs at module init,
    not inside timing loops, so throwing is acceptable there and only there).

Server wiring in `visualizer/server.ts` (mirror the piano-roll block at
549-589 and the socket set at 221):

- `GET /params/list` → forced `ParamsSnapshot`.
- `POST /params/set` → body `SetParamsRequest { name, values (full or
  partial by key), originId?, expectedRev? }`; writes into the live object
  in place, bumps rev, returns `ParamsEntity` (or `conflict: true`).
- `WS /params/snapshots` → on open, send forced snapshot; broadcast loop
  below.
- Broadcast: a 100 ms interval (pattern of `pianoRollSnapshotTimer`,
  server.ts:347-360) that builds the snapshot, `JSON.stringify`s it, and
  broadcasts only when the string differs from the last sent (pattern of the
  `/runtime/snapshots` `lastSnapshotJson` gate). This is what makes plain
  unflagged code writes visible with zero cost at the write site: sampling,
  not notification. Params objects are small; serialize-compare at 10 Hz is
  negligible. Include timer in the shutdown path next to the existing timers.

Deno unit tests (`apps/deno-notebooks/livecode/tests/params_store_test.ts`):
create/reattach/reconcile semantics, CAS conflict, no-op detection, live
object identity across re-registration, JSON-simple validation errors.

## Phase 2 — helper: `canvas_params.ts`

New file `apps/deno-notebooks/livecode/helpers/canvas_params.ts`:

- `canvasParams<T extends ParamsValues>(name: string, defaults: T, meta?:
  ParamsMeta<T>): T` — delegates to `registerParams`, returns the live object
  typed as `T`. Full type inference; `ParamsMeta` fields optional per key
  (`min/max/step/label` v1; tweakpane infers control kinds from value types,
  so metadata is refinement only).
- Runs headlessly by construction: the store is in-process; with no client
  attached nothing samples beyond the (cheap, gated) interval, and with no
  server at all (plain `deno run` of a module) the helper still works because
  `entity_store.ts` is a plain module with no server dependency.

## Phase 3 — protocol mirror (both copies, by hand, same change)

Server `visualizer/protocol.ts` and client additions:

- `ParamsValues` (JSON-simple record, nested), `ParamsFieldMeta`,
  `ParamsMeta`, `ParamsEntity { name, rev, values, meta?, updatedAt,
  updatedBy }`, `ParamsSnapshot { type: "paramsSnapshot", seq, timestampMs,
  params: Record<string, ParamsEntity> }`, `SetParamsRequest`.
- Client mirror in new `apps/livecode-tldraw/src/paramsTypes.ts` (pattern:
  `pianoRollTypes.ts`).
- Extend `ProjectCanvasState` in BOTH `visualizer/protocol.ts:165-183` and
  `src/livecodeProtocol.ts:127-145` with optional `paramPaneViews?:
  Array<{ id, paramsName, x, y, w, h }>`. Additive and optional — no manifest
  version bump.

## Phase 4 — client: params runtime + pane shape

- `apps/livecode-tldraw/src/paramsRuntime.tsx`: provider cloned from the
  `pianoRollRuntime.tsx` pattern (reconnecting socket to `/params/snapshots`,
  RAF-coalesced snapshot apply, `postJson` actions `setParams`). Extract the
  duplicated `postJson`/ws-url helpers shared with `pianoRollRuntime.tsx`
  into a small shared module rather than adding a third copy (sanctioned
  refactor; keep the piano-roll provider's behavior identical).
- `apps/livecode-tldraw/src/ParamPaneShape.tsx`: `param-pane` shape,
  `BaseBoxShapeUtil`, props `{ w, h, paramsName, title }` with the same
  module-augmentation pattern as `PianoRollShape.tsx:13-24`. Component:
  - mounts a tweakpane `Pane` into a container div; builds bindings from the
    entity's `values` + `meta` (nested objects → folders, the hanoiShow
    visual convention); rebuilds bindings when the value **shape** or meta
    changes (compare key sets), refreshes binding values on rev change.
  - edits → debounce-light `POST /params/set` with `originId =
    "param-pane-" + shape.id`; apply snapshots with the exact echo-suppression
    scheme from `PianoRollShape.tsx:102-127` (`updatedBy === originId` skip,
    `lastAppliedRevRef`, rev-1 initial case).
  - entity absent → placeholder listing available names from the latest
    snapshot ("waiting for `name`") — creating a pane never creates an
    entity (observed state is not an instruction; entities are declared by
    code in this slice).
  - pointer/wheel event shielding as in the piano-roll and editor shapes.
- Register in `App.tsx:48` `shapeUtils`; mount `ParamsRuntimeProvider` next
  to `PianoRollRuntimeProvider` (App.tsx:296).
- Creation UX: TopBar button "New params pane" (next to "New module",
  App.tsx:360-368 area): prompts for/offers known entity names from the
  latest params snapshot, free-text allowed, then creates the shape at a
  sensible offset (pattern: `createPianoRollShape`, App.tsx:1065-1089).

## Phase 5 — layout persistence

- Generalize `schedulePianoRollCanvasUpdate` (App.tsx:120-147) into one
  `scheduleCanvasViewsUpdate` that collects BOTH `piano-roll-view` and
  `param-pane` shapes and posts a complete
  `{ canvas: { pianoRollViews, paramPaneViews } }` — required because the
  server replaces the whole canvas object (server.ts:539-547, documented in
  known-risks). Extend the store-listener change detection (App.tsx:172-233,
  847-856) to param-pane shapes.
- Project load (App.tsx:1007-1020 pattern): create param panes from
  `manifest.canvas.paramPaneViews`, reusing persisted ids.
- Piano-roll-view persistence behavior must remain byte-identical for
  existing manifests (no `canvas` key → nothing posted until a view exists).

## Phase 6 — analyzer enrichment (after the slice works end to end)

Pattern: the piano-roll detection tables and flow in
`analyze_transform.ts:39-56, 344, 430-479`.

- Add `canvasParams` to a new detection table keyed on the `"canvas-params"`
  import alias / path suffix; detect callsites inside `TimeContext` scopes
  AND at module top level (params are typically declared at module scope —
  this differs from piano-roll detection's scope rule and needs its own
  collection pass over top-level statements).
- Emit manifest entries `kind: "canvasParams"` with `staticName` when the
  first argument is a string literal (pattern: `extractStaticRollName`).
- Client: gutter widget "🎛 open <name>" mirroring the piano-roll open button
  (`CodeMirrorEditor.tsx:76-135`, `LivecodeEditorShape.tsx:117-172`), which
  focuses an existing pane for that name or creates one.
- NOT in this slice: analysis-time schema materialization into the store
  (pre-launch pane rendering). Deferred to the serialization item (sequence
  item 2), where schema-on-disk makes it coherent. Record this gap in the
  current docs when writing them.

## Phase 7 — tests and documentation

- E2E (extend `apps/livecode-tldraw/tests/livecodeTldraw.e2e.mjs` patterns):
  1. module source declaring `canvasParams("e2e/params", { gain: 0.5 })`;
     launch; create pane bound to `e2e/params`; assert bindings render.
  2. GUI → code: drive the tweakpane input DOM, assert `/params/list` shows
     the new value and bumped rev.
  3. Code → GUI: module loop writes a param each beat; assert the pane
     readout changes without any client action (conflated monitor path).
  4. Reload the page mid-run; assert pane rehydrates from snapshot (server
     truth) with no duplicate entities.
- Server tests: phase 1 list above, plus route-level set/CAS/list smoke
  (pattern: `protocol_smoke_test.ts`).
- Documentation (maintenance contract): `current/protocol.md` (+ routes,
  + wire types), `current/server.md` (store, timer, routes),
  `current/client.md` (provider, shape, TopBar, persistence),
  `current/project-model.md` (canvas.paramPaneViews),
  `current/system-architecture.md` (state-ownership table row),
  `current/known-risks.md` (canvas whole-replace note now covers two arrays;
  add "params meta trusts declaration" note). Update
  `history/README.md` link list with this plan.

## Deferred / explicitly out of scope

- Disk serialization of entities (sequence item 2) — includes analysis-time
  schema materialization and self-describing pre-launch panes.
- GUI creation of param *entities* (sequence item 1 generalizes creation).
- Params undo; macro/MIDI mapping layers; per-field write provenance.
- Piano-roll store migration onto `entity_store.ts`, and the wait-decoration
  refactor onto the generic monitor tier: earmarked for the ephemeral-signals
  slice (sequence item 4), where the ephemeral class actually gets built.
  Sanctioned by the owner; do not force into this slice.
- Multiplexed single-socket transport: `/params/snapshots` is deliberately
  another socket for now; unification is the transport item in
  principles/README "preferred direction of travel".

## Risks and mitigations

- **Hand-mirrored protocol drift**: every phase-3 type lands in both files in
  the same commit; e2e test 2 exercises the wire shape.
- **Multiple modules declaring the same params name**: legal (reattach
  semantics); last declaration's schema wins; surfaced as a warning-tier
  finding only when the analyzer phase lands. Documented in current docs.
- **tweakpane binding rebuild churn**: rebuild only on key-set/meta change,
  not on every rev; refresh values otherwise. E2E test 3 guards glanceable
  monitoring.
- **Whole-canvas replace**: mitigated by always posting both arrays from one
  collector; the underlying server behavior is unchanged and stays on the
  known-risks list.
- **Live-object identity across relaunch**: reattach returns the same object;
  a stopped module's stale reference keeps pointing at live truth (accepted;
  consistent with current shared-state reality and the no-orchestrated-order
  principle's last-value reads).

# Ephemeral signals plan: playheads, param graphs, scopes (2026-08)

Status: active implementation plan for items 4-6 of the owner's six-item
sequence (playhead visualization; parameter automation visualization; signal
history scopes), following the entity-CRUD/persistence slice. When complete,
this file remains history; `docs/livecode/current/` documents what shipped.

## Goal

Build the **ephemeral signal tier** the principles already specify — named
ephemeral entities that exist to be watched — and its first three consumers:

4. **Playheads**: a module publishes a position signal anchored to a piano
   roll; the roll view renders it as a moving marker. Multiple modules
   publishing against one melody render as multiple markers.
5. **Param automation display**: per-field time-series graphs on the param
   pane, opted in from the declaration (`meta.graph`), fed by the existing
   conflated monitor path. (The pane already follows code writes; this adds
   the history view.)
6. **Signal scopes**: a free-standing `signal-scope` shape that binds
   explicitly to any signal — or to a durable param field — and draws its
   recent history from client-side accumulation.

## Principles and rulings this implements (do not re-litigate)

- **Ephemeral entities exist to be watched, not to run the piece**: code
  never reads another module's signals; a headless run is complete without
  them; publishing costs a field assignment plus a dirty flag (unwatched ≡
  watched); never persisted or undoable; they **end with the run that
  published them** rather than silently freezing.
- **Signals, not events**: latest-value samples with user-defined shapes; no
  platform event tier; occurrence lists and display-honest decimation are
  piece logic (helper idioms, documented not built).
- **Anchors**: entity-reference (with optional path), source-range
  (injected), or explicit view binding. Producers never know about views.
- **Playhead rulings**: a playing instance is a user-shaped ephemeral entity
  *referencing* a melody (reference, not clone); all meaning — motion,
  crossing detection, triggering — lives in process code; sampled values at
  ship rate are the default (motion specs remain opt-in, unbuilt); semantic
  rate ≠ viz rate.
- **Item-5 ruling**: automation writes the durable param directly; there is
  no ephemeral automation sidecar. Item 5 is therefore purely display work
  over already-shipping samples.
- **Monitors watch values regardless of class**: a scope bound to an
  ephemeral signal and one bound to a durable param field are the same
  mechanism; class governs persistence, not watchability.

## Design decisions (with rationale, grounded in the sweep)

- **Signals are entity type `"signal"` on `entity_store.ts`, deliberately
  NOT registered in the durable registry** — which makes them invisible to
  `/project/save`, `/project/status` data rows, project open, and
  `/entities/*` by construction (verified: those all iterate
  `listDurableEntityTypes()`). The ephemeral class costs zero new
  machinery.
- **Publishing is helper-mediated, so no drift adoption is needed.** New
  helper package `canvas-signals`
  (`apps/deno-notebooks/livecode/helpers/canvas_signals.ts`, alias in both
  `deno.json` files): `signal<T>(name, opts?: { anchor? }) → { set(v),
  end(), name }`. `set` assigns the record value and marks the type dirty —
  nothing else; the 100 ms sampler (params-pattern: changed-only via
  `lastValueJson` compare, rev bump `updatedBy: "code"`, `unserializable`
  flag) does the serialization. `end()` marks the record `ended` and dirty.
  Anchor shape: `{ type: string, name: string, path?: string[] }` — an
  entity reference; path included now so a signal can target a param field,
  even though item 5 does not need it.
- **Ownership via the analyzer's existing edit path.** The transform detects
  `signal(...)` callsites (import alias `canvas-signals`; whole-file pass,
  `canvasParams` template) and wraps the whole call —
  `__tcvOwnedSignal(<moduleId>, <callsiteId>, signal(...))` — where the
  runtime helper stamps the returned handle's record with the owning
  module. This is observation-grade (attributes, never changes what the
  code computes), works at any callsite depth including inside loops, and
  degrades cleanly: an untransformed headless run produces unowned signals
  that simply never auto-end. Manifest kind `"canvasSignal"` (union extended
  in BOTH protocol copies) with `staticName` for literal names; non-literal
  names get no gutter affordance (precedent).
- **End-with-run wiring**: `endSignalsForModule(moduleId)` called from the
  two existing cleanup sites — the launch branch's `finally` and
  `teardownActiveModule` — the same places `clearModuleWaits` runs, so
  graceful stop, panic, and self-termination all end owned signals. Ended
  signals stay listed (dimmed client-side) until their name is redeclared
  (which clears `ended` and re-owns) or the server restarts. NOTE the
  pre-existing asymmetry discovered in the sweep: piano-roll lookups are
  cleared only on re-analyze, never on stop — documented accepted behavior;
  signals do better because the principle demands it, and we leave lookups
  alone.
- **Root-clock accessor (small, load-bearing addition).** `runtime.ts` gains
  a module-level `setRootTimeContext(ctx)` / `sampleRootTime(): { timeSec,
  beats } | null`; the server's parent-loop launch (server.ts:296-313)
  registers its ctx. The signals sampler stamps each changed record with
  `timeSec`/`beats` at adoption. This is the cheapest honest fulfillment of
  the "stamped with sequence and logical time" contract and gives scopes a
  musical x-axis later; if the ctx is somehow unset, stamps are omitted.
- **Transport**: `GET /signals/list`, `WS /signals/snapshots`, 100 ms
  changed-only sampler timer, socket set closed in `close()` — byte-for-byte
  the params wiring pattern. **There is no set route: signals are
  code-published only.** Subscription scoping stays deferred to the
  multiplexed-transport direction (ship-all changed-only is within
  good-enough at personal scale; noted in docs).
- **Playhead rendering uses the component's existing playhead, extended to
  many.** The sweep found `setLivePlayheadPosition(position /* quarter
  notes */)` already on the element with an internal rendered line. Primary
  path: extend the Vue component with an additive
  `setPlayheadMarkers(markers: Array<{ id: string; position: number;
  color?: string }>)` rendering N labeled lines (keep the existing
  single-playhead method untouched for compatibility), rebuild via
  `npm run buildPianoRoll`, commit the dist (it is committed today).
  **Fallback license**: if the Konva/Vue internals resist N markers within
  reasonable effort, ship v1 with the existing single playhead — the
  roll view then renders the anchored signal with the lexicographically
  first name and the docs say so — and record the N-marker extension as the
  known gap. The e2e's two-markers case is written against the primary path
  and downgraded with the fallback.
- **Marker semantics in the shape**: `PianoRollShape` subscribes to the
  signals provider, filters signals anchored `{ type: "pianoRoll", name:
  rollName }` whose value contains a numeric `position` (quarter notes —
  the component's unit; the shape reads `value.position` if the value is an
  object, or the value itself if it is a number), and pushes markers on each
  RAF-coalesced snapshot. Ended signals drop their marker (or render
  dimmed if the component supports per-marker style cheaply). Meaning stays
  in the process: the platform never knows why a position moves.
- **Param graphs (`meta.graph`)**: `ParamsFieldMeta` gains `graph?: boolean`
  (+ optional `rows?: number`) in both protocol copies and `sanitizeMeta`.
  For a numeric leaf with `graph: true`, the pane adds a SECOND, readonly
  binding on the same draft key with `{ readonly: true, view: "graph",
  min, max, rows }` — tweakpane v4 core supports this (verified:
  `shouldShowGraph`, buffer default 64, interval default 200 ms). Graph
  bounds come from the field's `min`/`max` meta; a graph without declared
  bounds falls back to tweakpane's 0..100 and the docs say to declare
  bounds. Monitor bindings poll the draft on their own interval, so the
  existing apply/refresh path needs no change; the busy-guard applies only
  to the editable binding.
- **Scope shape** `signal-scope`, props `{ w, h, sourceType: "signal" |
  "params", name, path, windowSec, title }` (`path` a dot-joined field path
  for params; empty for whole-value numeric signals). Client-side ring
  buffer of `{ t, value }` accumulated from the relevant provider's
  RAF-coalesced snapshots (view-side accumulation over shipped samples is
  the settled-legitimate approximation), rendered as a polyline on a 2D
  canvas at RAF — imperative, no React state per sample, no document-state
  writes. Numbers only in v1; a non-numeric binding renders the
  waiting/unsupported placeholder. X-axis uses sample arrival time v1
  (logical-time stamps are carried in the snapshot for later use).
  TopBar "New scope" inline input (datalist over live signal names and
  `params:name.field` paths), a debug-surface `createSignalScope`, canvas
  persistence via an additive `scopeViews` array in the manifest canvas
  (collector + restore + both protocol copies, exactly the paramPaneViews
  precedent).
- **Wait-decoration retrofit: assessed and DEFERRED, with reasons.** The
  sweep's coupling map shows wait counts ride `/runtime/snapshots` fused
  with lifecycle truth (`activeModules`, `moduleRuns`) that reconnect
  rehydration depends on, and the wait half is consumed by TWO clients
  (tldraw and `browser-projections` SketchWrapper). Migrating waits onto
  the signal tier would split lifecycle from waits across sockets for zero
  user-visible gain, against the owner's permissive "maybe." The tier now
  exists; unification belongs to the planned single multiplexed transport,
  and the plan records that explicitly in the docs update.

## Phase A — server, helper, analyzer, unit tests

- `signals_store.ts` (new, params_store as template): `SIGNAL_ENTITY_TYPE =
  "signal"`; `declareSignal(name, { anchor? })` create-or-reattach (a
  redeclared name clears `ended`, replaces anchor, keeps rev floor
  monotonic via the existing entity_store floors); `setSignalValue(record
  handle path — via the returned handle closure, not a store lookup per
  set)`; `endSignal(name)`; `assignSignalOwner(name, moduleId)`;
  `endSignalsForModule(moduleId)`; `listSignals()`; `makeSignalsSnapshot()`
  (read-only) and `sampleSignalsSnapshot()` (changed-only, rev bump,
  `unserializable` flag, logical-time stamps via `sampleRootTime()`).
- `runtime.ts`: `setRootTimeContext` / `sampleRootTime`; `__tcvOwnedSignal`
  export (stamps ownership on a handle's record; returns the handle).
- `helpers/canvas_signals.ts` + alias `"canvas-signals"` in BOTH deno.json
  files.
- `server.ts`: parent-loop registers its ctx; `/signals/list`,
  `/signals/snapshots`, sampler timer, shutdown additions;
  `endSignalsForModule` in the branch-finally and `teardownActiveModule`.
- `analyze_transform.ts`: `canvasSignal` detection tables ("canvas-signals"
  alias / `canvas_signals.ts` suffix+basename), whole-file collection pass
  (canvasParams template), whole-call wrap emission
  (`__tcvOwnedSignal(moduleId, callsiteId, <call>)` — pianoRollLookup edit
  template, participates in `hasWrappedCallsite` so the runtime import is
  emitted), manifest kind `"canvasSignal"` with `staticName`/`nameArgRange`.
- `protocol.ts`: `SignalAnchor`, `SignalEntity { name, value, anchor?,
  ownerModuleId?, ended?, rev, updatedAt, updatedBy, timeSec?, beats? }`,
  `SignalsSnapshot`, `WaitCallsiteKind` + `"canvasSignal"`,
  `ParamsFieldMeta.graph?/rows?`.
- Unit tests (`signals_store_test.ts` + analyzer additions): declare/
  reattach/redeclare-clears-ended, set-marks-dirty-without-serializing,
  sampler changed-only + rev + stamps + unserializable, end-on-module-
  teardown via `endSignalsForModule`, ownership assignment, rev floors
  across redeclare, signals invisible to save/status (registry exclusion),
  analyzer: detection at top level and in timed bodies, whole-call wrap
  text, runtime import present, shadowed-local non-detection, non-literal
  name, `canvasParams` untouched. Register the new test file in
  `test:livecode:unit`. `deno check` on all touched files; full unit task
  green.

## Phase B — component, client, E2E, docs

- Piano-roll component: `setPlayheadMarkers` per the decision above (with
  the fallback license); rebuild + commit dist; extend the typed element
  interface in `PianoRollShape.tsx`.
- Client: `signalsRuntime.tsx` provider (params template; RAF-coalesced;
  `serverRequests.serverWebSocketUrl`); `PianoRollShape` marker feed;
  `ParamPaneShape` graph rows from `meta.graph`; `SignalScopeShape` + ring
  buffer + canvas polyline; TopBar "New scope" input + datalist; debug
  `createSignalScope`; canvas persistence (`scopeViews` in collector,
  restore block, both protocol copies); protocol mirror of every Phase-A
  wire type (including the manifest kind union — same commit as first use).
- E2E additions (after the existing param cases, before project mode, plus
  one project-mode assertion):
  1. module declares an anchored playhead signal driven by its loop → the
     bound roll view's marker appears and its position changes; module
     stop → marker ends (removed/dimmed).
  2. two modules publish playheads on one melody → two markers (primary
     path; single-marker assertion under the fallback license, stated in
     the report).
  3. scope bound to the signal shows a moving trace (assert canvas pixels
     change or ring-buffer length via debug); scope bound to a param field
     accumulates while a module writes the param.
  4. `meta.graph` field renders a graph row (DOM presence).
  5. project-mode: after save, `data/` contains NO signal files and the
     manifest `data` list has no `"signal"` entries.
  6. every existing case passes unchanged.
- Docs (maintenance contract, each doc's own register): protocol.md
  (signals contract: routes, snapshot, no-set-route, stamps), server.md
  (signals store/sampler/lifecycle-clearing, root-clock registration),
  client.md (signals provider, markers, scope shape, graph rows, TopBar,
  debug), analyzer-and-generated-code.md (`canvasSignal` wrap, ownership,
  non-literal limitation), system-architecture.md (ephemeral state-ownership
  row: signals are process-runtime truth, recoverable only as current
  values on reconnect, never persisted), known-risks.md (ship-all
  transport noted against the multiplexed direction; ended-signal retention
  until redeclare/restart joins the long-process P2 list; wait-retrofit
  deferral rationale recorded), project-model.md (signals excluded from
  `data/` by construction), testing-and-operations.md (new unit file, e2e
  coverage). `history/README.md` links this plan.

## Deferred / explicitly out of scope

- Wait-decoration migration onto the signal tier (deferred with reasons
  above; lands with the multiplexed transport).
- Subscription-scoped signal transport; motion-spec opt-in; non-numeric
  scope rendering; per-marker styling beyond the cheap path; note-flash /
  region annotation kinds (the seq+recent helper idiom is documented, not
  built); logical-time x-axes in scopes (stamps are shipped, unused v1).
- Any cross-module code reads of signals (forbidden by principle).

## Risks

- **Component extension touches the engineered base component**: additive
  method, existing single-playhead path untouched, dist rebuild is
  committed like today; fallback license bounds the risk. The roll's
  note-editing e2e cases guard regressions.
- **Signal name collisions across modules**: legal (create-or-reattach);
  last declarer owns; surfaced later by topology findings, not prevented.
- **High-rate `set` with alternating values** defeats changed-only gating
  at 10 Hz ship — bounded by the 100 ms tick to ≤10 messages/s per
  socket; acceptable, noted.
- **Ended-signal accumulation** over a long session: bounded by distinct
  names; joins the documented long-process P2 list.
- **Graph rows double the pane's binding count** for opted-in fields;
  tweakpane polls at 200 ms per monitor — negligible at param-pane scale.

# Entity CRUD and project persistence plan (2026-08)

Status: active implementation plan for items 1-2 of the owner's six-item
sequence (GUI entity creation; store serialization in project save), following
the completed canvas-params slice (`canvas-params-plan-2026-08.md`). When the
work is complete this file remains as history; current behavior must be
documented in `docs/livecode/current/` per the maintenance contract.

## Goal

Two user-facing capabilities and the seam they force:

1. **Create, duplicate, and delete durable entities from the GUI** (piano
   rolls first, params too), through generic serialized actions — the cheap
   entity gestures the variations-in-the-medium principle requires.
2. **Durable entities persist in the project format**: explicit project save
   writes per-entity JSON files listed in the manifest; project open
   rehydrates them, so "opening the piece tomorrow" restores the GUI-authored
   half, and params panes render from saved schema before any module runs.

The seam: a **durable-entity registry facade** giving both existing storage
engines (`piano_roll_store.ts`, `entity_store.ts`/`params_store.ts`) one
interface for list/create/duplicate/remove/serialize/deserialize. The
piano-roll engine is NOT migrated onto `entity_store.ts` in this slice — the
facade removes interface divergence without rewriting a proven engine that
carries undo, CAS, and E2E coverage. Full storage unification stays earmarked.

## Owner rulings this plan implements (from the design-sparring sessions)

1. **Explicit save, not write-through, for entity data.** "Save/save-as like
   any normal app"; "save captures instantaneous values; you control when."
   Save is an explicit operator action (severity taxonomy: explicit-consent);
   code writes at any rate never touch disk. Richer take/forking patterns
   remain deliberately deferred.
2. **Per-entity human-readable JSON files**, listed in the manifest like
   modules, in a project `data/` tree.
3. **Duplicate-entity is the variations gesture** and must be generic.
   Entity rename is DEFERRED (duplicate covers the creative flow; rename's
   code-reference orphaning deserves its own moment).
4. **Create entity + first view is one composite GUI gesture**; deleting a
   view never deletes the entity (shapes are views); deleting an entity is a
   separate, confirmed, explicit action.
5. **Undo history is never serialized.** Loads write with `undoable: false`.
6. **Saved params include `meta`**, so a freshly opened project renders
   correct panes with no module running — the deferred analysis-time schema
   materialization partially arrives via persistence instead; the
   `canvasParams` declaration still wins on next launch via the existing
   reconcile.

## Design decisions (with rationale)

- **Save captures every durable entity currently in memory** (all registered
  types), replacing the manifest's `data` list with what was saved. This is
  the honest reading of "save captures instantaneous values": the
  process-global store means leftovers from a previous project or the
  auto-seeded demo `"melody"` get captured too — documented as part of the
  existing global-project hazard family (known-risks P1), not solved here.
  Deleting an entity then saving removes its manifest entry but leaves the
  old file on disk, matching the module-remove precedent ("manifest-only
  remove"), documented.
- **`POST /project/save` grows from manifest-only to manifest + data.** The
  route already exists (server.ts:496) and is the explicit-save path; the
  write-through paths (`writeProjectManifest` callers in module/canvas
  routes) are untouched and never write data files.
- **Manifest gains optional top-level `data?: ProjectDataEntry[]`** with
  `{ type, name, path }`. Top-level placement is deliberately outside
  `canvas`, which `/project/canvas` whole-replaces; unknown top-level
  manifest fields already round-trip (open keeps them; `writeProjectManifest`
  spreads them), so old manifests and old servers stay compatible.
- **Name→filename encoding**: entity names are established as
  slash-containing (`e2e/params`, `kinaree/rects`) and the stores allow any
  non-empty trimmed string. Data files live at
  `data/<type>/<encoded-name>.json` where encoding percent-encodes every
  byte outside `[a-zA-Z0-9._-]` (including `%` itself) — collision-free by
  construction, no decode needed since the manifest entry carries the true
  name. Because macOS filesystems are case-insensitive, save detects
  path collisions across the entity set case-insensitively and
  disambiguates with a numeric suffix; the manifest path is always
  authoritative.
- **A `.json` variant of the path checker**: `normalizeProjectRelativePath`
  (server.ts:2119-2137) hard-requires `.ts`; data entries get the same
  relative/inside-project/no-NUL rules requiring `.json` instead. Manifest
  `data` paths are validated on open; invalid entries are skipped with a
  logged warning (open must not fail the whole project on one bad row —
  matches the "missing/broken file" hazard posture).
- **Load hook placement**: in `openProject` immediately after
  `currentProject = state` (server.ts:974) and before materialization, so
  entities exist before any module could run; `createProject` needs no hook
  (fresh projects have no data entries).
- **Params load preserves the live-object identity contract.** If a params
  entity already exists in memory (a running module holds its value object),
  deserialization mutates that object IN PLACE (delete extra keys, assign
  loaded ones, recursively) and bumps rev with `updatedBy: "load"`; only an
  absent entity creates a new record. Piano-roll load calls
  `setPianoRoll(name, data, { undoable: false, source: "server", label:
  "Load project" })` — the roll store copies by value and helpers read by
  name, so no identity concern there.
- **Dirty tracking is informational (warning-tier).** `ProjectState` keeps a
  `savedEntityJson: Map<"type name", string>` written on save/load;
  `/project/status` gains a `data` section listing per-entity
  `{ type, name, unsaved }` where `unsaved` compares the store's cached
  latest JSON (`lastValueJson` / `lastDataJson`) against the saved JSON —
  string compares of already-maintained caches, no new serialization work at
  status time. The client shows an unsaved-count pill; nothing ever
  auto-saves.
- **Generic CRUD routes** dispatch through the registry: create rejects an
  existing name; duplicate rejects a missing source or existing target;
  delete is idempotent-ish (`ok: false` on missing). All bodies carry
  `{ type, name, ... }`; responses return the affected entity summary. These
  are ordinary serialized actions — available headlessly to agents, per the
  operational-surface principle.
- **Demo seeding is untouched.** `seedDemoPianoRoll` keeps running at server
  start and lazily; a project whose data includes `"melody"` simply
  overwrites the seed on load. The lingering-demo-roll-in-a-project-that-
  never-used-melody case joins the documented global-store caveats.

## Post-review revisions (2026-08-13)

A fresh-eyes review verified the plan's citations and stressed the seams. Its
findings are integrated below as binding spec; the phase text is adjusted
where they materially change it.

**Owner-adjacent resolution (veto point):** save excludes a *pristine* demo
roll — `seedDemoPianoRoll` stamps a distinctive origin (e.g.
`updatedBy: "demo-seed"`), and serialize returns null for a roll still at
`rev === 1` with that origin. Any real write captures it forever. Rationale:
plain-files cleanliness (no junk `melody.json` in every project ever saved)
and the accepted mental-investment pattern (auto-created artifacts decay;
user-touched ones persist). Without this, lazy re-seeding makes every saved
project permanently carry the demo seed.

Binding fixes:

1. **Delete must defeat lazy re-seeding.** `ensureDefaultPianoRoll` re-seeds
   `"melody"` on every list/get/snapshot, so a deleted default resurrects
   within 100 ms. The store keeps a per-process `deletedDefaults` set:
   an explicit `deletePianoRoll` of a default name suppresses future
   re-seeding (unit-tested).
2. **E2E project-mode cases run AFTER all existing cases**, entered via a
   fresh `page.goto` carrying both `serverBaseUrl` and `projectPath`; the
   temp project seeds at least one module (project-mode renders no default
   canvas, so the boot waits would otherwise hang); `firstModuleId` is
   re-captured after navigation. Existing cases stay on the default canvas
   and run first, unchanged.
3. **TopBar selection mechanism**: selection-scoped buttons use tldraw's
   reactive `useValue` over `editor.getOnlySelectedShape()` (TopBar already
   receives the editor); no store.listen plumbing.
4. **Unsaved pill source**: App polls `GET /project/status` on a ~2 s
   interval, only while a `projectPath` is present (same gate as the
   collector); the pill renders from the response's `data` section.
5. **Dirty tracking covers deletions**: the status `data` section iterates
   the union of live registry names and `savedEntityJson` keys; a
   saved-but-absent entity reports as an unsaved deletion.
6. **`savedEntityJson` is the store's compact cache string** (`lastValueJson`
   / `lastDataJson`), captured at serialize time on save and after apply on
   load — never the pretty-printed file bytes, so key-order and formatting
   can never produce a false permanent "unsaved".
7. **Save is point-in-time**: all entities serialize synchronously into
   memory first; the awaited file writes happen afterwards.
8. **pianoRoll serialize gets the same null-skip-and-report path as params**
   for JSON-hostile metadata (the store's `lastDataJson === ""` case) —
   a save never 500s mid-pass.
9. **Params load is reconcile-grade**: depth-wise in-place mutation that
   preserves nested object identity at every level (same discipline as
   `reconcileValues`), and the entity's tombstones are cleared on load so
   stale pre-load values can never resurrect into a re-declared field.
10. **Load clears per-roll undo/redo stacks** ("open = adopt disk truth");
    the earlier "undo stacks untouched" test wording was wrong and is
    dropped.
11. **The save UI inherits the known-risks P1 gating gap** (client-control
    opens show no save button; debug `saveProject()` covers agents/e2e) —
    documented in the known-risks update.
12. **Entity revs are monotonic per name across delete/recreate** (a rev
    floor in `entity_store`), so a recreated or re-loaded params entity can
    never be silently echo-suppressed by a pane whose `localRev` outlives it.

Plus the review's nits, all adopted: the `/params/set` 404 text loses
"entities are declared by running code"; `createPianoRollShape` moves to
`PianoRollShape.tsx` (exported, symmetric with `createParamPaneShape`); the
"New piano roll" gesture is dual-mode (existing name → view only, new name →
entity + view — which also makes the datalist correct); encoded filenames are
length-capped (~100 chars + short hash suffix when truncated); the stale
known-risks "not persisted" bullets are revised in the same change; the
`savedEntityJson` key format assumes space-free typeIds (stated); a failed
open leaving already-loaded entities behind joins the non-transactional-open
documentation; the e2e path is `apps/livecode-tldraw/tests/livecodeTldraw.e2e.mjs`.

## Phase A — server: registry, CRUD, persistence

New file `apps/deno-notebooks/livecode/visualizer/entity_registry.ts`:

```ts
interface DurableEntityTypeDescriptor {
  typeId: string;                                   // "pianoRoll" | "params"
  listNames(): string[];
  exists(name: string): boolean;
  create(name: string): void;                       // rejects existing
  duplicate(sourceName: string, targetName: string): void;
  remove(name: string): boolean;
  serialize(name: string): unknown | null;          // JSON-ready, null = skip
  deserialize(name: string, data: unknown): void;   // validate + apply
  latestJson(name: string): string | null;          // cached, for dirty check
}
```

with `registerDurableEntityType`, `getDurableEntityType`,
`listDurableEntityTypes`. Two descriptors registered at server construction:

- **pianoRoll**: delegates to `piano_roll_store.ts`. Requires two small store
  additions: `deletePianoRoll(name): boolean` (records.delete + markDirty)
  and an exported `getPianoRollDataJson(name)` or reuse of `lastDataJson`
  for `latestJson`. Also fix the pre-existing inconsistency where
  `getPianoRoll` skips `normalizeName` while set/undo/redo normalize
  (one-line fix + test; bug-shaped, sanctioned refactor).
  `create` seeds an empty roll `{ notes: [] }` with `undoable: false`;
  `duplicate` clones the source's `data`; `serialize` emits
  `{ type, name, savedAt, data }`; `deserialize` validates minimally and
  calls `setPianoRoll` as above.
- **params**: delegates to `params_store.ts`/`entity_store.ts`. Requires
  `removeParams(name): boolean` (deleteEntityRecord + tombstones.delete) and
  a `createEmptyParams(name)`/`duplicateParams(source, target)` pair
  (duplicate deep-clones values + meta; tombstones are NOT copied);
  `serialize` emits `{ type, name, savedAt, values, meta }` (skip while
  `unserializable` — return null and let save report it); `deserialize`
  runs `validateParamsValues` on the loaded values, then the in-place
  replacement described above.

Server wiring (`server.ts`):

- Routes `POST /entities/create`, `POST /entities/duplicate`,
  `POST /entities/delete` — registry-dispatched, mirroring the params route
  block's error shapes (404-style `{ ok: false, error }` on missing
  type/name).
- `POST /project/save`: after `writeProjectManifest`, iterate registry types
  × names, serialize each to `data/<type>/<encoded>.json`
  (`Deno.mkdir(recursive)` + `writeTextFile`, 2-space JSON + trailing
  newline, matching the manifest precedent), rebuild `manifest.data`,
  write the manifest again with it, record `savedEntityJson`, and return
  per-entity `{ type, name, path, ok }` plus any skipped-unserializable
  entries in the response.
- `openProject`: after `currentProject = state`, validate + load each
  `manifest.data` entry through the registry (bad entries logged and
  skipped), populate `savedEntityJson`.
- `/project/status`: add the `data` dirty section.
- Wire types added to `visualizer/protocol.ts`: `ProjectDataEntry`,
  manifest `data?`, `EntityCreateRequest/Response`, duplicate/delete
  requests, `ProjectSaveResponse` extension, status `data` section.

Unit tests (`livecode/tests/entity_registry_test.ts` + additions to
`params_store_test.ts`): registry CRUD semantics per type (create-rejects-
existing, duplicate clones without tombstones, delete idempotence), name
encoding (slashes, `%`, unicode, case-insensitive collision suffixing),
serialize/deserialize round-trips for both types (rolls preserve note
ids/velocities; params preserve values + meta), params in-place load with a
held live reference observing the loaded values, piano-roll load resetting
nothing it shouldn't (undo stacks untouched but entries unusable-by-design),
`getPianoRoll` normalization fix. Register the new test file in
`test:livecode:unit`.

## Phase B — client, E2E, docs

Protocol mirror (`src/livecodeProtocol.ts`): all Phase-A wire types, same
commit as any client use.

Client (`App.tsx`, debug surface, new UI):

- **TopBar "New piano roll"**: non-modal inline input (exact pattern of the
  params-pane input, App.tsx:437-479) with a datalist of known roll names
  from the piano-roll runtime; submit posts `/entities/create
  { type: "pianoRoll", name }` and on success runs the composite gesture —
  `createPianoRollShape(editor, { rollName: name })`. Creating a pane/view
  for an EXISTING name stays what it is today (a view, no entity action).
- **Selection-scoped entity actions**: when the single selected shape is a
  piano-roll view or param pane, the TopBar shows "Duplicate entity" (opens
  the same inline input prefilled `<name>-copy`; posts
  `/entities/duplicate`; creates an adjacent view bound to the target name)
  and "Delete entity" (two-step confirm: the button rearms to "Really
  delete <name>?" for a few seconds; posts `/entities/delete`; the view
  stays, showing its existing waiting-placeholder — view deletion remains
  the user's separate choice).
- **"Save project" button + unsaved pill**, rendered only when the page has
  a `projectPath` (same gate as the canvas collector): posts
  `/project/save`, surfaces per-entity failures; the pill shows the status
  `data` section's unsaved count and is purely informational.
- **Debug surface additions** (livecodeTldrawDebug.ts): `createEntity(type,
  name)`, `duplicateEntity(type, source, target)`, `deleteEntity(type,
  name)`, `saveProject()`, `createPianoRollView(rollName)` — E2E drives
  these, not the TopBar DOM.

E2E (extend `livecodeTldraw.e2e.mjs`; this machine runs the real harness):

1. **Project-mode boot**: create a temp project via HTTP `/project/create`
   (under the harness session root), then `page.goto` with
   `&projectPath=<root>` — the harness's first project-mode coverage.
2. **Create-from-GUI**: `createEntity("pianoRoll", "e2e/roll")` +
   `createPianoRollView`; assert the roll appears in `/piano-roll/list` and
   the view renders it.
3. **Save round-trip**: declare a params entity via module source (existing
   fixture pattern), edit the roll, `saveProject()`; from Node, assert the
   manifest `data` entries and both JSON files exist with expected content
   (encoded filenames for slash-names).
4. **Load restores saved truth**: mutate the roll and a param live, then
   POST `/project/open` for the same project; assert both entities revert
   to saved values (`/piano-roll/list`, `/params/list`), the params entity
   carries `meta`, and a fresh param pane renders bindings **without any
   module running** (the pre-launch payoff).
5. **Duplicate + delete**: `duplicateEntity` a roll, assert both live and
   both saved on next save; `deleteEntity`, assert store removal, view
   placeholder, and manifest-entry removal (file left behind) on save.
6. Existing non-project cases must pass unchanged (seeding untouched).

Docs (maintenance contract, matching each doc's register): protocol.md
(routes + wire types), server.md (registry, save/load flow, entity routes,
name encoding), client.md (TopBar additions, selection-scoped actions,
save/unsaved pill, debug surface), project-model.md (`data` section, file
layout, encoding, orphan-file-on-delete precedent, save-captures-live-store
semantics), system-architecture.md (state-ownership rows: durable entities
now recoverable from project files on open), known-risks.md (global-store
save-capture caveat + demo-melody note joining the P1 family; non-atomic
writes precedent extends to data files; case-insensitive collision handling),
testing-and-operations.md (new unit file, e2e project-mode coverage).
`history/README.md` links this plan.

## Deferred / explicitly out of scope

- Entity rename (code-reference orphaning UX deserves its own design beat).
- Save-as / granular forking / takes (owner-deferred).
- Piano-roll engine migration onto `entity_store.ts`; wait-decoration
  retrofit (ephemeral-signals slice).
- Auto-save, save-on-shutdown, eviction, undo serialization.
- GUI schema editing for params entities (created-empty params are legal but
  only useful once a declaration or future GUI editor fills them).

## Risks

- **Cross-project strays in save**: documented, accepted (global store).
- **Non-atomic writes**: matches every existing project write; a crash
  mid-save can leave partial data files; manifest written last limits the
  blast radius (entries only reference files that were written).
- **Case-insensitive filesystems**: handled by save-time collision check.
- **Old client / new server (and vice versa)**: `data` is optional and
  unknown fields round-trip; old clients simply never show save UI.
- **Load-over-live surprises**: open replaces listed entities' contents
  while modules may be running — this is the operator's explicit action
  (open = adopt disk truth), consistent with reload semantics for module
  source; documented in project-model.md.

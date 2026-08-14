# Recipe: Adding an Entity Kind

Status: written against the shape the multiplexed sync transport left behind,
checked against `packages/livecode-protocol`, `visualizer/sync_sources.ts`,
`visualizer/entity_store.ts`, `visualizer/entity_registry.ts`, and
`apps/livecode-tldraw/src/syncRuntime.tsx` on 2026-08-13.

This is the honest end-to-end list for adding a new **entity kind** — a new
named thing the server owns and clients watch. It is a recipe, not a
description: `server.md`, `client.md`, and `protocol.md` describe what exists,
and this file says what to touch and in what order.

An entity kind is worth adding when there is state with a **name**, an owner on
the server, and at least one view that wants to watch it change. If the state is
per-module rather than per-name, look at `moduleWaits`/`moduleLookups` first —
they are the module-keyed pattern and it is cheaper.

## Step 0: decide the class first

| Question | Durable | Ephemeral |
| --- | --- | --- |
| Survives a project save/open? | yes | no |
| Appears in `/entities/*` CRUD? | yes | no |
| Has undo? | maybe (rolls do, params do not) | no |
| Written by HTTP? | usually | code-published only |

**The class is expressed as one omission.** A durable type is registered in
`entity_registry.ts`; an ephemeral one is not. `/project/save`,
`/project/status`'s data rows, `/project/open`, and every `/entities/*` route
iterate `listDurableEntityTypes()`, so an unregistered type is invisible to
persistence and generic CRUD **by construction** rather than by a filter someone
has to remember to keep in sync. Do not add a filter; add or omit a descriptor.

Signals are the worked example of ephemeral; params and piano rolls of durable.

## Step 1: the wire types, in the shared package

The snippets below use `marker` / `Marker` as a stand-in kind.

Create `packages/livecode-protocol/marker.ts` with the entity interface and any
request/response bodies, then export it from `mod.ts`:

```ts
export type * from "./marker.ts";
```

Everything in the package is type-only; do not add runtime code.

Then register the kind on the transport, in `sync.ts`:

```ts
export type SyncEntityTypeId =
  | "pianoRoll" | "params" | "signal" | "run" | "moduleWaits" | "moduleLookups"
  | "marker";                    // add here

export interface SyncEntityByType {
  // ...
  marker: MarkerEntity;          // and here
}
```

Pick the wire id carefully: it is the entity type id everywhere — subscribe
messages, `resets` keys, `entityType` on a change, the `data/<type>/` directory
of a save, and the `"<type> <name>"` saved-state key. **It must not contain a
space.**

Decide the name field. Durable entities carry `name`; the module-keyed ephemeral
kinds carry `moduleId`. The client reads `entity.name ?? entity.moduleId`, so a
third convention means editing `entityName()` in `syncRuntime.tsx`.

## Step 2: server storage

### The common case: a typed wrapper over `entity_store.ts`

Copy the shape of `params_store.ts` (or `piano_roll_store.ts`, or
`signals_store.ts` — they are three variations of one pattern). The substrate
gives you identity, `rev`, per-name revision floors, the no-op cache, never-throw
serialization, and the change gate. You write the per-type semantics: validation,
declaration/reconcile, the wire projection.

Three rules the substrate enforces and your wrapper must respect:

1. **Every mutator records the name it touched.** `commitEntityWrite` does it for
   value generations; `markEntityRecordChanged` / `markEntityChanged` for changes
   that do not bump `rev` (meta replacement, a flag flip, an `unserializable`
   transition); `createEntityRecord` and `deleteEntityRecord` do it themselves. A
   change that skips this is invisible to every watcher — a serialize-compare
   cannot see a deletion or a value-free flip.
2. **Nothing throws from a path reachable inside caller-owned timing.** Throwing
   is fine at declaration and at route/registration time, and nowhere else.
3. **Read paths are read-only.** A snapshot builder must not consume the gate,
   refresh a cache, seed a default, or stamp anything. If your kind wants a
   seeded default, seed it once at server construction, the way
   `seedDemoPianoRoll()` is called.

Expose two functions for the transport:

```ts
/** Point-in-time clones, sorted by name. Read-only. */
export function listMarkers(): MarkerEntity[];

/** The tick: adopt any code drift, then drain the gate. Null when idle. */
export function sampleMarkerChanges(): EntityChange<MarkerEntity>[] | null;
```

If user code holds a live object and writes to it by plain assignment, you need
an **adopt pass** like `adoptParamsCodeWrites()` — a serialize-compare that turns
drift into a store generation. Split it out as its own exported function and call
it from the sample function, because it must run on every tick regardless of
subscriptions. If nothing outside your store writes the value (piano rolls), skip
the adopt pass entirely: write-time tracking is enough and costs one set-size
check when idle.

### The other case: state that already lives somewhere else

Runs live on the server object, and waits/lookups live in `runtime.ts`'s
process-global maps. Neither is an `entity_store.ts` record. For that shape, use
`createModuleKeyedSource` in `sync_sources.ts` (or write an equivalent): mark a
dirty hint on the hot path, and let the source do a per-entity serialized
compare before shipping, so a hot loop re-marking an unchanged value stays
silent.

## Step 3: register a sync source

Add a factory to `sync_sources.ts`:

```ts
export function createMarkerSyncSource(): SyncSource<unknown> {
  return {
    entityType: MARKER_ENTITY_TYPE,
    collectChanges: () => sampleMarkerChanges(),
    snapshotAll: () => listMarkers(),
  };
}
```

and register it in `createLivecodeVisualizerServer`, next to the others:

```ts
syncSources.register(createMarkerSyncSource());
```

That is the entire server-side transport wiring. There is no socket to open, no
timer to add, no broadcast block to copy, and no shutdown hook: the one timer
already walks the registry.

Two invariants to re-read before you finish this step:

- `collectChanges()` **drains** — exactly one caller per tick, which is
  `collectAll()`. If anything else calls it, one consumer starves the other.
- `snapshotAll()` **never drains** — it answers a subscribe reset and nothing
  else.

## Step 4 (durable only): registry descriptor and persistence

Add the saved file format to `packages/livecode-protocol/saved_entities.ts`:

```ts
export interface SavedMarkerEntity {
  type: "marker";
  name: string;
  savedAt: string;
  // ...whatever the type needs to be reconstructed
}
```

Then add a `DurableEntityTypeDescriptor` in `entity_registry.ts` and register it
in `registerBuiltinDurableEntityTypes()`. The descriptor is the type id plus
eight small functions; the two with non-obvious contracts are:

- `serialize(name)` returns **null to mean "skip this entity"**. That is how a
  save stays non-fatal: a value that no longer serializes, or a pristine
  auto-created default, returns null and is reported in the response's `skipped`
  list instead of failing the pass.
- `latestJson(name)` is the canonical compact JSON used for the unsaved-changes
  compare — null when the entity is absent, the empty string when its value could
  not be serialized. Return the store's cached JSON, never a re-pretty-printed
  file, or an unchanged entity will read as permanently unsaved.

You get `/entities/create`, `/entities/duplicate`, `/entities/delete`,
`/project/save`, `/project/open`, and the `/project/status` unsaved rows from
this step alone; none of those routes learn your type's name.

## Step 5: routes, if it takes writes

Only if the kind is written over HTTP. Follow the existing shapes: a set route
takes an optional `expectedRev` and answers a stale one with the current entity
plus `conflict: true` rather than an HTTP error; a list route builds a read-only
full snapshot. Add the request body type to your package module, not inline at
the call site.

There is deliberately no write route for signals. If your kind is code-published
only, having no set route is the design, not an omission.

## Step 6: client context and typed hook

In `syncRuntime.tsx`, four small edits:

1. add the wire id to `SYNC_ENTITY_TYPES`;
2. add a slice to `SyncState` and to `emptySyncState()`;
3. add a `createContext<SyncSlice<MarkerEntity>>(emptySlice())` and wrap it into
   the provider tree;
4. export a typed hook returning the consumer-facing shape.

**Add a context, not a field on an existing context value.** The per-kind split
is what stops a signal tick from re-rendering every param pane, and it is the
reason a new kind is cheap. A hook that needs two kinds composes two contexts —
`useModuleVizSync()` is the worked example.

Give the hook the shape its consumers actually want, not the transport's shape.
`usePianoRollsSync()` returns `{ rolls, latestSeq, connectionStatus, ... }`
because that is what the roll shape reads; the slice is an implementation detail.

Writes do **not** go through the socket. Add them as HTTP calls in
`serverRequests.ts` and expose them on `SyncActions`, alongside
`setRoll`/`setParams`.

## Step 7: consumer wiring

A tldraw shape (`PianoRollShape`, `ParamPaneShape`, `SignalScopeShape` are the
three templates), a topbar action, or a decoration in `CodeMirrorEditor`. Four
things every consumer of live entity state gets wrong at least once:

- **an entity can be absent.** A view outlives what it views: creating a pane
  never creates an entity, and deleting an entity leaves its views on a waiting
  placeholder. Render the placeholder, do not crash.
- **`connectionStatus` is not the same as "the value stopped changing".** A
  closed socket means "no readings", and consumers must say so — a playhead
  frozen where a dead socket left it reads as a playing one.
- **`rev` is not a change key.** Use it for echo suppression of your *own*
  writes, never to decide whether something changed.
- **ticks coalesce.** A value that changed twice inside one 33 ms tick arrives
  once. Be correct over the states you receive, not over an assumed sequence.

## Step 8: tests, one per layer

| Layer | Where | What |
| --- | --- | --- |
| Store semantics | a new `livecode/tests/<kind>_store_test.ts` in `test:livecode:unit` | create/reattach, no-op detection, whatever adoption or reconcile the kind has, and that a read path did not consume the gate |
| Durable registry | `livecode/tests/entity_registry_test.ts` | create rejects an existing name, duplicate, delete, serialize/deserialize round trip, and a hostile value being skipped rather than thrown |
| Transport | `livecode/tests/sync_transport_test.ts` | subscribe reset includes the kind, a change ships per entity, a delete ships as `entity: null`, and any change that does not bump `rev` still arrives |
| Route contract | `livecode/tests/protocol_smoke_test.ts` | only if you added routes |
| Browser | `apps/livecode-tldraw/tests/livecodeTldraw.e2e.mjs` | the user-visible round trip, and — for a durable kind — that a save writes the file and an open reverts a live edit |

Add the new unit test file to `test:livecode:unit` in
`apps/deno-notebooks/deno.json`; the server task already runs the transport and
smoke suites.

## Step 9: documentation

The maintenance contract in `docs/livecode/README.md` applies. Concretely, a new
entity kind touches: `protocol.md` (the kinds table and the type), `server.md`
(the file map, the source list, and any route rows), `client.md` (the hook table
and the shape), `system-architecture.md` (a state-ownership row), and — if
durable — `project-model.md`.

## What you should not have had to do

If the recipe above made you copy a broadcast block, add a timer, open a socket,
write a per-channel reconnect handler, or mirror a type into a second file, stop:
the transport slice exists to make all five unnecessary, and doing one of them
means the seam is in the wrong place.

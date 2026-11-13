# Batched Runtime Editor Updates

> Historical implementation plan for the earlier visualizer. Start at
> `docs/livecode/README.md` for current behavior.

## Goal

Runtime waits can start and finish at arbitrary times, and in musical or
graphics sequencing they may happen faster than the editor should repaint. The
visualizer does not need to stream every wait enter/exit transition to
CodeMirror. It needs to show the current active wait callsites at a perceptual
frame cadence.

The preferred model is snapshot-based:

- transformed code updates a runtime count map immediately
- the runtime samples that count map at a frame-ish interval
- the server sends active UUID snapshots to the browser
- the browser maps UUIDs through the cached manifest
- CodeMirror receives one batched decoration update per visual frame

## Scale Assumption

The expected number of visualized callsites is small:

- a typical user-edited module may have roughly 20 visualizable lines
- even across multiple independent editor modules or loops, 100 active-capable
  callsites is still a small payload

At this scale, sending active UUID snapshots at around 30fps is inexpensive.
The more important performance concern is avoiding one CodeMirror transaction
per runtime event or per UUID.

## Manifest Lifecycle

The visualizer manifest changes only when source changes and the module is
re-analyzed/transformed. It should be sent or cached separately from runtime
activity snapshots.

Example manifest message:

```ts
interface VisualizerManifestMessage {
  type: "manifest";
  moduleId: string;
  sourceVersion: number;
  callsites: Array<{
    id: string;
    from: number;
    to: number;
    displayName: string;
    kind: "timeContextMethod" | "timeContextArgumentCall";
  }>;
}
```

The client stores:

```ts
Map<moduleId, Map<callsiteId, SourceRange>>
```

or an equivalent structure owned by the CodeMirror visualization extension.

Runtime activity messages can then stay small because they only need to contain
UUIDs.

## Runtime Snapshot Message

For a single module, the message can be:

```ts
interface ActiveWaitSnapshot {
  type: "activeWaitSnapshot";
  seq: number;
  timestampMs: number;
  moduleId: string;
  activeIds: string[];
}
```

For multiple modules, the message can batch them:

```ts
interface MultiModuleActiveWaitSnapshot {
  type: "activeWaitSnapshot";
  seq: number;
  timestampMs: number;
  modules: Record<string, string[]>;
}
```

Both shapes are compatible with the singleton count-map approach. Include
`moduleId` from the start so multiple editor modules can be routed cleanly
without changing the protocol later.

## Server Cadence

The server should run a visualizer publish loop at a configurable frame-ish
rate, probably starting at 30fps:

```ts
const VISUALIZER_FPS = 30;
const intervalMs = 1000 / VISUALIZER_FPS;
```

At each tick:

1. Read active IDs from the singleton count map.
2. Group IDs by module if the runtime tracks module ownership.
3. Compare the snapshot to the last sent snapshot.
4. If unchanged, send nothing.
5. If changed, send one snapshot message.

This means waits that begin and end between two ticks may not appear in the
editor. That is acceptable for the visualizer goal: the editor displays active
waiting at visual cadence, not a full event log.

## Client Update Path

The browser should still gate updates through `requestAnimationFrame`, even if
the server publishes at 30fps.

Client flow:

1. Receive an active wait snapshot.
2. Store it as the latest pending runtime state.
3. If no animation frame is scheduled, schedule one.
4. On the animation frame:
   - read the latest pending snapshot
   - map active UUIDs to manifest source ranges
   - group ranges by CodeMirror editor/module
   - dispatch one CodeMirror effect/transaction per affected editor

This keeps the editor hot path direct and avoids routing high-frequency runtime
state through framework state.

## Decoration Semantics

The runtime snapshot represents the current active set:

```ts
activeIds = ids where activeWaitCounts.get(id) > 0
```

The CodeMirror extension can replace the previous active decoration set with
the new one each frame. It does not need to process enter/exit deltas.

The manifest should store exact source ranges for each callsite. The editor can
choose whether to render:

- the exact awaited call expression
- the whole `await ...` expression
- the whole source line

The manifest should preserve enough range information to support those choices
without changing the runtime protocol.

## Optimization Policy

Required for the first version:

- 30fps-ish server snapshot loop
- send only on active set change
- client-side `requestAnimationFrame` coalescing
- one CodeMirror transaction per affected editor per frame

Not required initially:

- enter/exit event replay
- per-wait animation trails
- microsecond-accurate wait timing in the editor
- delta compression
- binary protocol

## Recommended First Contract

Use this first:

```ts
interface ActiveWaitSnapshot {
  type: "activeWaitSnapshot";
  seq: number;
  timestampMs: number;
  modules: Record<string, string[]>;
}
```

Even if there is only one module at first, the grouped shape makes the
multi-editor future explicit and still keeps messages tiny.

The server sends this at up to 30fps and only when changed. The client applies
the latest received snapshot on the next animation frame by dispatching direct
CodeMirror decoration effects.

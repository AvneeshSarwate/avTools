# Engine-to-UI events

Status: implemented September 2026. The current contracts live in
`current/protocol.md`, `current/server.md`, and `current/client.md`; the
executable fixture is `feature-ui-events`.

## Why

Engine code can already hear the UI: `canvas-events` carries `{type, body}`
input from param-pane buttons to `onEvent` listeners inside the engine. The
other direction has only state sync: durable entities and ephemeral signals,
conflated to the latest value on the ~33 ms tick. Nothing lets running code
tell a UI that something happened: focus this view, flash that control, show
a message.

The first concrete need is a Beatstep focus switcher in `sonar-melodies`: a
pad press selects which voice the encoders edit and, when a toggle is on,
moves the tldraw camera to that voice's param pane.

## Shape of the feature

A lightweight outbound event stream from the engine. It is not a package, a
store, or an entity kind.

- **General.** Any JSON `{type, body}`. The platform assigns no meaning to
  types.
- **Fire and forget.** `send` returns nothing, needs no consumer, and needs no
  `TimeContext`. A headless run sends into nothing and behaves identically.
- **Decoupled.** Independent of params, signals, canvas views, and the entity
  stores. It rides the transports sync already opens, as its own message
  type, with none of sync's subscribe, reset, or `seq` machinery.
- **Every engine placement.** The same `send` call and the same consumer code
  work with the engine in the Deno server, in a separate browser engine tab,
  in the UI's own tab, and in both bake forms.
- **Any consumer.** The wire is one JSON message type. The tldraw app is one
  consumer; a hand-rolled UI or an external script reads the same messages.
- **Coupled at project time.** A literal type string on each side, visible in
  source. The platform infers nothing.

Choosing between an event and state is the author's call. The platform
promises no ordering between events and sync, no replay for a late or
reconnecting UI, and no acknowledgement.

## Contract

### Engine side

A helper module `ui-events`, mapped like `canvas-events`:

```ts
import * as ui from "ui-events";

ui.send({ type: "tldraw.focusEntity", body: { type: "params", name: "voice 3" } });
```

- `send` validates with the same JSON-only rules as `canvas-events`
  (`cloneEvent`) and throws synchronously on invalid input.
- Events sent in one synchronous turn are batched and flushed on a microtask,
  independent of the sync tick.
- The engine stamps a monotonic `seq` per event. The queue is bounded; overflow
  drops the oldest and reports `dropped` on the next batch.
- Outbound events never reach `canvas-events` listeners, so there is no loop
  unless code closes one explicitly.

### Wire and transports

The wire type lives in `packages/livecode-protocol`, the one type source:

```ts
interface UiEventBatch {
  type: "uiEvents";
  events: Array<{ seq: number; type: string; body: unknown }>;
  dropped?: number;
}
```

It rides the existing channels, in the same way entity actions already share
them with sync:

| Topology | Engine to host | Host to consumers |
| --- | --- | --- |
| Local Deno engine | optional engine dep `onUiEvents` | every open `/sync` socket, regardless of its entity subscriptions |
| Remote browser engine | new uplink message `engineUiEvents` | server relays to every `/sync` socket; the engine tab also posts on its sync BroadcastChannel |
| Baked two-tab | none | the sync BroadcastChannel |
| In-process single page | none | `BrowserEngineHost.observeUiEvents(listener)` beside `observe` |

Existing clients already ignore unknown message types on the socket and the
channel. A batch never advances the sync `seq`, so gap detection is
unaffected. The server holds no buffer.

A consumer outside the tldraw app opens `/sync` (or the channel) and handles
`uiEvents` messages. It does not need to subscribe to anything.

### The tldraw app

The sync transport's message dispatch routes `uiEvents` to one handler table
keyed by type; unknown types are ignored. The app owns a small vocabulary
under a `tldraw.` prefix. That vocabulary is the app's API, not the platform's.

- `tldraw.focusEntity` `{type, name, zoom?: "fit" | "keep"}`: select the first
  view bound to that entity and bring it into view. `keep` pans without
  changing zoom. No matching view means nothing happens; it never creates a
  view.

Entries are added when a piece needs them. Every UI tab reacts.

## Worked example: the Beatstep focus switcher

```ts
params.midi.focus = voiceIndex; // state: the pane shows it, encoders read it
if (params.midi.followFocus) {
  ui.send({
    type: "tldraw.focusEntity",
    body: { type: "params", name: `voice ${voiceIndex}`, zoom: "keep" },
  });
}
```

Pressing the already-focused voice's pad still sends the event and moves the
camera back, which latest-value state alone would not do.

## Implementation slices

1. **Protocol and engine.** Wire type; outbound queue with validation, bound,
   and microtask flush; `onUiEvents` dep; the `ui-events` helper in both import
   maps and `ALIAS_ENTRIES`. Unit tests for validation, batching, the bound,
   and no sink.
2. **Hosts.** Local `/sync` fan-out, remote uplink relay, engine-tab channel
   post, `observeUiEvents`. Transport tests over real sockets and the browser
   host.
3. **tldraw consumer.** Dispatch in each sync transport, the handler table,
   `tldraw.focusEntity`, and a `feature-ui-events` example project whose
   param button makes the engine send a focus event. E2E in the three
   topologies.
4. **Docs.** `protocol.md`, `server.md`, `client.md`, and the authoring
   guide's library table. This note then keeps only its invariants.

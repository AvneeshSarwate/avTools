# Engine-to-UI events

Open this project from `/projects.html` in any topology, then Run **Engine-to-UI
focus events**. The `ui-events` pane has two buttons. Each one is ordinary UI
input to the engine; the module's handler answers by sending a
`tldraw.focusEntity` event back, and the canvas selects the matching params
pane and brings it into view. The two target panes sit far off to the left and
right so the camera move is obvious.

```ts
import * as ui from "ui-events";

ui.send({
  type: "tldraw.focusEntity",
  body: { type: "params", name: "ui-events/right", zoom: "keep" },
});
```

- **keep zoom** on pans to the pane at the current zoom; off zooms to fit it.
- **events sent** counts the module's sends. It goes up whether or not any UI
  is open, because `send` is fire and forget.

## What the feature is

`ui.send({type, body})` from engine code reaches every connected UI tab. It is
the outbound mirror of `canvas-events`:

- The body must be JSON data; anything else throws at the call.
- It needs no `TimeContext` and returns nothing. A headless run behaves the
  same with no UI attached.
- Events sent in one synchronous turn leave together as one batch, straight
  away rather than on the sync tick. There is no ordering promise relative to
  entity sync, no replay for a tab that opens later, and no acknowledgement.
  Deciding what is an event and what is state is up to the piece: anything a
  UI must show correctly after a reload belongs in params or another entity.
- Events travel on the connection sync already uses: the `/sync` socket (Deno
  engine, or a browser engine relayed through the server), the engine tab's
  BroadcastChannel, or the same tab when the engine runs in the UI's page.
  A different UI only needs to open that socket or channel and handle
  messages of type `uiEvents`; it does not need to subscribe to anything.

The tldraw app handles `tldraw.*` types and ignores everything else. Today that
is `tldraw.focusEntity` `{type, name, zoom?: "fit" | "keep"}`: it selects the
first view bound to that entity on the current page and pans (`keep`) or zooms
(`fit`, the default) to it. With no bound view nothing happens; the engine
never creates views. Every open UI tab reacts.

## Checks

1. Press **focus right**, then **focus left**. The camera moves each time and
   the target pane is selected.
2. Pan away by hand and press the same button again. The camera comes back:
   these are events, not a latest value.
3. Turn **keep zoom** off and press a button: the camera zooms to the pane.
4. Stop the module and press a button: nothing moves, because no handler runs.

Automated: `LIVECODE_E2E_CASE=uiEvents npm run test:e2e` from
`apps/livecode-tldraw`, also with `LIVECODE_E2E_ENGINE=remote`, and with
`LIVECODE_E2E_ENGINE=remote LIVECODE_E2E_UI=served LIVECODE_E2E_ACTIONS=broadcast`
after `npm run build`. The engine queue and server relay are covered by
`livecode/tests/ui_events_test.ts` in `apps/deno-notebooks`.

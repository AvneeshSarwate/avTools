# TD Canvas

A standalone, customizable Vue app that sends drawings to avTools JavaScript
TOPs and CHOPs over WebSockets. `src/App.vue` imports the actual
[`CanvasRoot.vue`](../browser-projections/src/canvas/CanvasRoot.vue) component;
it is not an iframe or a copied canvas implementation. Add your own controls,
panels, metadata schemas and application logic around it here.

## Run

From this directory, with Node 22.20+ installed:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5177**. Open **[td/Canvas.toe](td/Canvas.toe)** in
TouchDesigner (keep it inside this checkout). It loads the current checked-in
plugins and adjacent TypeScript sources automatically. Two TOPs show the same
drawing and two CHOPs report shape count, revision and connection state.
The TOPs run at **1280 × 720**. Draw a circle, polygon or freehand stroke;
updates should appear while you draw or drag, with final state on release.

For your existing TD project, load the current avTools TOP and set TypeScript
File to `td/picture.ts`. Set Width/Height to 1280/720. The generated Drawing URL
parameter defaults to `ws://127.0.0.1:5177/canvas?drawing=main`; Reset after
changing the URL. `td/channels.ts` demonstrates the same API in a CHOP; set
Output Channels to `shapes revision connected`.

`npm run build` creates the production page. `npm start` serves that build and
the same relay without Vite. `PORT=5180 npm run dev` changes the server port;
update the TOP's URL accordingly. The example server binds only to loopback.

## Multiple drawings and instances

Open `http://127.0.0.1:5177/?drawing=scene2` for another drawing, and subscribe
operators to `ws://127.0.0.1:5177/canvas?drawing=scene2`. Names contain letters,
digits, `_` or `-`, up to 64 characters. There is one editing browser per drawing;
a second editor is rejected visibly. Any number of TOP/CHOP subscribers can
share the drawing (subject to machine capacity).

Committed documents are saved to ignored `.data/<drawing>.json`. Gesture
previews are temporary. On disconnect during an unfinished gesture, the relay
returns to the last committed document. Browser page reload, plugin Reset,
TypeScript reload and reconnect receive a full snapshot. The sketch retains its
last drawing while the server is disconnected and retries with bounded backoff.
Use the canvas Download/Upload buttons to share drawings.

## Where to customize

- `src/App.vue`: browser layout, document events and connection UI.
- `server.ts`: HTTP/Vite server; `relay.ts`: rooms, disk persistence and delivery.
- `shared/protocol.ts`: snapshots and shape previews using `DrawingDocument`.
- `shared/subscribe.ts`: typed TOP/CHOP subscriber, reconnect and revision checks.
- `td/picture.ts`: drawing interpretation/rendering. Transforms, groups and curves
  are baked through `packages/drawing-document`; Vue and Konva stay in the browser.
- `td/channels.ts`: latest-state channel output example.

The drawing coordinates are 1280 × 720; the TOP scales geometry to its configured
output resolution. Shape metadata travels with the document. The example draws
outlines; it does not reproduce the editor's selection handles or preview fill.

Previews are emitted at about 30 Hz and committed edits immediately. The relay
uses one unacknowledged message per subscriber; a slow subscriber gets a current
snapshot afterward, instead of an accumulating queue of old gestures. Browser
outbound edits also coalesce pending previews. Messages/documents are limited to
8 MiB. Large-document parsing and baking happen on the JS worker when edited;
unchanged drawings are not re-parsed every TD cook.

This first version is a local single-editor tool, not an authenticated LAN
collaboration service. The relay checks browser origins. The native API also
supports `wss://` for applications with their own TLS server.

## Build and tests

```sh
npm run typecheck
npm test
npm run build
```

Native runtime source is in `packages/native-webgpu/native/embedded/WebSocket.mm`
and `src/td-websocket.ts`; API documentation is in
[IO.md](../../packages/native-webgpu/IO.md). Standard plugin builds update the local
`apps/td-projects/Plugins` folder and the release ZIP
([downloads](../../packages/native-webgpu/prebuilt/README.md)).
Generated template projects include WebSocket types, README API docs, and generic
TOP/CHOP examples under `examples/websocket`, plus complete canvas clients under
`examples/canvas`. The generated canvas clients include their geometry library
in the SDK and do not import source files from this checkout. The browser editor
and relay still run separately from this app directory.

`td/create_fixture.py` creates an isolated test component from TD's Textport.
`td/build_projects.py` packages the TD-saved `.tox` into the standalone `.toe`.
See [test/VALIDATION.md](test/VALIDATION.md) for verified behavior and limits.

# Minimal Node livecode host

Build `packages/native-webgpu` first, then with Node 22.20.0:

```sh
npm ci
npm run build
npm test
node cli.mjs examples/text.mjs
node cli.mjs examples/text.mjs --preview
```

The second launch opens a native preview. The default is offscreen. A sketch exports
`default async (ctx, {p, device, window, present})` (or `runFunc`). `ctx` is the
existing engine TimeContext; render with beginFrame/endFrame and call present after
submitting. Optional `stop()` retains the engine's existing stop-hook semantics.
The CLI exits when the sketch finishes or errors; SIGINT/SIGTERM close the engine
and release graphics resources. Host logs expose GPU errors/device loss.

`createNodeHost()` provides launch, engine, and close for programmatic use. It uses
the existing livecode-engine unchanged, including queued launches, replacement,
run identity, stop, panic, sync collection, and bounded stop hooks. Every launch
gets its own renderer; optional previews share one Metal device. JavaScript modules
are imported from local files with the engine's cache-busting launch query.

This is the selected end-to-end Node host, not a migration of the editor/server.
Still Deno-hosted: HTTP/WebSocket editor transport and static assets, project
filesystem/watch/import/build endpoints, shadow analysis and `deno check`, Deno LSP
proxy, subprocess supervision, MIDI FFI/backends and device discovery, webview
panels, and full generated-module import maps. Those need explicit Node adapters
and a pinned TypeScript language-server/shadow TypeScript project when migrating
the full editor. No replacement LSP or editor redesign is introduced here.

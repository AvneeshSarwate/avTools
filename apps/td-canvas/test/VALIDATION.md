# Validation — 2026-11-01

Validated on macOS arm64 with TouchDesigner 2025.33230 and the in-app browser
(Chrome's native computer-use connection timed out). Plugin distribution 45.

## Live end-to-end checks

- Drew a circle, triangle and freehand stroke through the browser UI.
- Two 1280×720 TOPs received the same drawing and produced pixel-identical
  images with 6,404 foreground pixels. Two CHOPs reported three shapes, matching
  revision and connected state. No operator errors or warnings.
- Reset one TOP and one CHOP; the server restored the current drawing.
- Reloaded the browser; the committed document was restored.
- Stopped and restarted the server; the browser and all four operators
  reconnected and recovered the saved document.
- Changed the TOP TypeScript stroke color while running; automatic reload
  applied it and restored the drawing (blue component changed to 180/255).
- Saved the component and opened `td/Canvas.toe` as a standalone project;
  startup resolved current plugins and TypeScript files successfully. Repeated
  pixel/channel checks passed with the final packaged plugin builds.
- Verified both development serving and the built production page/relay.

Evidence: [td.json](td.json), [browser.png](browser.png),
[top-output.png](top-output.png). Last-cook startup CPU times are deliberately
excluded: this is a functional check, not a TD rendering benchmark.

## Automated checks

`npm test` exercises multiple subscribers, committed snapshots, live previews,
slow-consumer full-state recovery, reconnect snapshots, duplicate editor
rejection, document validation, disk persistence and a 10,000-point drawing.
`npm run typecheck` and `npm run build` pass.

Shared runtime tests live in `packages/native-webgpu/test/websocket`:

- Native transport under AddressSanitizer: Unicode text, 1 MiB binary messages,
  fragmentation with interleaved ping, 30 reconnects, bounded receive overflow,
  local/remote close codes, connection refusal, 100 in-flight teardowns.
- Four actual V8 workers: callbacks without TD cooks, copied binary sends,
  invalid sends/close codes, timers, 30 sketch reloads, failed setup cleanup.
- Generated SDK compiles both examples and rejects an invalid send argument.
- Existing native file/UDP/OSC and MIDI adapter/SDK regression tests pass.
- Final plugin code signatures verify; copyable Plugins and ZIP are refreshed.

Four idle native WebSocket workers measured about **0.003% of one core** in a
one-second local sample. That is near the measurement floor and excludes
rendering, browser work and geometry parsing. It is not an end-to-end latency
benchmark. The 30 Hz canvas preview throttle intentionally limits live edit
frequency; a committed edit is sent immediately.

TLS/DNS use macOS NSURLSession. Localhost DNS was exercised; remote TLS servers,
LAN behavior and prolonged network partitions were not tested. The relay is
intended for a local single-editor workflow, not multi-user collaboration.

## Generated template follow-up — distribution 47

All supplied sketches now live under `examples/`. Fresh projects include
`examples/canvas/picture.ts` and `channels.ts`, their subscription/protocol
helpers, and the drawing-document library in SDK 8. Release preparation derives
these clients from this app's tested sources.

Verified both Create Template Project buttons in TouchDesigner: the selected
entry paths are under `examples/`, and the generated canvas TOP (1280×720) and
CHOP connected to the relay and displayed/reported three shapes. Temporary test
operators and source projects were removed afterward. Evidence is in
`tools/td-native-build/tests/results/template-layout-td.json`.

The 25 native-builder/SDK checks passed (entry files, parameters, legacy builds,
watchers, type environment, MIDI and WebSocket/canvas SDK). Filesystem-watcher
checks ran outside the sandbox to receive macOS filesystem events. The full
template also passes TypeScript typechecking.

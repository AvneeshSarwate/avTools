# Shared WebSocket runtime tests

Install the standalone canvas app dependencies first:

```sh
npm ci --prefix apps/td-canvas
node packages/native-webgpu/test/websocket/transport.mjs
node packages/native-webgpu/test/websocket/run.mjs
node --test packages/native-webgpu/test/websocket/sdk.mjs
```

Transport tests compile `WebSocket.mm` directly with AddressSanitizer and use a
local Node `ws` server. Leak detection is disabled because Foundation retains
process-wide caches; invalid accesses remain instrumented. The test's wait loop
is a harness probe, not production runtime polling.

The V8 test uses the built shared runtime, four CHOP workers and localhost echo
servers. See [results/native.json](results/native.json). Rebuild the embedded
runtime before running after C++ changes. Generated SDK tests use the release
`avtools-build` executable; rebuild it after changing template assets.

The [canvas app validation](../../../../apps/td-canvas/test/VALIDATION.md) covers
real browser interaction, two TOPs and two CHOPs, script reset/reload, relay
restart and standalone `.toe` reopen with the packaged plugins.

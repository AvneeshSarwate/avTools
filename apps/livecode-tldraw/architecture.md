# Livecode tldraw client handoff

The canonical documentation entrypoint for this client and its Deno server is
[`../../docs/livecode/README.md`](../../docs/livecode/README.md). Read that
entrypoint and every document in its required reading order before making a
cross-cutting change.

This file is deliberately a short local index. The authoritative description
of current client behavior is
[`../../docs/livecode/current/client.md`](../../docs/livecode/current/client.md),
and the end-to-end topology and flows are in
[`../../docs/livecode/current/system-architecture.md`](../../docs/livecode/current/system-architecture.md).

## Local source map

| Area | Files |
| --- | --- |
| App/provider composition and tldraw-store coordination | `src/App.tsx` |
| Topbar controls, project save, and entity/view actions | `src/TopBar.tsx` |
| Project, baked-project, and `.tldr` canvas helpers | `src/projectCanvas.ts` |
| Browser automation/client-control bridge | `src/clientControlBridge.ts` |
| Projects index page (server discovery, project list, topology-aware open) | `projects.html`, `src/projectsIndex.ts` |
| Sync provider, per-kind contexts, typed hooks, and HTTP writes | `src/syncRuntime.tsx` |
| Sync map reduction and WebSocket/BroadcastChannel adapters | `src/syncState.ts`, `src/syncTransport.ts` |
| Runtime provider, connect/recovery, analysis, launch, and project synchronization | `src/livecodeRuntime.tsx`, `src/buildLifecycle.ts`, `src/runCorrelation.ts` |
| Livecode shape and utility | `src/LivecodeEditorShape.tsx` |
| CodeMirror, LSP bridge, wait decorations | `src/CodeMirrorEditor.tsx`, `src/denoLsp.ts` |
| Piano-roll shape | `src/PianoRollShape.tsx` |
| Params pane shape | `src/ParamPaneShape.tsx` |
| Signal scope shape | `src/SignalScopeShape.tsx` |
| Wire types | `packages/livecode-protocol` (vite alias + tsconfig path); `src/livecodeProtocol.ts` re-exports it and adds client-local view models |
| Piano-roll custom element typing | `src/custom-elements.d.ts` |
| Reconnecting sockets and bounded requests | `src/reconnectingSocket.ts`, `src/serverRequests.ts` |
| Debug/test surfaces | `src/livecodeTldrawDebug.ts` plus APIs installed by `App.tsx` and `livecodeRuntime.tsx` |
| Browser tests and fixtures | `tests/`, `public/test-canvases/` |

## Commands

From this directory:

```sh
npm run setupLivecode   # one-shot local setup: installs + component bundles
npm run dev
npm run type-check
npm run build
npm run test:e2e
```

The E2E runner starts its own Deno server and Vite process, then drives Chromium.
Its Node, Playwright, and browser requirements are described in
[`../../docs/livecode/current/testing-and-operations.md`](../../docs/livecode/current/testing-and-operations.md).

The piano-roll web component this client embeds is built from
`apps/browser-projections` into a gitignored bundle. After pulling a change to
`src/pianoRoll` there, run `npm run buildPianoRoll` in that app — or just
`npm run setupLivecode` here, which performs every local install/build step
(and is the place future component bundles get added) — before `npm run dev`
or `npm run test:e2e`.

Do not add detailed architecture here. Update the matching canonical document
under `docs/livecode/current/`, and update the principles or history trees only
when their distinct roles apply.

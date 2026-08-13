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
| App shell, tldraw overrides, project load/save | `src/App.tsx` |
| Runtime provider, analysis/run state, snapshots, project synchronization | `src/livecodeRuntime.tsx` |
| Livecode shape and utility | `src/LivecodeEditorShape.tsx` |
| CodeMirror, LSP bridge, wait decorations | `src/CodeMirrorEditor.tsx`, `src/denoLsp.ts` |
| Piano-roll shape and server-store bridge | `src/PianoRollShape.tsx`, `src/pianoRollRuntime.tsx` |
| Params pane shape and server-store bridge | `src/ParamPaneShape.tsx`, `src/paramsRuntime.tsx` |
| Wire types | `src/livecodeProtocol.ts`, `src/pianoRollProtocol.ts`, `src/clientControlProtocol.ts`, `src/paramsTypes.ts` |
| Socket behavior | `src/reconnectingSocket.ts`, `src/serverRequests.ts` |
| Debug/test surfaces | `src/livecodeTldrawDebug.ts` plus APIs installed by `App.tsx` and `livecodeRuntime.tsx` |
| Browser tests and fixtures | `tests/`, `public/test-canvases/` |

## Commands

From this directory:

```sh
npm run dev
npm run type-check
npm run build
npm run test:e2e
```

The E2E runner starts its own Deno server and Vite process, then drives Chromium.
Its Node, Playwright, and browser requirements are described in
[`../../docs/livecode/current/testing-and-operations.md`](../../docs/livecode/current/testing-and-operations.md).

Do not add detailed architecture here. Update the matching canonical document
under `docs/livecode/current/`, and update the principles or history trees only
when their distinct roles apply.

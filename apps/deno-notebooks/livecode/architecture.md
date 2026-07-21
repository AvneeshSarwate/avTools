# Livecode Deno server handoff

The canonical documentation entrypoint for this server and its tldraw client is
[`../../../docs/livecode/README.md`](../../../docs/livecode/README.md). Read that
entrypoint and every document in its required reading order before making a
cross-cutting change.

This file is deliberately a short local index. The authoritative description
of current server behavior is
[`../../../docs/livecode/current/server.md`](../../../docs/livecode/current/server.md),
and analysis/code generation is documented in
[`../../../docs/livecode/current/analyzer-and-generated-code.md`](../../../docs/livecode/current/analyzer-and-generated-code.md).

## Local source map

| Area | Files |
| --- | --- |
| HTTP/WebSocket routes and process orchestration | `visualizer/server.ts` |
| Static analysis and generated source | `visualizer/analyze_transform.ts` |
| Prepared-module instrumentation and active wait tracking | `visualizer/runtime.ts` |
| Project import graph, shadow files, and diagnostics | `visualizer/project_shadow_analysis.ts` |
| Piano-roll state and history | `visualizer/piano_roll_store.ts` |
| User-facing piano-roll conversion/playback | `helpers/piano_roll_helpers.ts` |
| MIDI integration | `helpers/midi_helpers.ts`, `helpers/midi_math.ts` |
| Deno language-server proxy | `visualizer/lsp_proxy.ts` |
| Server wire types mirrored by the client | `visualizer/protocol.ts` |
| Server entrypoint | `visualizer/main.ts` |
| Tests | `tests/` |

## Commands

From `apps/deno-notebooks`:

```sh
deno task livecode:server
deno task test:livecode:unit
deno task test:livecode:repro
deno task test:livecode:server
deno task test:livecode:project-shadow
```

The complete task/coverage matrix, including the tldraw browser tests, is in
[`../../../docs/livecode/current/testing-and-operations.md`](../../../docs/livecode/current/testing-and-operations.md).

Do not add detailed architecture here. Update the matching canonical document
under `docs/livecode/current/`, and update the principles or history trees only
when their distinct roles apply.

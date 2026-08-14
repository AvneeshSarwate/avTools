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
| HTTP/WebSocket routes, run records, the one broadcast timer and its fan-out | `visualizer/server.ts` |
| Sync source registry: what that timer walks, one entry per entity kind | `visualizer/sync_sources.ts` |
| Static analysis and generated source | `visualizer/analyze_transform.ts` |
| Prepared-module instrumentation, active wait tracking, signal ownership, and the process root clock | `visualizer/runtime.ts` |
| Project import graph, shadow files, and diagnostics | `visualizer/project_shadow_analysis.ts` |
| Generic entity records and the per-type changed-name gate | `visualizer/entity_store.ts` |
| Typed stores over it: params, ephemeral signals (unregistered by design), piano rolls | `visualizer/params_store.ts`, `visualizer/signals_store.ts`, `visualizer/piano_roll_store.ts` |
| Durable-type registry and entity-name file encoding | `visualizer/entity_registry.ts` |
| User-facing declaration helpers | `helpers/canvas_params.ts`, `helpers/canvas_signals.ts` |
| User-facing piano-roll conversion/playback | `helpers/piano_roll_helpers.ts` |
| MIDI integration | `helpers/midi_helpers.ts`, `helpers/midi_math.ts` |
| Deno language-server proxy | `visualizer/lsp_proxy.ts` |
| Wire types, shared with the browser clients | `packages/livecode-protocol`; `visualizer/protocol.ts` is a one-line re-export |
| Server entrypoint | `visualizer/main.ts` |
| Tests | `tests/` |

## Commands

From `apps/deno-notebooks`:

```sh
deno task livecode:server
deno task test:livecode:unit
deno task test:livecode:repro
deno task test:livecode:server
deno test --allow-all livecode/tests/project_shadow_diagnostics_test.ts
```

The complete task/coverage matrix, including the tldraw browser tests, is in
[`../../../docs/livecode/current/testing-and-operations.md`](../../../docs/livecode/current/testing-and-operations.md).

Do not add detailed architecture here. Update the matching canonical document
under `docs/livecode/current/`, and update the principles or history trees only
when their distinct roles apply.

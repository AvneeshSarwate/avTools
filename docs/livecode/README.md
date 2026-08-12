# Interactive Livecode Environment

This is the canonical documentation entrypoint for the interactive programming
environment implemented by:

- `apps/livecode-tldraw`: React, tldraw, and CodeMirror client.
- `apps/deno-notebooks/livecode`: Deno analysis, execution, LSP, project, and
  piano-roll server.

The documentation is organized by authority. Do not treat every Markdown file
in this repository as equally current.

## Fresh-session bootstrap

For a new implementation or review session, read these files in order:

1. `docs/livecode/principles/README.md`
2. `docs/livecode/user-level-project-goals.md`
3. `docs/livecode/principles/principles.md`
4. `docs/livecode/principles/architecture-questions.md`
5. `docs/livecode/current/system-architecture.md`
6. `docs/livecode/current/client.md`
7. `docs/livecode/current/server.md`
8. `docs/livecode/current/analyzer-and-generated-code.md`
9. `docs/livecode/current/project-model.md`
10. `docs/livecode/current/protocol.md`
11. `docs/livecode/current/testing-and-operations.md`
12. `docs/livecode/current/known-risks.md`

Then inspect the implementation files named by the relevant current-state doc.
For cross-boundary changes, inspect both protocol copies and both callers; the
protocol is currently hand-mirrored rather than generated.

A useful prompt for a fresh chat is:

> Read `docs/livecode/README.md` and every document in its fresh-session
> bootstrap list. Treat `docs/livecode/current/` as implementation truth,
> `docs/livecode/principles/` as design intent, and `docs/livecode/history/` as
> non-normative context. Then inspect the named source files before proposing
> changes.

## Authority and status

| Location | Meaning |
| --- | --- |
| `docs/livecode/current/` | Concrete description of the checked-in code as of 2026-07-21. |
| `docs/livecode/principles/` | Architecture principles and mental models with strong HCI implications. These guide judgement when changing core systems but may describe a destination the current code has not reached. |
| `docs/livecode/user-level-project-goals.md` | Owner's product-design and workflow intent: intended user-facing flows, the coding agent's role, and explicit non-goals. Consult it for any user-facing change. |
| `docs/livecode/principles/source-notes/` | Preserved owner brainstorms. They are inputs to the principles, not a current feature contract. |
| `docs/livecode/history/` | Preserved plans, discussions, reviews, and feature briefs. Read these for rationale or archaeology, not to learn current routes or code shape. |
| `apps/livecode-tldraw/architecture.md` | Short client-local handoff and file map. |
| `apps/deno-notebooks/livecode/architecture.md` | Short server-local handoff and file map. |

If current code and a current-state document disagree, code and executable tests
win. Update the document in the same change. If current code and a principle
disagree, do not silently choose one: identify whether the task is preserving
current behavior or moving toward the principle.

## Documentation maintenance contract

Any feature that changes a boundary must update the corresponding current docs:

- HTTP or WebSocket route, payload, or lifecycle: `current/protocol.md` and
  `current/server.md`.
- client state, tldraw shape props, connection behavior, or event shielding:
  `current/client.md`.
- transform scope, diagnostic, manifest entry, or generated import:
  `current/analyzer-and-generated-code.md`. A new diagnostic must also declare
  whether it blocks Run, warns only, or requires explicit lifecycle consent,
  and identify the framework guarantee behind any blocking rule.
- project manifest, source/runtime file model, materialization, or staleness:
  `current/project-model.md`.
- state ownership, process lifetime, or execution flow:
  `current/system-architecture.md`.
- test commands or coverage: `current/testing-and-operations.md`.
- accepted invariant, tradeoff, or product direction: `principles/README.md`.
- intended user workflow, product-design direction, agent role, or non-goal:
  `docs/livecode/user-level-project-goals.md`.
- newly discovered unresolved hazard: `current/known-risks.md`.

Historical documents should not be rewritten to look current. Move superseded
material into `history/`, add a short status note if its old wording is
misleading, and link it from `history/README.md`.

## Scope boundaries

The livecode environment also depends on code outside the two main directories:

- `packages/core-timing`: `TimeContext`, logical-time scheduling, structured
  concurrency, cancellation, barriers, tempo maps, and offline execution.
- `apps/browser-projections/src/pianoRoll`: source for the embedded piano-roll
  custom element.
- `webcomponents/piano-roll/dist/piano-roll.js`: locally built bundle consumed
  by the tldraw app.
- graphics, window, MIDI, and shared `@avtools/*` packages imported by user
  modules.

Those dependencies have their own behavior and tests. The livecode docs explain
the integration boundary, not their complete internal architecture.

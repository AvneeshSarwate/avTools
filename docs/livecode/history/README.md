# Historical Livecode Documents

Everything in this directory is preserved for rationale and archaeology. These
files are not current implementation contracts. Their route lists, client
locations, test commands, and “current” statements may describe the system at
the time they were written.

## Superseded architecture snapshots

- `client-architecture-2026-07-01.md` is the client handoff that preceded the
  documentation audit.
- `server-architecture-2026-07-01.md` is the server handoff that preceded the
  audit; it mixes still-useful details with obsolete Vue-era behavior.

## Principles-tree archaeology

The `docs/livecode/principles/` directory was dissolved on 2026-08-14;
`docs/livecode/principles.md` is the surviving primary document.

- `principles-synthesis-2026-07.md` is the earlier synthesis that was that
  directory's README. Its still-current unique content was folded into
  `principles.md`; its "Current qualification" notes describe July 2026 state.
- `architecture-questions.md` preserves the state-ownership debate (direct
  imports of live values versus tokens/types with store-carried values).
  Decided: the token/store direction, adopted in `principles.md` and
  implemented by the named-entity tier.
- `source-notes/` contains the preserved owner brainstorms
  (`client-brainstorm.md`, `runtime-brainstorm.md`) that fed the principles.

## Initial runtime design

`initial-runtime/` contains the design work for the original Vue/CodeMirror
visualizer and the first Deno server:

- `system-plumbing-and-dependency-shape.md`
- `top-level-wait-callsite-visualization.md`
- `batched-runtime-editor-updates.md`
- `self-test-loop.md`
- `tldraw-init-discussion.md`

These documents explain why LSP and runtime observation are separate, why the
first transform wrapped awaited callsites, why count maps and snapshots were
chosen, and why tldraw was considered a spatial shell. The active client is now
`apps/livecode-tldraw`, not the Vue page repeatedly named in these files.

## Feature and project briefs

- `piano-roll-lookup-feature-brief.md` is the implementation/review brief for
  piano-roll lookup instrumentation and CodeMirror buttons.
- `project-modules-design.md` is the original project-mode design. Parts are
  implemented, parts remain aspirational, and some state-sharing guidance is
  superseded by the principles document.
- `canvas-params-plan-2026-08.md` is the implementation plan for the
  `canvasParams` entity/tweakpane slice (first generic entity-store seam).
  While the work is in flight it is the active plan; afterwards
  `docs/livecode/current/` is the authority on what shipped.
- `entity-crud-persistence-plan-2026-08.md` is the implementation plan for
  GUI entity creation/duplication/deletion and durable-entity persistence in
  the project format (registry facade over the piano-roll and params stores).
  Same status convention as above.
- `ephemeral-signals-plan-2026-08.md` is the implementation plan for the
  ephemeral signal tier and its first consumers: piano-roll playhead markers,
  param-pane graph monitors, and the signal-scope shape. Same status
  convention as above.
- `multiplexed-transport-plan-2026-08.md` is the implementation plan for the
  unified sync transport (one subscribed socket for all entity kinds, shared
  protocol package, run/waits/lookups entities, piano-roll store migration,
  legacy runtime-snapshot shim). Same status convention as above. All four
  phases landed on 2026-08-13; the file carries a note listing the two places
  its prose no longer matches what shipped.
- `browser-engine-plan-2026-08.md` is the design note for running the engine
  in a browser tab: the engine/coordination split of the server, the
  BroadcastChannel UI plane and server uplink, module delivery to a browser,
  the Cloudflare remote-dev deployment, and the baked static setup.
  Implemented through Setup A and Setup B stages 1-2 (see the status
  paragraphs inside it); only the Cloudflare packaging and the decimated
  uplink mirror remain design-note-only.
- `cloudflare-remote-dev-plan-2026-08.md` is the deployment/operations design
  for that remaining Cloudflare half: the Worker + container + Access + R2
  topology, the walk-up-from-any-laptop sign-in ritual, the Claude Code
  Remote Control server in the container, credential/lifecycle handling, and
  verified cost figures. Design note only — nothing in it is implemented.

## Stability review

- `stability-review-2026-07.md` preserves the large July 2026 audit and
  implementation plan. It contains valuable defect rationale and future
  refactor proposals, but its completed phases should not be used as the file
  index or API reference. Some repro test names/comments also retain their old
  “BUG” wording after their assertions were flipped to the fixed behavior.

Use `docs/livecode/README.md` for current reading order.

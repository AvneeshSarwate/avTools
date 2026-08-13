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

## Stability review

- `stability-review-2026-07.md` preserves the large July 2026 audit and
  implementation plan. It contains valuable defect rationale and future
  refactor proposals, but its completed phases should not be used as the file
  index or API reference. Some repro test names/comments also retain their old
  “BUG” wording after their assertions were flipped to the fixed behavior.

Use `docs/livecode/README.md` for current reading order.

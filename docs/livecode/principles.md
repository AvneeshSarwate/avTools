# Livecode principles

The owner's product and architectural principles, distilled from the design
discussions preserved in [`history/`](history/README.md) and the brainstorm
notes in `history/source-notes/`. Each bullet links the discussion it came
from. These guide judgement when changing core systems and may describe a
destination the current code has not reached; concrete behavior lives in
`current/`.

- **Code-first topology.** Connections between modules and GUI entities already exist in imports, calls, identifiers, and named store access. Connector lines and nodes are discovered views of those relationships—not a second patch-cable data model. [Client brainstorm](history/source-notes/client-brainstorm.md)

- **The GUI is a projection and convenience layer.** It visualizes, navigates, and manipulates semantics defined in code and server state; it does not define those semantics. Individual features—wait highlighting, piano-roll buttons, connector lines—are instances of the general code-to-GUI bridge, not the point of the system. [Stability review](history/stability-review-2026-07.md)

- **The client is editors and monitors.** Editors — the piano roll, parameter panes, and (spiritually the same) the code editors — may be arbitrarily rich UI, but every editor interaction terminates in committed state: store entities and source files that run headlessly without the UI. Monitors — wait highlighting, playheads, signal scopes — watch running state, whether durable entities changing or ephemeral streams, and never feed back into execution. The server/client border is exactly this: edits and explicit actions flow in; committed state and visualization flow out; nothing the client displays is required for the piece to run.

- **Framework power justifies enforceable constraints.** Instrumented livecode is intentionally a constrained TypeScript framework, in the same spirit as React’s Rules of Hooks. Static analysis may prevent Run when a usage pattern would invalidate timing semantics, transformation correctness, source mapping, visualization truth, or another guarantee that gives the framework its power. Hard restrictions must be source-located, actionable, and tied to a named guarantee rather than imposed merely because a pattern is unusual.

- **Architectural inconsistency is normally surfaced rather than prevented.** Findings such as stale dependencies, missing producers, multiple writers, dynamic relationships, absent views, and partially understood connections should remain visible without governing musical intent unless they violate an explicit framework contract. Nothing should fail silently or pretend to be fully understood when it is not. [Stability review](history/stability-review-2026-07.md)

- **Observed state is not an instruction.** A file changed, an agent edited code, analysis succeeded, or a dependency became stale—none of those means “run this.” Launch, replacement, stop, and restart remain explicit. [Project design](history/project-modules-design.md)

- **No baked-in module roles.** “Sketch,” “state,” “modifier,” “conductor,” and “initializer” are patterns of use, not privileged runtime types. The project graph is inferred from ordinary code. [Project design](history/project-modules-design.md)

- **No orchestrated execution order.** An extension of the no-blessed-orchestrator idea: evaluation order is expressed in ordinary code inside a module, and the platform never infers cross-module order — no dependency graph, cook order, or per-timeslice barriers. Cross-module reads of shared state are last-value by contract, with no same-tick coherence promise: same-deadline waits resolve by deterministic scheduler sequence, and module relaunch reshuffles that sequence, so order-sensitive signal composition (accumulators, slews, feedback chains) belongs inside one module, where code order governs. Shared logical time is the coherence mechanism — processes that derive values from the shared clock are phase-coherent by construction regardless of execution order, so prefer pure functions of logical time where possible.

- **Imports carry types and stable tokens; stores carry live values.** Runtime coordination should not depend on object identity or a particular generated module instance. Named string keys survive module reloads. [Stability review](history/stability-review-2026-07.md)

- **Tldraw shapes are views, not entities.** Creating or deleting a shape creates or deletes a view onto underlying state. This also implies separate canvas undo/redo and domain-data undo/redo. [Client brainstorm](history/source-notes/client-brainstorm.md)

- **Ephemeral entities exist to be watched, not to run the piece.** Alongside durable store entities (piece content: persisted, undoable, what saves and in-medium variations operate on), the store carries ephemeral runtime values — playhead positions, LFO outputs, wait counts — published by running code purely so monitors can display them. Execution never depends on them: code never reads another module's ephemeral values (coordination goes through real state), a headless run is complete without them, and publishing must cost so little that an unwatched run behaves identically to a watched one. They are never persisted or undoable, and they end with the run that published them rather than silently freezing.

- **Visualization data is signals, not events.** Ephemeral streams carry latest-value samples with user-defined shapes; there is no platform event tier. Consolidation that matters for an honest display — occurrence lists when several things happen between updates, min/max decimation of fast signals — is piece logic, published by the process as just another value. Intermediate values die server-side under conflating transport, so consolidation could not live anywhere else anyway.

- **The engine executes; UI tabs are disposable chrome.** User code runs in the engine plane — the Deno server process in local mode, or the one designated browser engine tab in the remote and baked topologies. UI tabs must survive reload with nothing lost: anything performance-critical is recoverable from engine truth, and client inference cannot substitute for that truth. The engine tab is not chrome — closing it is killing the engine, exactly like killing the Deno process. (Deliberate restatement 2026-08: this principle originally read "Deno executes"; the browser-engine work moved the boundary from a host to a role.) [Stability review](history/stability-review-2026-07.md), [Browser-engine plan](history/browser-engine-plan-2026-08.md)

- **Runtime activity and document state are separate systems.** High-frequency execution visualization should not mutate tldraw document state or require React/shape updates. [Tldraw discussion](history/initial-runtime/tldraw-init-discussion.md)

- **Agents and humans share one operational surface, but the agent is not a performer.** Both should see the same state and use the same serializable, auditable actions, and anything semantically possible through the UI should ultimately be possible headlessly. The coding agent's role is currently scoped to composition and experimentation speed — writing and wiring modules, operating the tool headlessly as a studio assistant. It is not a co-performer and is not responsible for musical decisions; agent-with-ears (rendering/evaluating musical output) is deliberately deferred. [Stability review](history/stability-review-2026-07.md), [User-level goals](user-level-project-goals.md)

- **Normal files are a product boundary.** Source must remain ordinary filesystem code that agents and external editors can naturally read and write. The environment observes discrepancies between disk, editor, generated, and running state. [Project design](history/project-modules-design.md)

- **A little boilerplate beats magic.** Explicit initialization and lifecycle conventions are preferable when they make module behavior understandable. [Client brainstorm](history/source-notes/client-brainstorm.md)

- **Cross-module synchronization is musical, not metric.** Coordination should support arbitrary generative phase relationships; it should not impose quantized launch, ownership by a conductor, or clean downbeat assumptions. [Stability review](history/stability-review-2026-07.md)

- **Live performance outranks architectural elegance.** Long-running reliability, immediate panic, bounded work, and no stuck notes matter more than a theoretically clean abstraction. [Stability review](history/stability-review-2026-07.md)

- **The environment should be extensible to piece-specific semantics.** Custom monitors and idiosyncratic algorithms can themselves be part of a piece’s identity—not everything needs to become a generic built-in widget. [Runtime brainstorm](history/source-notes/runtime-brainstorm.md)

- **GUI and procedural systems should reinforce each other.** Timeline editors, piano rolls, control signals, event-driven processes, and `TimeContext` loops should form something “more than the sum of its parts,” supporting both frame-time reads and event-triggered reactions. [Client brainstorm](history/source-notes/client-brainstorm.md)

- **Compose privately; perform against stabilized material.** The intended workflow is two-phase: open-ended composition (where schema and data-shape churn belongs, and where agents are used freely) followed by re-posing artifacts into a performance setup — characteristically by building custom live UI over composed code modules. Performance runs with little or no schema change, so safety features are sized for “good enough in the moment,” not engineering-grade completeness. [User-level goals](user-level-project-goals.md)

- **Variations belong in the medium.** Exploring alternatives happens by making variant objects and storing them off in the canvas/stores themselves, not through version-control ceremony outside the system. Whole-project save/save-as is the file-level backstop; richer forking patterns are deliberately undecided. This implies duplicating an entity and copying content between entities should be cheap, generic operations. [User-level goals](user-level-project-goals.md)

- **UI components are two-tier and forkable in session.** Deliberately engineered base components (possibly compiled, reusable beyond this project) meet piece-specific needs through in-session vibe-modification or forking. Because core running state is server-side and the client is locally run, disposable chrome, forking and hot-reloading UI code mid-session without stopping sound is an intended capability, not an accident. Piece-local forks should travel with the piece. [User-level goals](user-level-project-goals.md)

- **Preserve logical-time semantics.** `TimeContext` determinism, structured
  cancellation, drift behavior, and realtime/offline parity are core assets. Do
  not change timing-engine semantics as an incidental livecode fix. Non-engine
  awaits inside timed code require special care because wall-time stalls can
  rebase logical execution.

## System mental model

Think of the environment as four cooperating planes:

1. **Spatial authoring:** tldraw owns camera, layout, selection, drag, resize,
   and shape persistence.
2. **Editor semantics:** CodeMirror owns editor state and Deno LSP owns
   diagnostics, completion, hover, and other language features.
3. **Execution and observation:** Deno owns analysis, generated files, imports,
   logical-time execution, native capabilities, lifecycle truth, and the sync
   transport.
4. **Domain state:** server-side stores own named musical/visual entities.
   Shapes are views onto those entities, not their canonical storage.

Browser UI tabs are control and visualization chrome. User code executes in
the engine plane — the Deno process, or the designated browser engine tab.
Runtime activity should not be encoded into tldraw shape props.

## Static-checking severity

Every analyzer, compiler, or custom static-checking diagnostic must deliberately
declare one of three effects:

1. **Run-blocking framework error:** the code violates a rule required for a
   promised framework capability or for truthful execution/visualization.
2. **Warning-only architectural finding:** the code can participate in the
   framework, but a relationship is inconsistent, risky, stale, only partly
   understood, or impossible to visualize completely.
3. **Explicit-consent lifecycle action:** replacement, restart, destructive
   state changes, and similar operations require affirmative operator intent
   rather than happening as a side effect.

Timing-library restrictions are an existing core example of the first
category. As the environment develops, custom static checks for other libraries
or usage patterns may become important enough to block Run as well. That status
is not limited to compiler errors: a library-specific rule may be enforceable
when obeying it is necessary for the semantics, analysis, or visual affordances
the integration promises. Each such rule must document the guarantee it
protects. A raw or uninstrumented fallback must not silently discard the
framework contract a module opted into.

Hard errors preserve framework soundness. Warnings preserve architectural
legibility. Explicit actions preserve operator control.

Two calibration notes from the project owner:

- Blocking rules are deliberately incomplete. The timing-library rules catch
  common state-mangling pitfalls rather than attempting exhaustive soundness,
  and that is their intended scope. Everything above the blocking tier —
  execution visualization, AST-aware helpers, IDE-like assistance — is best
  effort on a code-first base: the tooling must never limit what plain
  TypeScript can create.
- Static checking is itself part of the HCI layer. Piece- or DSL-specific
  checkers exist to make art-making smoother and less error-prone, so the
  quality bar for any rule is its diagnostic: source-located, actionable, and
  phrased in the domain's terms. If a blocking rule is ever observed to misfire
  on legal code, adding an acknowledge-and-run-anyway override becomes required
  work at that point.

Current state: the implementation does not yet expose this taxonomy as a
first-class concept. Analyzer failures and project typecheck failures are hard
gates in the normal client Run path, dependency/staleness findings are
informational badges, and Replace is the one explicit-consent lifecycle action.
The intended three-way split should become explicit as new detectors and
library-specific checks are added.

## The decided state-ownership question

The question this document long carried — do imports share mutable live values,
or do they carry tokens/types while stores carry values? — is decided: the
"imports carry types and stable tokens" bullet above is the adopted direction,
and the named-entity tier (piano rolls, params, signals) implements it, with
one synthesis the original debate did not anticipate: declarations hand back a
live object or handle for plain-assignment ergonomics while the store owns
identity and lifetime by name. The full rationale is preserved in
[`history/architecture-questions.md`](history/architecture-questions.md).

The generic module-state store the principle implies is not yet built: project
modules still share mutable values with each other through Deno's import cache,
and the p5gpu example relies on it. See the dependency-reload entry in
`current/known-risks.md`.

## Direction of travel

Intentions, not implemented contracts. The 2026-08 transport slice shipped
several long-standing entries from this list — the multiplexed subscribed
transport, the shared protocol package, and per-name change tracking with
serialized entity actions over one entity store. Still ahead:

- the generic module-state store above, so shared mutable state stops being a
  side effect of Deno's import cache;
- an operation/audit log over store actions, and undo/redo generalized beyond
  piano rolls;
- an analyzer detector registry instead of hard-coded wait, piano-roll, params,
  and signal branches, with explicit match confidence and unsupported-pattern
  diagnostics;
- barrier, channel, and event-handler visualization built on that registry;
- an authenticated MCP/action surface (the auth prerequisite is recorded in
  `current/known-risks.md`);
- accurate source mapping for diagnostics produced from transformed shadow
  files;
- per-name sync subscriptions and sub-entity diffs, when scale demands them.

Avoid building new parallel infrastructure that makes these migrations harder.
For architecture-sized work, write a design note in `history/` and confirm the
contract before implementation.

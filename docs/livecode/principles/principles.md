# Livecode principles

Yes—the sharper principles were already present, especially in the [stability review](../history/stability-review-2026-07.md). I diluted them by mixing them with operational concerns.

The other ideas you’ve expressed are:

- **Code-first topology.** Connections between modules and GUI entities already exist in imports, calls, identifiers, and named store access. Connector lines and nodes are discovered views of those relationships—not a second patch-cable data model. [Client brainstorm](source-notes/client-brainstorm.md)

- **The GUI is a projection and convenience layer.** It visualizes, navigates, and manipulates semantics defined in code and server state; it does not define those semantics. Individual features—wait highlighting, piano-roll buttons, connector lines—are instances of the general code-to-GUI bridge, not the point of the system. [Stability review](../history/stability-review-2026-07.md)

- **Framework power justifies enforceable constraints.** Instrumented livecode is intentionally a constrained TypeScript framework, in the same spirit as React’s Rules of Hooks. Static analysis may prevent Run when a usage pattern would invalidate timing semantics, transformation correctness, source mapping, visualization truth, or another guarantee that gives the framework its power. Hard restrictions must be source-located, actionable, and tied to a named guarantee rather than imposed merely because a pattern is unusual.

- **Architectural inconsistency is normally surfaced rather than prevented.** Findings such as stale dependencies, missing producers, multiple writers, dynamic relationships, absent views, and partially understood connections should remain visible without governing musical intent unless they violate an explicit framework contract. Nothing should fail silently or pretend to be fully understood when it is not. [Stability review](../history/stability-review-2026-07.md)

- **Observed state is not an instruction.** A file changed, an agent edited code, analysis succeeded, or a dependency became stale—none of those means “run this.” Launch, replacement, stop, and restart remain explicit. [Project design](../history/project-modules-design.md)

- **No baked-in module roles.** “Sketch,” “state,” “modifier,” “conductor,” and “initializer” are patterns of use, not privileged runtime types. The project graph is inferred from ordinary code. [Project design](../history/project-modules-design.md)

- **Imports carry types and stable tokens; stores carry live values.** Runtime coordination should not depend on object identity or a particular generated module instance. Named string keys survive module reloads. [Stability review](../history/stability-review-2026-07.md)

- **Tldraw shapes are views, not entities.** Creating or deleting a shape creates or deletes a view onto underlying state. This also implies separate canvas undo/redo and domain-data undo/redo. [Client brainstorm](source-notes/client-brainstorm.md)

- **Deno executes; the browser is disposable chrome.** Music and visuals should survive a browser reload. Anything performance-critical must be recoverable from server truth, and client inference cannot substitute for that truth. [Stability review](../history/stability-review-2026-07.md)

- **Runtime activity and document state are separate systems.** High-frequency execution visualization should not mutate tldraw document state or require React/shape updates. [Tldraw discussion](../history/initial-runtime/tldraw-init-discussion.md)

- **Agents and humans share one operational surface, but the agent is not a performer.** Both should see the same state and use the same serializable, auditable actions, and anything semantically possible through the UI should ultimately be possible headlessly. The coding agent's role is currently scoped to composition and experimentation speed — writing and wiring modules, operating the tool headlessly as a studio assistant. It is not a co-performer and is not responsible for musical decisions; agent-with-ears (rendering/evaluating musical output) is deliberately deferred. [Stability review](../history/stability-review-2026-07.md), [User-level goals](../user-level-project-goals.md)

- **Normal files are a product boundary.** Source must remain ordinary filesystem code that agents and external editors can naturally read and write. The environment observes discrepancies between disk, editor, generated, and running state. [Project design](../history/project-modules-design.md)

- **A little boilerplate beats magic.** Explicit initialization and lifecycle conventions are preferable when they make module behavior understandable. [Client brainstorm](source-notes/client-brainstorm.md)

- **Cross-module synchronization is musical, not metric.** Coordination should support arbitrary generative phase relationships; it should not impose quantized launch, ownership by a conductor, or clean downbeat assumptions. [Stability review](../history/stability-review-2026-07.md)

- **Live performance outranks architectural elegance.** Long-running reliability, immediate panic, bounded work, and no stuck notes matter more than a theoretically clean abstraction. [Stability review](../history/stability-review-2026-07.md)

- **The environment should be extensible to piece-specific semantics.** Custom monitors and idiosyncratic algorithms can themselves be part of a piece’s identity—not everything needs to become a generic built-in widget. [Runtime brainstorm](source-notes/runtime-brainstorm.md)

- **GUI and procedural systems should reinforce each other.** Timeline editors, piano rolls, control signals, event-driven processes, and `TimeContext` loops should form something “more than the sum of its parts,” supporting both frame-time reads and event-triggered reactions. [Client brainstorm](source-notes/client-brainstorm.md)

- **Compose privately; perform against stabilized material.** The intended workflow is two-phase: open-ended composition (where schema and data-shape churn belongs, and where agents are used freely) followed by re-posing artifacts into a performance setup — characteristically by building custom live UI over composed code modules. Performance runs with little or no schema change, so safety features are sized for “good enough in the moment,” not engineering-grade completeness. [User-level goals](../user-level-project-goals.md)

- **Variations belong in the medium.** Exploring alternatives happens by making variant objects and storing them off in the canvas/stores themselves, not through version-control ceremony outside the system. Whole-project save/save-as is the file-level backstop; richer forking patterns are deliberately undecided. This implies duplicating an entity and copying content between entities should be cheap, generic operations. [User-level goals](../user-level-project-goals.md)

- **UI components are two-tier and forkable in session.** Deliberately engineered base components (possibly compiled, reusable beyond this project) meet piece-specific needs through in-session vibe-modification or forking. Because core running state is server-side and the client is locally run, disposable chrome, forking and hot-reloading UI code mid-session without stopping sound is an intended capability, not an accident. Piece-local forks should travel with the piece. [User-level goals](../user-level-project-goals.md)

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

One important unresolved architecture question remains:

- The early brainstorm uses direct imports of shared mutable values; the later principle says imports should carry tokens/types while stores carry values.

That state-ownership question is tracked in
[`architecture-questions.md`](architecture-questions.md).

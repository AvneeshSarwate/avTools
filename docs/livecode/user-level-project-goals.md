# User-level project goals

Role of this document: the product-design and workflow guide for the livecode
environment. It records intended user-facing flows, the creative process the
tool serves, the coding agent's role, and explicit non-goals. It deliberately
stays at the "what this should feel like to use" level.

Its counterpart is
[`docs/livecode/principles.md`](principles.md),
which records architecture principles with strong HCI implications and the
rules to follow when changing core systems. Consult this document when
designing or changing user-facing behavior; consult the principles when
touching core systems. If the two seem to conflict, surface the conflict; do
not silently pick one.

## What this is

I want to build a canvas-based livecoding environment for music and graphics.
The code editor is in the canvas, and uses projectional-editing-style
techniques to visualize code execution in a way that can help with both
creative exploration and live performance. The canvas also acts as a
game-engine-like authoring environment, showing interactive views of live data
(e.g., a piano roll you can edit while a code module is actively playing music
from the melody instance bound to that piano roll view). I want to leverage
TypeScript compiler extensions to allow for automatic instrumentation of
different data structures or library usage patterns, enabling better visualization
of program state (e.g., how the timing-library detection is done to drive wait 
visualization, or the cmd-click on store functions to show the named entity).
The typescript compiler extensions can also enable custom analysis that allows the
system to express constraints around library usage that can protect users from
state-mangling pitfalls in an open-ended livecoding environment. The system
should also have an API accessible to a coding agent, so that composing and
experimenting can move faster (see "Coding agent role" below).

I want a canvas-based tool so you can:

- look at multiple code modules at once (because their running might have
  interactions)
- see code and visualizations/UI of the underlying data at the same time

The bigger idea behind the piano-roll example: GUI-composed things (piano
rolls, timeline editors, control signals) and procedural things (TimeContext
loops, event-driven processes) should compose bidirectionally — render loops
can read GUI-authored values at frame time, and musical processes can react to
events/changes from the GUI, while code can also write back into those GUI
views. The goal is that the GUI-authored and code-authored halves of a piece
act on each other, forming an instrument that is "more than the sum of its
parts" — something neither a DAW nor a pure-code livecoding language gives you.

## The core workflow: compose privately, then re-pose for performance

The intended creative loop has two modes with different stakes:

- **Composition (private).** Open-ended experimentation: writing modules,
  reshaping data, trying library patterns, breaking things. Schema and
  data-shape churn belongs here, where breakage is cheap and private. Coding
  agents are used freely here for speed.
- **Re-posing for performance.** Composition artifacts get re-arranged into a
  performable setup. The characteristic activity is building new custom live
  UI — trigger surfaces, monitors, control panels — over the processes that
  were added as code modules during composition.
- **Performance (public).** Runs against stabilized material: little or (ideally)
  no schema change. Restructuring mid-performance means launching, stopping,
  and editing modules and driving custom UI — not redesigning data shapes.

The safety posture follows from this split: the system needs **good-enough
safety for in-the-moment performance**, not robust always-correct guardrails
from an engineering perspective. Risky exploration happens in the composition
phase; the performance phase inherits material that has already been played
with.

## Code-first, best-effort projection

The base of the system is "make anything you can with normal code": plain
TypeScript with the full flexibility of ordinary programming. On top of that
base, the environment layers as much projectional-editing-style interaction,
visualization, and guardrail support as possible via TypeScript compiler
extensions — but that layer is explicitly **best effort**. The tooling must
never limit what plain code can create.

There are two deliberate tiers of static support:

- **Intentionally blocking safety rules.** The timing-library restrictions are
  the core example. They are knowingly incomplete — they catch common
  problematic usages rather than attempting exhaustive soundness — and that is
  their intended scope.
- **Best-effort everything else.** AST-aware helper features, execution
  visualization, and IDE-like assistance make no completeness promises.

Static checking is itself part of the HCI layer, not just engineering hygiene:
piece- or DSL-specific checkers may be added later (e.g., a custom DSL whose
checker helps make art with it more smoothly, without technical mistakes). The
quality bar for any rule is its diagnostic: source-located, actionable, and
phrased in the domain's terms. If a blocking rule is ever observed to misfire
on legal code, adding an acknowledge-and-run-anyway override becomes required
work at that point — deferred until it actually happens.

## Stores and views: grow your own projectional system per piece

The separation between server-side stores and canvas views exists so that
**visualizations can always be added as you need them**. This is not a complete
projectional editing system; it is a framework/setup for building one as you
go, best-effort and idiosyncratic to your specific composition or performance.
You can vibe-code custom "live monitors" and idiosyncratic visualizations for
the processes specific to a piece — the idiosyncratic algorithm/visualization
IS part of the piece's identity, and not everything needs to become a generic
built-in widget.

## A piece is anything the project format can store

The whole point of the project format is that a piece can be any combination of
data and code — both execution code and UI code for data formats. The piano
roll is just one example of a data format plus its UI, not a privileged
built-in. Registered durable store entities can be explicitly captured in the
project format alongside code; ephemeral observation state is excluded.

Everything made with this tool should still "just run" as normal software —
plain TypeScript files on disk that execute headlessly without the editor. The
interactive canvas/editor environment is a layer that works on top of ordinary
code, not a container the code is trapped inside. This also means external
editors and coding agents can read/write a piece naturally.

## Variations live in the medium

The point of the canvas flow is that you can make variations on objects and
store them off **in the canvas/stores themselves**, rather than managing
versions outside the system. Exploring alternatives is a spatial, in-medium
activity, not a version-control ceremony. At the file level, ordinary
save/save-as project semantics are enough; whether richer granular
forking/versioning patterns are wanted is deliberately undecided (see deferred
decisions).

## UI components: engineered base, forked in session

Custom UI has a deliberate two-tier economy:

- **Base components** are engineered carefully and may be heavyweight on
  purpose (e.g., the compiled piano-roll webcomponent) because they are meant
  to be reusable in contexts beyond this project. Building significant base
  components takes real time, and that is acceptable.
- **Piece-specific needs** are met by vibe-modifying or forking base components
  in-session, rather than by every need becoming a new engineered component.

This is viable because all core running state is headless (server-side) and
everything runs locally: the client is disposable chrome that can hot-reload or
fully reload without stopping sound, so UI code can be forked and reloaded
mid-session. Protocol/code complexity in the view layer is acceptable — coding
agents have already managed these protocols well (e.g., the animation editor,
which follows protocols similar to the piano roll's), and the codebase can be
simplified with helper libraries later as needed. An open convention question:
piece-local forks should probably travel with the piece so the piece stays
self-contained, keeping shared base components clean.

## Coding agent role

The coding agent is a **composition and experimentation accelerator, not a
performer**. Agent access to the system exists for moving faster while
composing and experimenting: writing and refactoring modules, wiring up UI
components and protocols, introspecting live program state, and operating the
tool headlessly. Anything the UI can do should be reachable headlessly so that
an agent can act as a studio assistant on the same state and actions a human
uses.

The agent is **not currently responsible for musical decisions**. Designs
should not assume an agent that listens to, evaluates, or autonomously steers
musical output ("agent-with-ears") — that is deliberately deferred. If older
text elsewhere describes the agent as a co-performer, this document wins.

## Performance capabilities

Things the system should enable for the user (unchanged intents):

- **Restructure a running piece mid-performance:** any module can be stopped,
  edited, and relaunched without restarting the rest, because modules
  coordinate through shared server-side state rather than importing each
  other's live values.
- **Cross-module synchronization that is musical, not metric:** generative
  voices can hold arbitrary phase relationships with each other — no forced
  quantized launch, no conductor module, no clean-downbeat assumptions. The
  platform stays unopinionated here: the timing library provides the shared
  timing context and synchronization primitives, and re-entry/sync discipline
  is composition content built from those primitives, not platform policy.
- **Live or offline, the same piece:** a piece can run live or render
  deterministically offline (faster than realtime, seeded RNG), so a piece is
  both a performance instrument and a renderable artifact.
- **Piece-specific extensibility:** custom monitors and idiosyncratic
  visualizations as part of the piece's identity (see stores-and-views above).

## Non-goals and deliberately deferred decisions

Non-goals (do not design toward these):

- Robust, always-correct guardrails at an engineering level of rigor.
- The agent as an autonomous musical performer or musical decision-maker.
- External version-control workflows as part of the core creative loop.
- Academic-publication framing; research literature is a source of useful
  design dimensions, not a target audience.

Deliberately deferred decisions (do not fill these in without owner input):

- Save granularity: normal project save/save-as vs. more granular forking
  patterns.
- Whether entity persistence needs take/snapshot gestures beyond the current
  explicit whole-project save.
- The convention for where piece-local component forks live.
- Everything about agent-with-ears (rendered-audio feedback loops for agents).

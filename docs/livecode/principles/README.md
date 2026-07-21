# Livecode Principles and Mental Models

## Documents in this directory

- `principles.md` preserves the sharper product and architectural principles
  identified by the project owner. Treat it as the primary principles document.
- `architecture-questions.md` contains unresolved design questions. Its options
  and recommendations are discussion material, not adopted decisions.
- `source-notes/` contains preserved raw brainstorms.

The remainder of this README is an earlier synthesis. Where its framing differs
from `principles.md`, use `principles.md`; where an issue appears in
`architecture-questions.md`, do not assume it has been decided.

This document is normative design intent. It explains how to make judgement
calls, not every detail of how the current implementation happens to work.
Concrete behavior lives under `docs/livecode/current/`.

## Product thesis

The environment explores a specific bridge between typed code and spatial GUI:
static analysis recognizes semantically meaningful constructs in user
TypeScript, generated instrumentation observes their runtime values, and the
client anchors useful controls or visualization back to exact source ranges.

Current examples are active-wait highlighting and piano-roll lookup buttons.
They are instances of the pattern, not special cases that should define the
eventual architecture. Future instances may include signals, channels,
barriers, event handlers, state machines, connector lines, and piece-specific
live monitors.

## System mental model

Think of the environment as four cooperating planes:

1. **Spatial authoring:** tldraw owns camera, layout, selection, drag, resize,
   and shape persistence.
2. **Editor semantics:** CodeMirror owns editor state and Deno LSP owns
   diagnostics, completion, hover, and other language features.
3. **Execution and observation:** Deno owns analysis, generated files, imports,
   logical-time execution, native capabilities, lifecycle truth, and runtime
   snapshots.
4. **Domain state:** server-side stores own named musical/visual entities.
   Shapes are views onto those entities, not their canonical storage.

The browser is control and visualization chrome. User code executes in Deno.
Runtime activity should not be encoded into tldraw shape props.

## Decision principles

### Live performance first

The server is expected to survive long sessions. Prefer failure isolation,
bounded work, explicit panic paths, deterministic behavior, and visible errors.
Avoid changes that can crash the Deno process, leave MIDI notes sounding,
silently stop updating, or make the edit loop stall behind expensive work.

### Server truth beats client inference

A browser can reload while code continues running. State needed to recover the
performance must be obtainable from the server. The client may cache state for
rendering, but a reconnect must rehydrate run identity, lifecycle, manifests,
and shared objects from server truth.

Current qualification: project canvas layout is persisted in the project
manifest, but freeform non-project `.tldr` canvas state is client/file state.

### No-surprise execution

Editing, writing to disk, analyzing, detecting staleness, and materializing
runtime files are not permission to launch or replace code. Run, stop, replace,
panic, and any future restart operation are explicit actions. Replacement of an
active module is opt-in through `replaceRunning: true`.

### Framework constraints and static-checking severity

Instrumented livecode is intentionally a constrained TypeScript framework, in
the same spirit as React's Rules of Hooks. The analyzer may prevent Run when a
pattern would invalidate timing semantics, transformation correctness, source
mapping, visualization truth, or another explicit framework guarantee.
Sacrificing some language flexibility is permissible when it enables a more
powerful and reliable visual environment.

Every static finding must deliberately be classified as:

- a **run-blocking framework error** tied to a documented guarantee;
- a **warning-only architectural finding** that informs without governing
  musical intent; or
- an **explicit-consent lifecycle action** for replacement, restart, or other
  consequential operations.

Timing-library usage restrictions are an existing core instance. Future custom
static checking for other libraries or important usage patterns may also be
run-blocking when their integration guarantees depend on obeying those rules.
Blocking is therefore not limited to ordinary TypeScript compiler failures.
Each hard rule must be positioned, actionable, and explain the capability or
semantic invariant it protects.

Unsupported detectable behavior must never silently produce incomplete or
misleading visualization. Warning-only findings must remain conspicuous, and a
raw/uninstrumented fallback must not silently discard a framework contract the
module opted into.

Current qualification: the implementation does not yet expose this complete
three-way taxonomy. Analyzer failures and project typecheck failures are hard
gates in the normal client Run path, while dependency/staleness findings are
informational badges. The intended split should become explicit as new
detectors and library-specific checks are added.

### No blessed orchestrator

There should not be a privileged conductor module type. Independent runnable
modules coordinate through explicit APIs and shared server-side state.
Imports should increasingly carry types and stable tokens; stores should carry
live values. A token's identity should be a serializable key, not object
identity, because generated modules are imported under changing URLs.

Current qualification: project modules still import shared mutable values from
other project runtime modules, and the p5gpu example relies on this. The
token/store model is a direction of travel, not yet a universal invariant.

### Agents are first-class operators

Human and automated operators should act on the same state and through explicit,
serializable actions. Commands should be auditable and return server truth.
Anything required for headless operation should not require clicking tldraw.

Current qualification: the system has HTTP APIs and a server-to-browser command
bridge, not the planned authenticated MCP/action-log surface.

### Keep hot runtime data out of broad state

tldraw state is for document/layout data. High-frequency runtime updates belong
in dedicated stores and CodeMirror decorations. React may coordinate component
lifecycle, but should not be the eventual high-frequency event bus.

Current qualification: the livecode snapshot client currently copies every
changed server snapshot into React module state before CodeMirror receives new
decoration props. The server limits this to changed snapshots at about 30 Hz,
but the older direct-editor-update design has not been preserved in the tldraw
client.

### Preserve logical-time semantics

`TimeContext` determinism, structured cancellation, drift behavior, and
realtime/offline parity are core assets. Do not change timing-engine semantics
as an incidental livecode fix. Non-engine awaits inside timed code require
special care because wall-time stalls can rebase logical execution.

### Local and trusted is an explicit assumption

The current server runs user code with broad Deno permissions and exposes
unauthenticated mutation and execution routes with permissive CORS. It is a
loopback, trusted-workstation tool. Do not expose it on an untrusted interface.
Authentication/session-token work is a prerequisite for a remotely reachable
or MCP-facing service.

## Preferred direction of travel

These are intentions, not implemented contracts:

- a unified `(entityType, entityId)` server store with serializable actions,
  dirty tracking, undo/redo, and an operation log;
- one multiplexed snapshot/patch transport with subscriptions, sequence
  numbers, reconnect, and full-state rehydration;
- an analyzer detector registry instead of hard-coded wait and piano-roll
  branches;
- barrier, signal, channel, and event visualization built on that registry;
- an authenticated MCP/action surface;
- one shared protocol package consumed by Deno and Vite;
- accurate source mapping for diagnostics produced from transformed shadow
  files.

Avoid building new parallel infrastructure that makes those migrations harder.
For architecture-sized work, write a current design note and confirm the new
contract before implementation.

## Preserved source notes

The unedited brainstorming inputs live in `source-notes/`. They contain useful
ideas and owner language, but also open questions and older assumptions. They
are not required to learn the current system:

- `source-notes/client-brainstorm.md`
- `source-notes/runtime-brainstorm.md`

# Browser-Engine Support Plan (2026-08)

Status: design note / investigation, per the principles-doc rule that
architecture-sized work starts as a design note in `history/` and confirms the
contract before implementation. Nothing in this document is implemented except
where explicitly noted (`packages/midi` exists). Written 2026-08-18 against the
2026-08-13 current-state docs.

## Goal

Add first-class support for running the livecode **engine** in a browser tab.
It is the user's responsibility to keep custom-module dependencies
browser-friendly; the platform's job is to make the engine itself, module
delivery, and the observation/control planes work when the executing process is
a browser tab instead of the Deno server.

Two target setups, from `next-stuff-brainstorm.md`:

- **Setup A — baked project.** A project is compiled into a static bundle whose
  custom code modules are no longer editable. The engine runs in one tab, the
  UI in another tab on the same machine, served from the same origin,
  communicating over the BroadcastChannel API. No server at all.
- **Setup B — dynamic remote dev.** Modules are dynamically added, edited, and
  removed exactly like today, but the engine happens to run in a browser tab.
  Engine and UI tabs still talk over BroadcastChannel on the same machine; a
  small coordination server handles module updates from the UI and the coding
  agent. The coordination server and the agent run on a cloud container —
  concretely, on Cloudflare — so the current agent-assisted composition
  workflow works against a remote box while sound and visuals run locally in
  the browser.

Setup B is the current priority. The plan below designs B so that A falls out
of the same components (see "Setup A as a subset").

## What "the engine" is: splitting the current server

Today `visualizer/server.ts` fuses two roles that this work must separate:

| Plane | Responsibilities (from `current/server.md`) | Needs |
| --- | --- | --- |
| **Execution plane ("engine")** | parent `TimeContext` loop, launch queue and pending launches, dynamic import of generated modules, active-module lifecycle and run records, `runtime.ts` instrumentation singletons (waits/lookups, root clock), `entity_store.ts` + piano-roll/params/signals stores, `SyncSourceRegistry` and the one 33 ms broadcast tick, MIDI/GPU capabilities, panic | a JS runtime with timers, dynamic `import()`, and the piece's I/O capabilities |
| **Coordination plane** | project directory + manifest CRUD, `*.orig.ts` writes and runtime-file materialization, analyzer transform invocation, shadow `deno check`, LSP proxy processes, session directories, serving/relaying to clients | a filesystem, subprocesses (`deno lsp`, `deno check`), and network reachability for the agent and UI |

The execution plane is almost entirely portable TypeScript already (audited
below): the stores, sync sources, and runtime singletons are in-memory
module-level state with no route dependencies (`server.md` notes run records
are the one piece living on the server object, accessed through
constructor-injected accessors — exactly the shape extraction wants). The
coordination plane is intrinsically Deno-on-a-real-OS: it spawns processes and
owns files.

### Portability audit (code-verified 2026-08-18)

**Already pure JS/TS — no host APIs beyond `Date.now`/`structuredClone`/
`crypto.randomUUID`/`JSON`, all browser-native:** `entity_store.ts`,
`runtime.ts`, `params_store.ts`, `signals_store.ts`, `piano_roll_store.ts`,
`sync_sources.ts`, `entity_registry.ts` (computes data-file path *strings*
only; no I/O), `generated_run_id.ts`, `helpers/canvas_params.ts`,
`helpers/canvas_signals.ts`, `helpers/midi_math.ts`, and all of
`packages/livecode-protocol`. The entire entity/observation core moves into
`packages/livecode-engine` without modification.

**`@avtools/core-timing` is fully browser-safe and already browser-proven.**
Zero Deno/Node APIs; scheduling is `globalThis.setTimeout` (injectable —
`opts.setTimeout` is a first-class DI seam), `performance.now()`, and a
`MessageChannel` macrotask fallback for browsers. `waitFrame` guards on
`requestAnimationFrame` with a clear error, and `BrowserTimeContext` /
`launchBrowser` already exist alongside the `DateTimeContext`-rooted `launch`
the server's parent loop uses (`server.ts:344–362`). `apps/browser-projections`
consumes the raw `.ts` source through vite aliases in ~30 call sites. A
browser engine's parent loop is therefore the *same* library with the browser
entry point — and `ctx.waitFrame` becomes natively available, which it is not
under the Deno host.

**One hard blocker: `helpers/midi_helpers.ts`.** It imports the raw Deno FFI
bridge (`apps/deno-notebooks/midi/mod.ts` → `Deno.dlopen` of the Rust `midir`
dylib) and opens MIDI **eagerly at module import time**
(`midi_helpers.ts:111–136`, top-level statements). Anything that transitively
imports the `midi-helpers` alias pays that cost — including `server.ts` itself
via its `panicMidi` import. It does not yet use the isomorphic
`@avtools/midi` package (grep confirms zero references from livecode), but the
pieces are in place: `@avtools/midi` sniffs `navigator.requestMIDIAccess` and
dynamically imports the browser (MIDIVal) or native (same FFI bridge) backend,
with the native specifier `@vite-ignore`d precisely so bundlers never see the
FFI graph; and `midi_helpers.ts` already has an injectable
`MidiOutputTransport` seam (`__testingRegisterMidiOutput`). The rework is:
rebase the device registry / sounding-note tracking / panic on
`@avtools/midi`, and make opening lazy and (in the browser) gesture-gated,
since Web MIDI is permission-prompted.

**Nearly pure: `helpers/piano_roll_helpers.ts`.** Its one Deno edge is guarded
(`Deno.env.get("LIVECODE_MIDI_OUTPUT")` in a try/catch) and its one FFI edge
is a deliberate lazy `import("./midi_helpers.ts")` taken only when
`playPianoRoll` runs without an explicit output — it inherits whatever the
MIDI rework produces.

**Graphics and tools, per the user-modules-must-be-browser-friendly rule:**

- Pure WebGPU/WGSL, browser-clean: `packages/shader-fx`, `packages/power2d`,
  `packages/compute-shader` (zero `Deno.*` hits), plus
  `tools/text_on_path.ts`, `ntsc_vhs_gpu.ts`, `contour_spring.ts`,
  `contour_smoother.ts`, `paramSystem.ts`, `tweakpane*.ts`.
- Mostly portable: `tools/p5gpu.ts` is WebGPU + `earcut` with two desktop
  edges — `Deno.readFile` in `loadFont` and the lazy, try/catch-degraded
  native text engine.
- Desktop-only, unavailable in a browser engine by design: `window/` and
  `syphon/` (FFI), `tools/osc.ts` (`node-osc` UDP), `tools/macros.ts`
  (imports `window/`), the `*_deno_shim.ts` files (which exist to adapt
  browser libraries *to* Deno and are simply unnecessary in the browser
  direction).

**Proposed extraction: `packages/livecode-engine`.** Move the execution plane
into a workspace package with the same raw-TS consumption story as
`@avtools/livecode-protocol` and `@avtools/core-timing` (both already compile
into the browser through vite aliases). The package exposes one
`createLivecodeEngine(capabilities)` factory; capabilities are injected:

- `importModule(uri, launchId)` — dynamic import (Deno: file/http URL;
  browser: same-origin URL);
- MIDI backend — the isomorphic `@avtools/midi` package **already added on
  this branch** (browser backend over Web MIDI via MIDIVal, native backend
  over the existing Rust `midir` bridge, one API);
- clock/scheduler — whatever `@avtools/core-timing` needs beyond standard
  timers (it already runs in the browser in `apps/browser-projections`);
- log sink.

Two hosts wrap it:

- **Deno host** — the current server, refactored to hold an engine instance
  next to the coordination plane. Behavior-preserving: every existing route
  and test keeps passing. This is a pure refactor and the riskiest-feeling but
  most mechanical step.
- **Browser host** — a new page (say `/engine`) in `apps/livecode-tldraw` (or
  a sibling app) that instantiates the engine in a tab and connects the two
  transports below.

## Setup B topology

```text
┌─ user's machine ────────────────────────────────┐   ┌─ Cloudflare ─────────────────────────┐
│  engine tab (/engine)                           │   │  Worker (front door, static assets,  │
│    livecode-engine: TimeContext loop, stores,   │   │   Cloudflare Access auth)            │
│    sync tick, dynamic import, WebMIDI, WebGPU   │   │        │ Durable Object routing      │
│      ▲            │                             │   │        ▼                             │
│      │ Broadcast  │ WS "engine uplink" ─────────┼───┼──► container (Sandbox SDK / Deno)    │
│      │ Channel    ▼                             │   │      coordination server:            │
│  UI tab(s) (tldraw client)                      │   │        project files, analyzer,      │
│    editors, panes, rolls, scopes                │   │        transpile/bundle, deno check, │
│      │ HTTP/WS for files, analysis, LSP ────────┼───┼──►     LSP proxy                     │
└─────────────────────────────────────────────────┘   │      coding agent (Claude Code etc.) │
                                                      │        edits *.orig.ts, calls HTTP   │
                                                      └──────────────────────────────────────┘
```

### The two transports

**1. BroadcastChannel plane (engine tab ↔ UI tabs, same origin, same
machine).** Carries exactly the envelopes that already exist in
`@avtools/livecode-protocol`:

- the `/sync` `SyncMessage`/`SyncSubscribeMessage` envelope, unchanged — the
  engine runs the same 33 ms tick and fans changed entities out per subscriber
  (each UI tab gets a private `MessageChannel`-style addressing scheme layered
  on one named BroadcastChannel, or per-tab channels named by a handshake);
- a new request/response envelope for the actions that are HTTP POSTs today:
  launch/stop/stop-all/panic, `/piano-roll/set|undo|redo`, `/params/set`,
  `/entities/*`, `/runtime/state` rehydration reads.

The client already has clean seams for this: `syncRuntime.tsx` owns the one
socket and the write actions, and `serverRequests.ts` is the single home of the
HTTP helpers. A `LivecodeTransport` interface with two implementations —
`WebSocketTransport` (today's behavior, unchanged) and
`BroadcastChannelTransport` — slots in at those two seams without touching
shapes, hooks, or the run-dedupe rule. Reconnect semantics carry over: a UI tab
(re)subscribes and takes `resets`, identical to a WS reopen.

**2. Engine uplink (engine tab ↔ coordination server, WebSocket).** This is
the `/client/control` pattern pointed the other way, generalized: the server
already knows how to accept an HTTP command, forward it to a connected browser
over a WS, and await the result with a bounded timeout. The engine tab
registers on a `/engine/uplink` socket, and the server:

- **forwards runtime and entity mutations** arriving over HTTP (from the
  agent, tests, or any headless caller) to the engine and returns the result —
  so the entire existing agent surface (`/runtime/*`, `/piano-roll/*`,
  `/params/*`, `/entities/*`) keeps its contract with one added hop;
- **pushes module-update notifications** after `/project/modules/write` +
  materialization, so the engine (and UI, via its own channel) learn new
  builds exist;
- **receives a state mirror** from the engine — entity changes and run records
  at a decimated rate (the 33 ms tick stays local; the uplink can ship at
  ~2–5 Hz or on-change-with-floor) — so `GET /piano-roll/list`,
  `/params/list`, `/signals/list`, `/runtime/state`, and `/runtime/status`
  answer from the mirror and the agent's read surface also survives
  unchanged. `/project/save` serializes durable entities from a fresh
  synchronous snapshot request over the uplink rather than the mirror, so a
  save stays point-in-time coherent.

If no engine is attached, forwarded routes answer with an explicit
"no engine connected" error — the same operational shape as "server not
running" today.

**The relay path is a kept mode, not scaffolding (decided 2026-08-18).**
Routing sync through the server is both the staging step *and* a permanent
topology: a UI tab on a different machine than the engine — concretely, an
iPad control surface on the LAN while the coordination server runs on the
laptop and the engine in the laptop's browser, a live-performance setup with
no cloud involved at all. BroadcastChannel exists because the steady-state
30 Hz observation loop should not cross the WAN when both tabs share a
machine: it keeps the hot path local, cloud egress near zero, and
scope/playhead latency at local-frame timescales. So the client keeps both
transports — BroadcastChannel when a local engine is present, relay
otherwise — and Stage 1 ships the relay first because it needs no new client
transport.

### Module delivery to a browser engine

Browsers execute JS, not TS, and cannot read `file:` URLs, so the coordination
server grows a **browser build step** after materialization:

1. **Transpile** each materialized runtime `*.ts` (and each transient generated
   file) to ESM JS — type stripping only, via esbuild (the tool Vite already
   embeds) or `@deno/emit`. Serve the results at stable same-origin URLs:
   `/engine-assets/project/modules/state.js`, mirroring `runtimePath`.
2. **Keep relative imports relative.** `import { state } from "./state.ts"`
   is rewritten to `./state.js` at transpile time. Because URLs are stable,
   the browser's module cache retains dependency instances across entry
   relaunches — the *same* semantics (and the same P1 dependency-reload
   caveat from `known-risks.md`) as Deno's module cache today. The launch
   mechanics carry over directly: the server currently imports
   `transformedModuleUri + "?launch=<uuid>"` purely as a cache-buster
   (`server.ts:2507–2513`), and `import()` of a fresh query re-runs the entry
   identically in a browser.
3. **Resolve import-map aliases** via a real browser **import map** in the
   engine page. The five livecode aliases are already plain relative-path
   mappings to portable modules (root `deno.json:50–54`), and the
   `@avtools/*` packages map to local `.ts` sources, so the browser build has
   concrete, enumerable inputs: pre-bundle each aliased module once from the
   workspace and map the alias to that asset. The handful of npm/jsr deps the
   portable graph reaches (`earcut`, `seedrandom`, `wgsl_reflect`,
   `@midival/core`, `@img/png`…) bundle cleanly. Bare npm specifiers a user
   module pulls in are bundled per-module with the alias set marked external;
   a `node:` or FFI-touching specifier fails the browser build with a
   source-located diagnostic — the concrete form of "browser-friendly deps
   are the user's job".
4. **One stable runtime-helpers URL.** The generated import of
   `visualizedAwait`/`visualizedPianoRollLookup`/`visualizedOwnedSignal`
   already takes the target URL as a transform parameter (`runtimeImport`,
   `analyze_transform.ts:197–198`); the server currently passes its own
   absolute `file://` URL of `visualizer/runtime.ts`
   (`server.ts:1473`, `:2309`) — which is why committed example runtime files
   contain machine-absolute paths, a fragility this work removes. A browser
   build passes the engine page's stable `/engine-assets/runtime.js` instead.
   The singleton requirement ("every generated run must share the same
   process-global count/lookup/ownership state",
   `analyzer-and-generated-code.md`) is satisfied per-tab by URL stability,
   same as per-process today.

Analysis, diagnostics, shadow `deno check`, and LSP do not move: they already
run against `*.orig.ts` on the server and are engine-agnostic.

### Target-aware typechecking (verified 2026-08-18, Deno 2.9.5)

Good typechecking is a core principle, so the Run gate should check against
the world the module will actually execute in. The mechanism is cheap, and the
three load-bearing behaviors were verified by experiment:

1. **One config knob flips the type world.** `deno check` with
   `compilerOptions.lib: ["esnext", "dom", "dom.iterable",
   "dom.asynciterable"]` makes `Deno.*` a type error
   (`TS2304 Cannot find name 'Deno'`) and DOM globals legal; the default lib
   is the exact reverse. So a browser-target project checks against browser
   truth by giving the shadow tree a generated config with the
   target-appropriate `lib` — the import-map merge logic this needs already
   exists in the LSP proxy's synthetic-workspace builder.
2. **WebGPU needs nothing extra.** `navigator.gpu` / `GPUDevice` already
   typecheck under the plain `dom` lib in current Deno.
3. **Dynamic imports behave exactly as needed.** A *string-literal*
   `import("./x.ts")` is followed into the checked graph, but a
   *variable-specifier* dynamic import is not — which is precisely the
   pattern `@avtools/midi/mod.ts` already uses to keep the FFI backend out of
   browser bundles, and it keeps it out of browser-target typechecks for
   free.

The knob is fed by a project-level target declaration (a manifest field,
`engineTarget: "deno" | "browser"`), and the same `lib` override goes into the
LSP proxy's workspace config so editor diagnostics agree with the Run gate.

What (3) also reveals is the real work item: the **portable helper graph must
be browser-lib-clean**, because any reachable `Deno.` reference — even a
runtime-guarded one — is a type error under browser lib. Concretely:
`piano_roll_helpers.ts`'s try/catch-guarded `Deno.env.get` needs a
`globalThis`-probed form, and its string-literal lazy
`import("./midi_helpers.ts")` currently drags the whole FFI-typed MIDI graph
into the check — fixed by the already-planned rebase onto `@avtools/midi`,
whose backend split was designed for exactly this. Both are mechanical, and
both belong to phase 1.

An engine advertises what it is: `/health`'s `runtimeCapabilities` (already on
the wire) gains `engineKind: "deno" | "browser"` plus capability flags (midi,
webgpu, ffi/window), so the UI can label the connection and the analyzer can
optionally warn when a module imports a capability the attached engine lacks —
a warning-tier finding, not a block, per the static-checking severity taxonomy.

### Capabilities in a browser engine

- **MIDI** — solved in principle by `packages/midi` (already on this branch):
  one API, Web MIDI backend in the browser, `midir` FFI backend in Deno. The
  audit above records the blocker and the rework: livecode's
  `midi_helpers.ts` still eagerly opens the FFI bridge at import time and
  must be rebased onto `@avtools/midi` with lazy, gesture-gated opening so
  instrumented modules and `panicMidi()` work identically on both engines.
  Web MIDI is window-scoped and permission-gated; Chrome is the reliable
  target (Firefox supports it; Safari does not).
- **Graphics** — WebGPU is browser-native; the browser engine is arguably the
  *better* host for `webgpu-graphics` work (`shader-fx`, `power2d`,
  `compute-shader` are already pure WebGPU/WGSL, and modules gain a real DOM
  canvas plus working `ctx.waitFrame`). Desktop-only capabilities (FFI
  windowing, Syphon, `node-osc`) are simply absent; modules that import them
  are Deno-engine-only, surfaced by the capability flags above.
- **Timing** — the engine's parent loop is `@avtools/core-timing` with its
  browser entry point (see audit). The real hazard is **background-tab timer
  throttling**: Chrome clamps timers in hidden tabs (to 1 s, and far worse
  under intensive throttling), which would wreck the ~30 ms parent loop and
  musical timing. Mitigations, in order of preference:
  1. keep an active `AudioContext` in the engine tab — a tab audibly or
     silently rendering audio is exempt from intensive throttling, and a
     music tool has a natural excuse for one (this is what every browser DAW
     does);
  2. inject a Worker-backed timer through core-timing's existing
     `opts.setTimeout` DI seam (a dedicated worker fires the deadline and
     posts back; worker timers escape the main-thread clamp) — cheap because
     the seam already exists, and it keeps the engine itself on the main
     thread where Web MIDI lives;
  3. operator guidance: keep the engine tab in its own visible window.
  **Decided 2026-08-18: ship (1) + (3) only** — single-operator tool, the
  operator keeps both tabs visible. The Worker time-source idea is recorded
  in `next-stuff-brainstorm.md` as useful-but-not-needed. Whatever happens
  later, the engine should *watch its own tick* and publish a warning entity
  when ticks stretch (a "the platform never fails silently" obligation).
- **Persistence** — the engine tab holds execution truth in memory exactly as
  the Deno process does today. Closing the tab is killing the engine, with
  the same consequences (unsaved entity edits lost) — mitigated by the same
  gesture (explicit `/project/save`, which flows over the uplink) plus the
  unsaved-count pill that already exists.

### One engine per origin

Two engine tabs would double-run modules and fight over BroadcastChannel. The
engine page takes a `navigator.locks.request("livecode-engine", ...)` exclusive
lock at startup; a second tab sees the lock held and renders "engine already
running elsewhere" with a takeover button. The coordination server enforces the
same rule on the uplink (a new uplink socket replaces the old one, exactly like
`/client/control`'s same-ID replacement rule).

## Running it on Cloudflare

The coordination plane needs a filesystem and subprocesses (`deno lsp`,
`deno check`, esbuild, git, the coding agent), so plain Workers are out and a
**container** is the unit. Cloudflare's current platform fits well:

- **Cloudflare Containers / Sandbox SDK.** Containers are routed
  Worker → Durable Object → container instance; WebSocket upgrades are
  forwarded (the Sandbox SDK explicitly supports exposing container ports with
  HTTP + WebSocket routing and preview URLs). The Sandbox SDK is the
  higher-level path: it is built on Containers, gives `exec`/PTY (a browser
  terminal into the box), port exposure, and S3-FUSE mounting of R2 buckets —
  and Cloudflare ships a first-party tutorial for running **Claude Code inside
  a Sandbox**, which is exactly the "agent on the same box as the dev server"
  shape this setup wants. A custom Dockerfile installs Deno, the repo, and the
  agent CLI.
- **Static assets.** The built tldraw client and the engine page are static
  files; serve them from the Worker's static assets (free, cached at edge) on
  the same origin that proxies `/api/*` to the container — same-origin is what
  makes BroadcastChannel between the UI and engine tabs work. For remote dev,
  the client is served **built**, not through Vite; hot-reloading the tool's
  own UI is a local-development concern, and "UI components forked in session"
  still works because piece-local UI flows through the module pipeline, not
  through rebuilding the client bundle.
- **Ephemeral disk is the big operational fact.** Container disk is wiped on
  sleep/restart, and instances sleep after an inactivity window
  (`sleepAfter`, default 10 min, configurable; SIGTERM with a grace period on
  shutdown). Consequences:
  - the **project directory must live in git** (agent clones on container
    start, commits/pushes as the durable record — which is already how this
    repo's cloud-agent sessions work), and/or on an R2 FUSE mount for
    crash-tolerant drafts;
  - a SIGTERM handler should best-effort commit/push and notify connected
    tabs;
  - the engine tab's uplink WS keeps the container "active" during a session;
    `sleepAfter` should be generous (30–60 min) for a dev box;
  - in-memory coordination state (session dirs, prepared-run bookkeeping) is
    already rebuildable; the engine's state lives in the tab and *survives a
    container restart* — the uplink reconnects with backoff exactly like every
    other socket in the system, and the mirror re-seeds from an engine
    snapshot on reopen. This is a genuinely nice property of the split: a
    container redeploy does not stop the music.
- **Auth becomes mandatory, not optional.** `known-risks.md` P1 already says
  the server is local-trust-only (unauthenticated code execution, CORS `*`).
  Putting it on the public edge makes the recorded prerequisite blocking work:
  **Cloudflare Access** in front of the Worker (browser cookie flow covers
  page loads and WebSocket upgrades; service tokens exist for headless
  callers), plus the shared session token on mutating routes and origin
  restrictions the risks doc calls for as defense in depth. The agent inside
  the container talks to `localhost` and is unaffected.
- **Cost/latency shape.** The 30 Hz sync loop never crosses the edge
  (BroadcastChannel), so steady-state WAN traffic is keystroke-rate analysis
  calls, LSP messages, decimated mirror updates, and occasional module
  fetches — all fine over Worker→DO→container routing. Container billing is
  per active vCPU/memory time, so an idle-but-awake dev box with a long
  `sleepAfter` is the main cost lever.
- **Alternatives considered.**
  - *Workers/DO only, no container*: impossible for LSP and `deno check`
    (subprocesses). A degraded no-typecheck variant could someday run the
    analyzer itself in the engine tab (ts-morph is browser-capable) with
    project files in DO storage — worth remembering, not worth building now.
  - *Any VM + `cloudflared` tunnel*: the fallback if Containers limits bite
    (image size, instance lifetime). Everything in this plan except the
    Worker/DO wiring transfers unchanged, since the app-level contract is
    just "a Deno process reachable over HTTPS/WSS on one origin".

## Setup A (baked) as a subset

Everything Setup A needs is a strict subset of B's components:

- a **bake command** runs the coordination plane once, offline: materialize,
  analyze, browser-build every module, emit the import map, copy the engine
  page + UI bundle, and serialize durable entities (the `data/` tree the
  project save already writes) into static JSON seeds;
- the engine page boots from the baked manifest instead of an uplink: no
  server, no LSP, no analysis — code shapes render read-only source (or the
  UI simply omits editors);
- BroadcastChannel between the two tabs is the *same* transport as Stage 2 of
  Setup B, unchanged;
- saves degrade to export/download since there is no writable project
  directory — acceptable for a performance artifact, and the
  compose-privately/perform-publicly split in `user-level-project-goals.md`
  says exactly this: performance runs against stabilized material.
  **Decided 2026-08-18: export-only is v1**; OPFS-backed local persistence is
  a welcome convenience later and does not need to be robust.

Building B-then-A means the bake is mostly a build script plus a "static
manifest" engine boot path, not a second system.

## Principle and doc obligations

- **"Deno executes; the browser is disposable chrome"** (`principles.md`) needs
  a deliberate revision, not silent erosion. The proposed restatement: *the
  engine process executes; UI tabs are disposable chrome.* What the principle
  protects — music surviving a UI reload, recoverability from engine truth,
  no client inference substituting for truth — is preserved: UI tabs still
  reconnect/resubscribe/rehydrate exactly as today. What changes is that the
  engine process may itself be a browser tab, which is exactly as mortal as
  the Deno process was (and cheaper to restart: closing and reopening the
  engine tab is the full module-cache reset that currently requires a server
  process restart — it *improves* the P1 dependency-reload story).
- **State-ownership table** (`system-architecture.md`) gains a topology
  column: in browser-engine mode, execution/domain state is owned by the
  engine tab, file truth by the coordination server, and the server's copies
  of entity state are an explicitly non-authoritative mirror.
- **Sync contract is unchanged on purpose.** The whole `/sync` design —
  subscribe-replaces, resets-replace, changed-only, `entity: null` deletions,
  per-socket seq — moves onto BroadcastChannel verbatim; `protocol.md` gains a
  transport-binding section rather than a second envelope.
- **New known-risks entries** to record on implementation: background-tab
  throttling and its chosen mitigation; the mirror's decimation (agent HTTP
  reads can be ~200–500 ms stale in browser-engine mode; `/project/save`
  snapshots synchronously to stay coherent); Web MIDI's window/permission
  constraints; single-engine lock semantics.

## Phasing

1. **Engine extraction (no behavior change).** Carve
   `packages/livecode-engine` out of `visualizer/server.ts` +
   `runtime.ts`/stores/sync-sources with injected capabilities; Deno host
   keeps every route and test green. Rebase `midi_helpers.ts` onto
   `@avtools/midi` and make the portable helper graph browser-lib-clean
   (`globalThis`-probed `Deno.env` access, variable-specifier lazy imports)
   so it survives a browser-target typecheck. This phase is worth doing even
   if the browser engine stalled: it makes the run-record/store coupling
   explicit.
2. **Uplink + relay (Setup B, stage 1).** Add the `/engine/uplink` socket, the
   action-forwarding + mirror machinery, and the browser build step for
   transient modules. Browser engine page runs transient modules; UI still
   talks only to the server (sync relayed). Everything works end-to-end with
   zero client-transport changes — and this relayed mode is kept afterwards
   as the second-machine-UI topology.
3. **BroadcastChannel plane (Setup B, stage 2).** `LivecodeTransport`
   abstraction in the client; engine tab serves sync + actions locally when
   present; server keeps files/analysis/LSP and the agent surface. Project
   mode in the browser engine (materialized modules browser-built and served
   at stable URLs), with the `engineTarget` manifest field driving the
   target-aware shadow-check and LSP `lib` configuration.
4. **Cloudflare packaging.** Dockerfile (Deno + repo + agent), Sandbox-SDK
   Worker with static assets and DO routing, Access policies, git/R2
   persistence discipline, SIGTERM handling, `sleepAfter` tuning. Deliverable:
   `wrangler deploy` yields a URL where the current compose-with-agent
   workflow runs with local browser sound.
5. **Bake (Setup A).** Bake command + static engine boot + read-only UI mode.

## Decisions (owner, 2026-08-18)

The five open questions this note originally carried are decided:

1. **Mirror staleness: accepted.** Agent HTTP reads answer from the decimated
   mirror; `/project/save` keeps its synchronous point-in-time snapshot.
2. **Throttling: cheap path only.** Silent `AudioContext` plus
   keep-both-tabs-visible discipline (single-operator tool). The
   Worker-backed time-source idea is parked in `next-stuff-brainstorm.md`.
3. **Target-aware typechecking: build it.** Good typechecking is a core
   principle, and the investigation above showed the mechanism is one config
   knob plus mechanical cleanup of the portable helper graph — well under the
   "extremely complicated" bar that would have justified living with the
   mismatch.
4. **Second-machine UI: kept.** The relay is a permanent supported topology,
   not scaffolding — notably iPad-on-LAN control with a laptop-local server
   for live performance.
5. **Baked saves: export-only v1**, OPFS as a later convenience feature.

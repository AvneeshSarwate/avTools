# hanoiShow — Architecture Reference

Orientation doc for a fresh coding agent session. Read this first; you can skip most of the file-searching it would otherwise take to understand how the pieces fit.

**Location:** `apps/deno-notebooks/examples/hanoiShow/`

---

## Run & build

From `apps/deno-notebooks/`:

```
deno run --unstable-webgpu --unstable-ffi --allow-all examples/hanoiShow/combined.ts
```

Prereq: the native FFI lib must be prebuilt.

```
cd apps/deno-notebooks/native/deno_window
cargo build --release
```

Produces `target/release/libdeno_window.dylib` — `window/ffi.ts` loads it. Without this, `openLibrary()` throws.

**Platform caveat:** the wry webview path is `#[cfg(target_os = "macos")]` only (`native/deno_window/src/lib.rs`). On Linux/Windows `create_webview` returns null and the Tweakpane panel won't work. The GPU window itself is cross-platform.

---

## The tweakpane three-layer bridge (read this first)

```
  ┌────────────────────── Deno process ──────────────────────┐
  │                                                          │
  │  sketch code                                             │
  │     │ pane.addBinding(params, 'speed', …)                │
  │     ▼                                                    │
  │  TweakpaneServer (proxy)  ─── records OpMessage ──┐      │
  │     tools/tweakpaneServer.ts                      │      │
  │                                                   │      │
  │  DenoNotebookBridge ── Deno.serve + upgradeWS ────┘      │
  │     packages/ui-bridge/deno_notebook_bridge.ts           │
  │                         │                                │
  │                         │  ws://localhost:<port>/…       │
  └─────────────────────────┼────────────────────────────────┘
                            │
  ┌─ wry WebView (separate native window) ──────────────┐
  │                         ▼                           │
  │  TweakpaneClient ─── builds real tweakpane Pane     │
  │  webcomponents/tweakpane/src/tweakpane-client.ts    │
  │                                                     │
  │  user drags slider → ClientMessage back over WS     │
  │                                                     │
  │  side channel: window.ipc.postMessage(…)            │
  │    ─► Rust ipc_buffer (Mutex<Vec<String>>)          │
  │    ─► drained per frame via webview_poll_ipc        │
  │       (lifecycle only: paneReady, panelMetrics,     │
  │        panelError — NOT the tweakpane protocol)     │
  └─────────────────────────────────────────────────────┘
```

The WebSocket carries the Tweakpane protocol. The wry postMessage IPC is a side channel for panel lifecycle/metrics. The same `TweakpaneClient` bundle runs in (a) a notebook iframe, (b) the wry webview, (c) a phone browser via LAN — the shell HTML just toggles `useHostIpc` on/off.

---

## QR-code phone control

The wry panel has a "show qr code" button in its toolbar. Scanning the code from a phone on the same LAN opens the same Tweakpane in a mobile browser, driving the same bound state in real time.

Mechanism:

1. **LAN address discovery** — `packages/ui-bridge/network_utils.ts:getPreferredLanAddress()` scans `Deno.networkInterfaces()` for a non-loopback IPv4, filtering out `127.*`, link-local `169.254.*`, and Apple-specific interfaces (`utun`, `awdl`, `llw`). Prefers `en0` / `en1` / other `en*` over `eth*` / `wlan*`.
2. **URL building** — `DenoNotebookBridge.buildEditorUrl(sessionId, "lan")` and `buildWebSocketUrl(sessionId, "lan")` substitute the LAN IP into the same HTTP server's addr (`deno_notebook_bridge.ts:296-347`). There's a single `Deno.serve` listener — it's just two different hostnames pointing at it.
3. **Mobile session** — `TweakpaneServer.getMobileShareInfo()` (`tweakpaneServer.ts:1168-1176`) calls `ensureClientSession('mobile')` — a *named* session, distinct from the `'native-panel'` session the wry webview uses. Same server, same op log, different WebSocket clients.
4. **QR generation** — `tools/tweakpane_share.ts` uses `npm:qrcode-generator` to render the LAN editor URL into SVG. Embedded inline into the shell HTML by `panel_html.ts`.
5. **Shell HTML wiring** — `tools/tweakpane_shell_html.ts:299-407` has the button + hidden QR panel + clickable fallback link. Button is disabled if `lanUrl` is null (e.g. no network).
6. **Phone connects** — phone's browser loads the editor URL → the `DenoNotebookBridge` HTTP handler serves the shell HTML with `useHostIpc: false` (no wry postMessage IPC there, of course) → the inlined `TweakpaneClient` opens a WebSocket to the LAN host → kernel sends the full op-log `replay` → pane renders, identical to the native one.

**Fan-out / sync.** Because every session is just another WebSocket client of the same `TweakpaneServer`:
- Kernel-side code changes (e.g. `_recordOp` from a slider moving because code set `params.foo = 0.5` + `pane.refresh()`) are broadcast to *all* connected sessions — native panel, notebook iframe, phone.
- A value changed on the phone fires `_handleValueChange` on the server, which updates the bound object, records a `refresh` op, and broadcasts back to the other sessions. So dragging a slider on the phone moves the same slider in the native panel in real time.

**Caveats:**
- Phone and host must be on the same LAN with no client isolation (most home Wi-Fi is fine; many conference / captive networks aren't).
- The LAN URL is `http://`, not HTTPS — some mobile browsers may warn; QR scans that route through browsers with "HTTPS everywhere" style rewrites will fail.
- `getPreferredLanAddress()` picks the first matching interface — if the host has multiple (e.g. Ethernet + Wi-Fi), the phone has to be on the selected one. Override by manually choosing the URL from the share info if needed.

---

## Scene composition (`combined.ts`)

Each scene module exports the same surface — `setup`, `draw`, `cleanup`, `setupPane`, `state` — so `combined.ts` imports them by name and runs all three in one WebGPU window.

- `combined.ts:42-56` — canvas size + global tweakpane-backed params (bg RGB, per-scene enable toggles, timing overlay).
- `combined.ts:69-73` — shared data providers (`bodyContourProvider`, `handBBoxProvider`) own the WS receivers + smoothing. Ticked once per frame so scenes don't redo smoothing.
- `combined.ts:75-107` — `setupPane` builds a 6-tab Tweakpane (Global / Body Contour / Hands / OSC Trail / Tegaki / Body Text), delegating each scene's `setupPane` to one tab page.
- `combined.ts:167-192` — boots a `WindowRenderManager` with `pane: { ..., setup: setupPane }`.
- `combined.ts:194-230` — per-frame: poll providers → `p5.beginFrame` → draw enabled scenes in order → timing overlay → `p5.endFrame`. A `yieldMs: 4` forces a `setTimeout` between frames so UDP/WS callbacks aren't starved.

### Shared-state injection

Scene modules expose their own `state` object. Before the scene's `setup()` runs, `combined.ts:71-73` assigns shared providers onto those state objects:

```ts
tegakiState.contourProvider = bodyContourProvider;
tegakiState.handBBoxProvider = handBBoxProvider;
bodyState.contourProvider  = bodyContourProvider;
```

This is the dependency-injection seam. Keep it — it's how multiple scenes read one smoothed contour frame without each running its own receiver.

---

## Compositing model — ONE shared P5GPU instance

**All scenes draw into the same P5GPU instance, into the same offscreen framebuffer, in one `beginFrame` / `endFrame` pair.**

```
  renderWindow.run(() => {
    bodyContourProvider.tick();         // advance shared data once
    handBBoxProvider.tick();

    p5.beginFrame();                    // ONE begin
    p5.background(bgR, bgG, bgB);       // ONE background clear

    if (oscEnabled)    oscDraw(p5, t);  // painter's-algorithm layering
    if (tegakiEnabled) tegakiDraw(p5);  //   OSC  →  tegaki  →  body text
    if (bodyEnabled)   bodyDraw(p5, t); //   (later calls paint on top)
    drawTimingOverlay(p5);

    return p5.endFrame();               // ONE end → returns GPUTexture,
                                        // which is blitted to the swapchain
  });
```

Consequences an agent should internalize:

- **No per-scene offscreen buffer.** Scenes alpha-blend directly onto the shared target. There's no layer compositing — drawing order is the only compositing control.
- **Draw order matters.** The fixed order in `combined.ts:206-214` is OSC → tegaki → body text. Later = on top. Changing the order changes the visual.
- **Per-scene `p5.push()` / `p5.pop()` hygiene** is essential. The P5GPU style stack is a real stack (`tools/p5gpu.ts:883-888`). A scene that forgets to restore stroke/fill/textFont/textAlign will corrupt the next scene's draws.
- **One `p5.background()`** is called before any scene. Scenes must NOT call `background` — that would clobber earlier scenes' pixels. (The scene's standalone main files do call it themselves, but their exported `draw()` does not; check before adding a new scene.)
- **Scenes don't allocate P5GPU.** Only `combined.ts` (or the scene's standalone `main` block) constructs the instance. In combined mode, scene `setup()` signatures vary: `oscSetup(device)`, `tegakiSetup()` (no args), `bodySetup(p5)` — only body needs the P5GPU handle at setup time.

---

## Per-scene "fade" convention (structural)

Each scene has one parameter that acts as a **per-scene amplitude / fade knob for live performance**. Its semantic meaning is sketch-specific; its *structural role* is uniform: at 0 the scene is invisible, at 1 it's fully present, and intermediate values cross-fade smoothly during show transitions.

Current bindings:
- `p5gpu_body_text.ts` — `state.render.fade` (0..1). Multiplies stroke/fill alpha and early-returns at `fade <= 0`.
- `p5gpu_tegaki_handwriting.ts` — `state.params.glyphScale`. Same role: glyphs shrink to nothing; early-returns at `glyphScale <= 0`.
- `p5gpu_osc_note_trail.ts` — **not yet implemented**. Needs one for show use.

**Why this convention matters for upcoming work:** the Global tab's `bodyEnabled` / `tegakiEnabled` / `oscEnabled` toggles are hard on/off and will pop. The per-scene fade is the smooth control an operator (or automation) uses to move between scenes over the course of a show. New scenes should add one; the OSC scene should grow one. The name is sketch-specific (`fade`, `glyphScale`, whatever reads right for the scene's content), but behavior at the extremes should be consistent.

**Early-return discipline.** The convention is: when the fade is at 0, the scene's `draw()` returns immediately without issuing any draw calls or running expensive side effects (trigger processing, etc.). See `p5gpu_body_text.ts:185-186` and `p5gpu_tegaki_handwriting.ts:997` for the pattern.

---

## Window + render manager (`apps/deno-notebooks/window/`)

- `window.ts` — `createGpuWindow()` uses Deno FFI to the Rust `native/deno_window` lib to spawn a native window, extract the raw `NSView`, and hand it to `Deno.UnsafeWindowSurface` so WebGPU renders into it directly.
- `window_render_manager.ts` — thin orchestrator: creates `GpuWindow`, a `BlitPipeline`, and a `WindowTweakpane` (if `pane` is passed). Its `run()` is the `while (!closed)` loop that calls `window.pollEvents()`, the user frame fn, blits the returned texture to the swapchain, presents, and awaits `yieldMs`.
- `mod.ts` re-exports everything consumers use.
- `ffi.ts` — the FFI symbol table (the canonical list of what the Rust lib exposes).

---

## Tweakpane system — layer by layer

**Kernel (Deno) side:**
- `tools/tweakpaneServer.ts:193-393` — `TweakpaneServer` + `BladeProxy / FolderProxy / TabProxy / BindingProxy / ButtonProxy`. Each `addBinding`/`addFolder`/`addTab` generates an ID, records an `OpMessage` to an internal operation log, and returns a proxy. All mutations go through `_recordOp`, which is both stored (for replay) and broadcast to connected sockets.
- `tools/tweakpaneAdapter.ts` — plugs `TweakpaneServer` into `DenoNotebookBridge` (from `packages/ui-bridge`). That bridge runs `Deno.serve` + `Deno.upgradeWebSocket`. On `connectionReady`, it sends a `replay` message containing the full op log. Inbound messages (`valueChange`, `buttonClick`, `foldChange`, `tabSelect`, `bladeValueChange`) route back into `_handle*` methods on the server, which update the bound object and fire proxy events.
- `tools/tweakpaneProtocol.ts` — shared `OpMessage` / `ClientMessage` union. Functions in option objects are serialized as `fn.toString()` and reconstructed client-side via `new Function(...)` — **pure fns only, no closures**.

**Wry native panel:**
- `window/tweakpane_panel.ts` — `WindowTweakpane` extends `TweakpaneServer`. On construction it creates a session, gets a loopback `ws://…` URL, and renders an HTML shell containing that URL (`panel_html.ts`). The tweakpane-client JS bundle is inlined as a base64 `data:` URL so the webview has no external deps.
- `window/panel.ts:27-157` — `WindowPanel` spawns the webview via the FFI `create_webview` symbol. Rust opens a **separate** native winit window and mounts a wry WebView in it (`native/deno_window/src/lib.rs:660-733`). The Rust side installs `with_ipc_handler` which pushes every `window.ipc.postMessage(...)` body into a `Mutex<Vec<String>>`.
- Per frame, `WindowTweakpane._attachPanel` wraps `GpuWindow.pollEvents` (`tweakpane_panel.ts:103-113`) so each tick also calls `panel.pollMessages()` → `webview_sync_bounds` + `webview_pump` (drives `CFRunLoopRunInMode` for WKWebView IPC) + `webview_poll_ipc` (drains the Rust mutex buffer). Those drained messages are panel-lifecycle only: `connectionReady`, `paneReady`, `panelMetrics`, `panelError` (`tweakpane_panel.ts:132-171`). Also forwards the configured toggle key (default `Tab`) from the GPU window to show/hide the panel.

**Browser (webview) side:**
- `webcomponents/tweakpane/src/tweakpane-client.ts` — loaded as an ES module inside the shell HTML from `tools/tweakpane_shell_html.ts`. Opens the WebSocket to the kernel, receives the `replay`, builds a real `new Pane(...)` and walks every op to reconstruct folders/tabs/bindings/blades. User interaction fires `ClientMessage`s back over the same socket. The shell HTML also replaces native `<select>` elements with custom div dropdowns (`tweakpane_shell_html.ts:426-517`) because WKWebView's native select popup enters a modal tracking loop that freezes the whole main thread.
- **Rebuild required** when editing `tweakpane-client.ts` — `panel_html.ts` reads the built bundle from `webcomponents/tweakpane/dist/tweakpane-client.js`.

---

## Directory map — "where do I look when…"

| Task                                | Where                                                                                  |
|-------------------------------------|----------------------------------------------------------------------------------------|
| add / modify a scene                | `examples/hanoiShow/p5gpu_*.ts` (exports `setup`/`draw`/`cleanup`/`setupPane`/`state`) |
| share data across scenes            | `*_provider.ts` (owns WS receiver, ticked once per frame in `combined.ts`)              |
| windowing / blit / render loop      | `apps/deno-notebooks/window/`                                                          |
| pane protocol (kernel side)         | `apps/deno-notebooks/tools/tweakpane{Server,Adapter,Protocol}.ts`                      |
| pane protocol (browser side)        | `webcomponents/tweakpane/src/tweakpane-client.ts` (rebuild `dist/` after edits)         |
| native wry / winit / FFI            | `apps/deno-notebooks/native/deno_window/src/lib.rs`                                    |
| FFI symbol list                     | `apps/deno-notebooks/window/ffi.ts`                                                    |
| HTTP server / WS upgrade / iframes  | `packages/ui-bridge/deno_notebook_bridge.ts`                                           |

---

## Data inputs

The scenes consume live data over WebSocket from upstream producers. Relevant receivers:

- `tools/contour_receiver.ts` — body contour frames (used by `body_contour_provider.ts`)
- `tools/contour_smoother.ts` — temporal smoothing + stable IDs
- `tools/hand_receiver.ts` — hand bounding boxes (used by `hand_bbox_provider.ts`)

See `io-lag-analysis.md` (same directory) for a prior writeup of the IO / frame-pacing tradeoffs that led to `COMBINED_RENDER_YIELD_MS = 4`.

---

## Non-obvious invariants

- **Opcode replay model.** `TweakpaneServer.operations` is the durable source of truth. Anything new that adds a blade *must* go through `_recordOp`, or late-joining iframes/phones will render a stale pane.
- **Function serialization** via `fn.toString()` + `new Function(...)` — no closures survive. Don't reach for captured vars in `format:` / `view:` callbacks passed to bindings.
- **One webview pump per frame.** `WindowTweakpane._attachPanel` monkey-patches `pollEvents` so `webview_pump` + `webview_poll_ipc` run every tick. If you replace the render loop, keep that hook.
- **CFRunLoop coupling.** `webview_pump` hard-codes `CFRunLoopRunInMode(..., 0.002, 0)` — that 2ms is the upper bound on webview responsiveness per frame. Combined with `yieldMs: 4` in `combined.ts`, that's the whole "don't starve WS/UDP" story.
- **Custom `<select>` replacement** (`tweakpane_shell_html.ts:426-517`) exists because WKWebView's native popup enters a modal tracking loop that freezes the GPU thread. Don't delete it.
- **Two native windows, not one.** The pane is a separate winit window, not a child view. Tab-toggle (`panel.ts:139`) shows/hides it; it doesn't overlay the GPU canvas.
- **Cleanup order** in `combined.ts:221-229` — scenes first, then providers, then `p5`. Providers last so scenes can still flush in-flight WS callbacks on teardown.

---

## Quick sanity tools

- `apps/deno-notebooks/scripts/webview_smoke.ts` — minimal create_webview / pump / ipc round-trip. Faster feedback than running `combined.ts` when the native lib rebuild looks broken.

---

## Out of scope for this doc

Read these files when you touch them; they aren't worth summarizing here:

- `tools/p5gpu.ts` — the WebGPU-backed p5-style renderer.
- `@avtools/shader-fx` — `ShaderEffect` / blit pipeline used by the render manager.
- Individual scene logic (`p5gpu_osc_note_trail.ts`, `p5gpu_tegaki_handwriting.ts`, `p5gpu_body_text.ts`).

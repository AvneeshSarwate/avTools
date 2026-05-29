# hanoiShow — Architecture Reference

Orientation doc for a fresh coding agent session. Read this first; you can skip most of the file-searching it would otherwise take to understand how the pieces fit.

**Location:** `apps/deno-notebooks/examples/hanoiShow/`

---

## Run & build

The active entry point is `combined_landscape.ts`. From `apps/deno-notebooks/`:

```
deno run --unstable-webgpu --unstable-ffi --allow-all examples/hanoiShow/combined_landscape.ts
```

Prereqs: two native FFI libs must be prebuilt.

```
cd apps/deno-notebooks/native/deno_window && cargo build --release
cd apps/deno-notebooks/native/syphon_bridge && cargo build --release
```

Produces `libdeno_window.dylib` (windowing + wry webview) and `libsyphon_bridge.dylib` (Syphon publisher). Missing either → `openLibrary()` throws at startup.

**Platform caveat:** the wry webview path is `#[cfg(target_os = "macos")]` only (`native/deno_window/src/lib.rs`). On Linux/Windows `create_webview` returns null and the Tweakpane panel won't work. The GPU window itself is cross-platform. The Syphon output is macOS-only (Syphon is a macOS IOSurface bridge).

> **Note on `combined.ts`:** an earlier portrait-first variant (`combined.ts`) exists in this directory with quad wire packing, 90°-CW rotation into quadrants, per-channel source selection, and two Syphon outputs. It is **deprecated** and not documented here — don't edit it, don't use it as a reference. Slicing into physical-display columns now happens downstream; this process just ships one flat landscape composite.

---

## Dimensions — fixed 1920×1080 landscape

Top of `combined_landscape.ts`:

```ts
const WIDTH = 1920;
const HEIGHT = 1080;
```

These flow once into: the GpuWindow (surface size), every P5GPU instance (scene offscreens + composite + syphon staging), tegaki's `setup({width,height})`, fab_and_lies' `setup({width,height})`, and the single Syphon output pipeline. No env-var override, no aspect branching — if you need a different canvas size, change the constants.

**Where scene code reads dims.**
- Inside exported `draw()` functions: use `p5.width` / `p5.height`. No plumbing needed — P5GPU already knows its size.
- Inside tegaki helpers that don't have `p5` in scope (`computeGlyphBboxes`, `runHandEmitterLoop`, `spawnHandParticle`): read from `state.meta.width` / `state.meta.height` / `state.meta.maxWidth`, populated by `tegakiSetup({width,height})`.
- Module-level `WIDTH`/`HEIGHT` constants exist only inside each scene's `if (import.meta.main)` block — standalone mode. They do not leak into the exported code paths.

A scene can encode projection-specific behavior internally, but the process itself has no column concept.

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

## Programmatic parameter updates (kernel → UI)

When sketch code mutates a bound value, the Tweakpane UI does **not** automatically reflect it — you have to push the change. The bridge is only automatic in one direction (UI drag → kernel). The reverse needs an explicit call.

### Two kinds of controls

- **Bindings** (`pane.addBinding(obj, 'key', {...})`) — bound to a property on an object. The UI reads from and writes to `obj.key`.
- **Standalone blades** (`pane.addBlade({view: 'slider', value: 0.5, ...})` etc) — carry their own `value` property, not bound to an external object. Used less often in hanoiShow but the mechanics differ.

### Binding case — the common one

```ts
// Move a slider programmatically:
params.fade = 0.3
binding.refresh()          // or pane.refresh() to refresh everything
```

Under the hood (`tools/tweakpaneServer.ts:445-448`):

```ts
BindingProxy.refresh() {
  const value = this.boundObj[this.key]
  this._server._broadcastToIframes({ type: 'refresh', values: { [this.proxyId]: value } })
}
```

The `refresh` op travels over the WebSocket. On the client (`tweakpane-client.ts:196-220`):

1. Sets `suppressSync = true` (echo-suppression flag).
2. Writes `entry.obj[entry.key] = value` into the client's *local* bound object.
3. Calls the real tweakpane `api.refresh()`, which re-reads the local bound object and redraws the control.
4. Clears `suppressSync`.

Without `refresh()`, the bound object's new value is invisible to the UI — the widget only re-reads on explicit refresh (or on the next user interaction, which will overwrite your programmatic change anyway).

### `pane.refresh()` vs `binding.refresh()` vs `folder.refresh()`

- `BindingProxy.refresh()` — one binding. Cheapest. Sends a single-entry `refresh` op.
- `FolderProxy.refresh()` — recursively calls `refresh()` on every child (`tools/tweakpaneServer.ts:540-546`).
- `TweakpaneServer.refresh()` (root) — walks every registered binding AND every registered blade value, packages them into one big `refresh` op, sends once (`tools/tweakpaneServer.ts:1105-1116`). Use this when you've changed many values at once (e.g. preset recall).

### Standalone blade case

For blades created via `addBlade({ view: 'slider', ... })`, set `.value` directly on the proxy — the setter broadcasts a `bladeValue` op automatically (`tools/tweakpaneServer.ts:786-790`):

```ts
const slider = pane.addBlade({ view: 'slider', value: 0, min: 0, max: 1 })
slider.value = 0.5         // broadcasts; no refresh() needed
```

### Cross-session fan-out (free for bindings)

When the user drags a slider in session A (e.g. the phone), the server calls `_handleValueChange` (`tools/tweakpaneServer.ts:1367-1382`):

1. Updates `binding.obj[binding.key]` on the kernel.
2. Fires kernel-side `change` listeners (anything registered via `binding.on('change', ...)`).
3. **Broadcasts a `refresh` op to all *other* sessions** (the `originSessionId` is excluded to break the loop).

So the native panel's slider moves in real time when the phone's slider is dragged, and vice versa. You get this for free — you don't need to call `refresh()` in response to a UI change from another session.

### Pitfalls

- **Every-frame mutation without refresh.** Scenes mutate `state.whatever` constantly inside `draw`. None of that reaches the UI. Only `refresh()` does. That's usually what you want — you don't want the "frame counter" field twitching in the panel 60 times a second.
- **If you DO want per-frame UI feedback** (e.g. a VU meter showing current audio level), it needs a per-frame `binding.refresh()`. Weigh the cost: each refresh is a WebSocket message to every connected session, plus DOM update.
- **Don't call `refresh()` inside a binding's `on('change', ...)` handler.** The echo-suppression protects the *client*, but a kernel-side re-broadcast from inside the change handler can cause feedback loops across sessions. If you need to derive one bound value from another, mutate the second value in the handler and call `refresh()` for that second binding only.
- **Presets / scene-recall pattern.** Mutate a batch of properties, then call `pane.refresh()` once at the end (the root walk is cheaper than N individual binding refreshes for large presets).

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

## Scene composition (`combined_landscape.ts`)

Each scene module exports the same surface — `setup`, `draw`, `cleanup`, `setupPane`, `state` — so `combined_landscape.ts` imports them by name and composes them in one WebGPU window.

High-level structure:

- **Fixed dims** — `WIDTH = 1920, HEIGHT = 1080`. All scenes render at this resolution.
- **Four P5GPU instances** — `tegakiP5`, `kinareeP5`, `fabP5`, `overlayP5`. Each scene gets its own; the overlay hosts the timing HUD.
- **Single composite** — one `rgba8unorm` `compositeTexture` at 1920×1080. Cleared to **transparent** each frame; per-scene offscreens alpha-blend onto it. Syphon ships it verbatim, no re-packaging.
- **Single Syphon output** — one `HeadlessSyphonServer` named `"Hanoi Show L"` at 1920×1080. Downstream handles any column slicing / display mapping.
- **Shared data providers** — `bodyContourProvider`, `handBBoxProvider` own WS receivers + smoothing. Ticked once per frame before any scene reads. Tegaki consumes both. (No body-text scene in this variant, so no `bodyState` injection.)
- **Tweakpane setup** — 4-tab panel (Global / Tegaki / Kinaree / Fab & Lies); Global tab has Scenes / Body Contour / Hands / Debug subfolders. Each scene's `setupPane` delegates to one tab.
- **Perf panel** — a second `WindowTweakpane` (`perfPane`) in its own floating window, exposing macro controls for scenes that expose `macroDefs`. 3 tabs: Tegaki / External 1 / External 2. **Important:** the kernel-side class is the same `WindowTweakpane`, but the browser-side renderer is a *different* bundle (`@avtools/perf-pane`, a Vue custom element) that implements only a subset of the wire protocol. See "Perf pane — parallel Vue client" below before adding controls to it.
- **Monitor (dev preview)** — a single 1280×720 tile showing the composite scaled down. Cleared to opaque black so transparent regions of the composite preview as black (approximates typical Syphon-over-black consumer behavior). The monitor texture is what the GPU window actually displays; it is *not* what ships to Syphon (the Syphon wire carries true RGBA).
- **Frame callback** — providers tick → each P5GPU does begin/draw/end → composite clear-to-transparent + alpha-blit all layers → Syphon capture from the composite → monitor blit → submit. `yieldMs: 4` forces a `setTimeout` between frames so UDP/WS callbacks aren't starved.

### Why the composite is cleared to transparent

Downstream Syphon consumers composite `combined_landscape`'s output over their own backdrop (video feed, other Syphon layers, etc.). Shipping a pre-multiplied opaque background would force that backdrop color on anyone using this output. Clearing to `{r:0, g:0, b:0, a:0}` keeps alpha honest across the wire; sketches draw opaque content where they draw and leave everything else transparent.

### Currently wired scenes

| Scene | Module | Notes |
|---|---|---|
| Tegaki | `p5gpu_tegaki_handwriting.ts` | Random / intersection / hand trigger modes. Consumes body contour + hand bbox. Has `state.params.fade`. |
| Burning Kinaree | `burning_kinaree.ts` | Three mixable sections: orbit circles, rect launcher, snowfall. Has `state.params.fade` and per-section `mix`. |
| Fab & Lies | `fab_and_lies.ts` | Thai text blocks launched from the left/top toward the bottom-right. Has `state.params.fade`. Async asset load (local Thai .ttf) via `fabLoadAssets(fabP5)` in startup. |

The older scenes `p5gpu_osc_note_trail.ts` and `p5gpu_body_text.ts` still exist in the directory as standalone-runnable sketches (see "Dual-mode"). They are not imported by `combined_landscape.ts`. Either can be wired back in by following the import/setup/frame/cleanup pattern of the existing scenes.

### Shared-state injection

Scene modules expose their own `state` object. Before each scene's `setup()` runs, `combined_landscape.ts` assigns shared providers onto those state objects:

```ts
tegakiState.contourProvider = bodyContourProvider;
tegakiState.handBBoxProvider = handBBoxProvider;
```

This is the dependency-injection seam. It's how multiple scenes can read one smoothed contour frame without each running its own receiver. If you wire in a new scene that needs the provider, add one more line here.

---

## Compositing model — per-scene P5GPU + alpha compositor

**Each scene draws into its own P5GPU offscreen. A per-frame composite pass alpha-blends them in draw order onto a shared `rgba8unorm` `compositeTexture`. The composite is then rotated 90° CW into quadrants of a 2×2 packed wire texture for Syphon output 1; Syphon output 2 ships the (currently placeholder) landscape composite. The monitor preview blits channels into its own tile layout.**

```
  renderWindow.run(() => {
    bodyContourProvider.tick();
    handBBoxProvider.tick();

    // 1. Each scene produces its own texture (transparent where untouched).
    oscP5.beginFrame();     if (oscEnabled)     oscDraw(oscP5, t);       const oscTex     = oscP5.endFrame();
    tegakiP5.beginFrame();  if (tegakiEnabled)  tegakiDraw(tegakiP5);    const tegakiTex  = tegakiP5.endFrame();
    bodyP5.beginFrame();    if (bodyEnabled)    bodyDraw(bodyP5, t);     const bodyTex    = bodyP5.endFrame();
    kinareeP5.beginFrame(); if (kinareeEnabled) kinareeDraw(kinareeP5,t);const kinareeTex = kinareeP5.endFrame();
    fabP5.beginFrame();     if (fabEnabled)     fabDraw(fabP5, t);       const fabTex     = fabP5.endFrame();
    overlayP5.beginFrame(); drawTimingOverlay(overlayP5);                 const overlayTex = overlayP5.endFrame();

    // 2. Portrait composite: clear to bg RGB, alpha-blit 6 layers in painter order.
    const encoder = device.createCommandEncoder();
    /* clear passes: compositeView → bg RGB; portraitQuadView → bg RGB; landscapeCompositeView → bg RGB */
    alphaBlit(device, encoder, alphaBlitPipeline, oscView,     compositeView);
    alphaBlit(device, encoder, alphaBlitPipeline, tegakiView,  compositeView);
    alphaBlit(device, encoder, alphaBlitPipeline, bodyView,    compositeView);
    alphaBlit(device, encoder, alphaBlitPipeline, kinareeView, compositeView);
    alphaBlit(device, encoder, alphaBlitPipeline, fabView,     compositeView);
    alphaBlit(device, encoder, alphaBlitPipeline, overlayView, compositeView);

    // 3. Per-channel source resolution. Each of the 4 channel*Source params
    //    maps to a texture view: none/red/osc/tegaki/body/kinaree/fab/portrait/landscape.
    const ch1 = channelSources[ch1Src]; /* … and ch2, ch3, ch4 */

    // 4. Pack 3 vertical channels into the 2×2 quad wire, each rotated 90° CW
    //    into a 960×540 quadrant. Slot 4 stays cleared (wire slack).
    blitTile(device, encoder, rotatedAlphaBlitPipeline, ch1, portraitQuadView, {x:0,   y:0,   w:960, h:540});
    blitTile(device, encoder, rotatedAlphaBlitPipeline, ch2, portraitQuadView, {x:960, y:0,   w:960, h:540});
    blitTile(device, encoder, rotatedAlphaBlitPipeline, ch3, portraitQuadView, {x:0,   y:540, w:960, h:540});

    // 5. Syphon: output 1 always ships the packed quad (per-channel content
    //    lives inside); output 2 ships whatever channel 4 resolves to.
    for (const output of syphonOutputs) output.tryPublish();
    syphonOutputs[0].captureFrame(encoder, portraitQuadView);
    syphonOutputs[1].captureFrame(encoder, ch4);

    // 6. Monitor preview: 3 portrait tiles (ch1/2/3 un-rotated) on top,
    //    landscape tile (ch4) below, alpha-composited over a bg-cleared monitor.
    /* clear monitorView to bg RGB; blitTile ch1/ch2/ch3 into three 240×427 tiles;
       blitTile ch4 into the 720×405 tile below. */

    device.queue.submit([encoder.finish()]);
    return monitorView; // render manager blits this to the swapchain
  });
```

Consequences an agent should internalize:

- **Per-scene isolation.** Each P5GPU owns its own render target, style stack, and font cache. A scene can no longer corrupt another scene's state — the shared-p5 `push()`/`pop()` hygiene rule is **no longer load-bearing** (though it's still good practice inside a single scene).
- **Draw order still matters.** Painter's-algorithm compositing: alphaBlit calls in order OSC → tegaki → body → kinaree → fab → overlay; later = on top. To change layering, reorder the alphaBlit calls in `combined.ts`. Kinaree + fab sit on top of the other scenes so their strobe flashes overlay earlier layers; overlay sits on top of all of them for the timing HUD.
- **`autoClear` replaces the shared `background()` call.** Scene `draw()` functions take a trailing `autoClear = true` param; when true, they call `p5.clear()` at the very start (before any early returns) so the offscreen starts transparent each frame. This is required because P5GPU's `endFrame()` uses `loadOp: "load"` by default (preserves previous frame pixels) unless `clear()` / `background()` was called during the frame. `combined.ts` relies on the default `true`; standalone runners pass `false` because they already call `p5.background(...)` after `beginFrame()`.
- **Scenes STILL must NOT call `background()` in their exported `draw()`.** Doing so would paint a solid color across the scene's offscreen — wiping transparency — which breaks alpha compositing. Standalone-only `background()` calls live in the `import.meta.main` runner, not the exported draw.
- **Disabled scenes still pay for begin/end.** We always beginFrame/endFrame on all 6 P5GPUs and always alphaBlit them all — an all-transparent layer is a no-op visually but still costs a pass. The `if (enabled)` gates only the scene's own draw calls, not the pipeline. See `noop-checker.md` for the broader work-gating story (scene-fade, not enable flags, is the actual quiescence signal).
- **P5GPU allocation lives in `combined.ts`.** Scene `setup()` signatures vary: `oscSetup(device)` (UDP server), `tegakiSetup({width,height})` (setup-time text layout needs dims), `bodySetup(p5)` (needs a p5 handle to load Charmonman into that specific instance), `kinareeSetup({width,height})` (sync — captures dims for trigger helpers), `fabSetup({width,height})` + `fabLoadAssets(fabP5)` (dims sync, font load async — Ayuthaya .ttf for Thai glyphs into fabP5).

### Rotation and the portrait-quad wire format

Portrait scenes render at 720×1280 (9:16). Each of the 3 vertical channels gets rotated 90° CW into a 960×540 quadrant of the 1920×1080 portrait quad. The rotation is shader-baked: `window/blit.ts` exposes `createRotatedAlphaBlitPipeline`, which samples `vec2(1 - uv.y, 1 - uv.x)` — a 90° CW rotation combined with the y-flip already baked into the top-left-origin convention.

Aspect arithmetic: 720×1280 rotated 90° CW becomes effectively 1280×720 (16:9), which fits the 960×540 quadrant (also 16:9) at exactly 0.75× uniform scale. That's the reason scenes author portrait-first: the rotation is clean, no stretching.

Alpha-blending version of the rotated blit is used in `combined.ts` (not the plain rotated blit) so that individual sketch textures — which have transparent regions where they didn't draw — don't obliterate the quad's bg-color clear. Transparent regions of the sketch show bg instead of black.

### `alphaBlit` — how the compositor works

Added to `apps/deno-notebooks/window/blit.ts` as a sibling to the existing `blit`:

- `createAlphaBlitPipeline(device, targetFormat)` — identical shader to `createBlitPipeline`, but with WebGPU `blend: { color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" }, alpha: { ... } }` on the pipeline target. Standard source-over alpha.
- `alphaBlit(device, encoder, pipeline, src, dst)` — same shape as `blit`, but uses `loadOp: "load"` so the destination is preserved. The clear-to-bg happens in a separate render pass at the top of the composite; subsequent alphaBlits layer onto it.

---

## Syphon outputs — three headless publishers with source selection

`combined.ts` publishes three independent Syphon streams, each with its own runtime source selector on the Global tab. Options per output: **OSC Trail / Tegaki / Body Text / Composite** (default Composite). Server names: "Hanoi Show 1", "Hanoi Show 2", "Hanoi Show 3".

**Why headless and not window-bound.** The simpler `SyphonServer` in `syphon/syphon.ts` latches whatever's on the window's CAMetalLayer — multiple instances on one window would all publish the same thing. `HeadlessSyphonServer` (`syphon/headless_syphon.ts`) accepts arbitrary pixel bytes via `publishFrame(bytes, w, h, bytesPerRow)`, so we can route any of the four scene/composite textures to any of the three outputs.

### Per-output plumbing (`SyphonOutput` helper in `combined.ts`)

Each output owns:

- **`HeadlessSyphonServer`** — the Syphon publisher.
- **`bgra8unorm` staging texture** — the format Syphon wants (`pixel_format = 0 = BGRA8`). `RENDER_ATTACHMENT | COPY_SRC`.
- **Two readback `GPUBuffer`s** — ping-pong, each sized to `alignedBytesPerRow(width) * height` (256-byte row alignment — WebGPU requirement). `COPY_DST | MAP_READ`.
- **`busy[2]`, `hasData[2]`, `writeIdx`** — per-buffer state. `busy` means currently mapped; `hasData` means a completed copy is ready to publish.

### Per-frame flow (per output)

```
tryPublish():                      // called first, BEFORE queue.submit of this frame
  for each buffer i:
    if hasData[i] && !busy[i]:
      busy[i] = true
      (fire-and-forget) await buf.mapAsync(READ) → publish → unmap → clear flags
      return                        // one publish per frame is enough

captureFrame(encoder, sourceView):  // called as part of the composite encoder
  if busy[writeIdx]: return         // both ping-pongs stuck? just skip this frame
  blit(source → stagingTexture)     // rgba8 → bgra8 swizzle happens in the shader output
  encoder.copyTextureToBuffer(stagingTexture → buffers[writeIdx])
  hasData[writeIdx] = true
  writeIdx = (writeIdx + 1) % 2
```

### The rgba→bgra swizzle trick

All scene + composite textures are `rgba8unorm`. Syphon wants BGRA bytes. We bridge the formats in a single step: **blit the rgba source into a bgra8unorm target**. The blit shader outputs `vec4f(r, g, b, a)`; WebGPU writes those components to a bgra8unorm texture in BGRA byte order. No shader swizzle code needed. The subsequent `copyTextureToBuffer` then yields BGRA bytes directly.

### Timing behavior

- Publish runs async (fire-and-forget `mapAsync`). The submitted copy and the map request race in parallel on the GPU timeline.
- Typical latency: **one frame behind** — we publish what was written last frame.
- If `mapAsync` takes longer than 2 frames to resolve, that output silently skips copies for a frame or two; the user sees slightly lower Syphon fps on that output. No stalls on the main render loop.
- Each output is independent — they can have different source selections and still all land in the same `encoder.finish()` submission.

### Cleanup

`SyphonOutput.destroy()` tears down both readback buffers, the staging texture, and the `HeadlessSyphonServer`. `combined.ts`'s `cleanup` loop calls it on all three.

**Platform note.** Syphon is macOS-only. If this project ever grows a Windows/Linux target, this section becomes an `#ifdef` and the outputs need to become optional (or be replaced with Spout on Windows).

---

## Dual-mode: standalone vs combined

Every scene file is **both** a library module (imported by `combined.ts`) and a standalone runnable. The split is gated by `if (import.meta.main)` at the bottom of each file.

```
deno run --unstable-webgpu --unstable-ffi --allow-all \
    examples/hanoiShow/p5gpu_osc_note_trail.ts      # standalone
    examples/hanoiShow/p5gpu_tegaki_handwriting.ts  # standalone
    examples/hanoiShow/p5gpu_body_text.ts           # standalone
    examples/hanoiShow/combined.ts                  # all three
```

### What the scene exports (used by `combined.ts`)

| Export               | Contract                                                                                                                                                                                                                                                                                                                      |
|----------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `setup(...)`         | Allocate internal resources only. Does **not** construct P5GPU or a window. Signatures vary by scene: `oscSetup(device)` (opens UDP server), `tegakiSetup({width,height})` (populates `state.meta.width/height/maxWidth`, runs text layout, kicks off core-timing), `bodySetup(p5)` (loads Charmonman into that p5 instance). |
| `draw(p5, ..., autoClear?)` | Issue draw calls against the provided P5GPU. Does **not** call `beginFrame` / `endFrame` / `background`. When `autoClear` is `true` (default), calls `p5.clear()` at the very start — required for combined-mode compositing. Standalone runners pass `false` because they already `p5.background(...)` before draw.  |
| `cleanup()`          | Release internal resources only. Does not dispose P5GPU or the window.                                                                                                                                                                                                                                                        |
| `setupPane(c, ref?)` | Add blades to the provided `PaneContainer` (a tab page, folder, or pane root). Optional `refresh` callback for programmatic UI updates.                                                                                                                                                                                       |
| `state`              | The scene's live state object. `combined.ts` writes shared providers onto it before `setup()`.                                                                                                                                                                                                                                |
| `macroDefs`          | Array of `MacroDef` descriptors for the perf panel's macro tab.                                                                                                                                                                                                                                                               |

### What the `import.meta.main` block adds (standalone mode)

A scene's standalone block is a tiny self-contained runner that does everything `combined.ts` would have done *for that one scene*:

1. Local `const WIDTH`, `const HEIGHT` — standalone picks its own fixed dims.
2. `await requestWebGpuDevice()` — its own device.
3. Construct its own data providers and wire them into the scene's `state` via the same seam combined uses (`state.contourProvider = provider`).
4. `createWindowRenderManager(...)` — its own window + pane, with `setupPane` calling `setupPane(pane)` and *also* folding in the provider's pane controls.
5. `new P5GPU(device, {width, height})` — its own P5GPU instance.
6. `await setup(...)` — calls the scene's own exported setup. Tegaki's standalone passes `{width: WIDTH, height: HEIGHT}`.
7. `renderWindow.run(() => { p5.beginFrame(); p5.background(...); draw(p5, t, false); /* HUD */ return p5.endFrame(); }, { cleanup })`. Note the explicit `autoClear: false` — the runner's `background()` already handles clearing.

### Asymmetries

- **Background color.** Standalone blocks hardcode a bg (e.g. `p5.background(15, 18, 26)`) and pass `autoClear: false`. `combined.ts` clears the composite to the Global-tab RGB params once; scene P5GPUs clear to transparent via `autoClear: true` (default). Scenes must not call `background` in their exported `draw()` in either mode — it's either the runner's job (standalone) or the compositor's (combined).
- **HUD / overlay.** Each standalone block draws its own "fps / frame / contour count" HUD on its own P5GPU. `combined.ts` uses a dedicated `overlayP5` instance with a unified `drawTimingOverlay` gated by the Global tab.
- **Provider ownership.** Standalone scenes own (create + setup + tick + cleanup) their own providers. In combined mode, `combined.ts` owns them and injects them.
- **Pane layout.** Standalone scenes put their blades at the pane root (plus a `Contour Processing` subfolder for the provider). In combined mode, each scene's `setupPane` receives a *tab page* and builds folders inside it.
- **Syphon.** Standalone OSC scene publishes a single window-bound Syphon ("P5GPU_OSC_Note_Trail"). Combined.ts publishes three headless ones with source selectors (see above).

### Adding a new scene

Mirror the existing pattern exactly:
1. Export `setup` / `draw(p5, ..., autoClear?)` / `cleanup` / `setupPane` / `state` (+ optional `macroDefs`) with the contract above.
2. Inside `draw`, start with `if (autoClear) p5.clear();` before any early returns.
3. Use `p5.width` / `p5.height` for runtime dims. If you have helpers that don't receive `p5`, store dims on `state` at setup time (see tegaki's `state.meta`).
4. Add an `if (import.meta.main)` standalone block for isolated development and testing — must pass `autoClear: false` when calling its own `draw`.
5. Register imports + tab page + provider injection + per-frame `beginFrame/draw/endFrame` + alphaBlit layer + cleanup call in `combined.ts`. Also decide where it sits in the painter's-algorithm order (which determines its alphaBlit position).
6. Optionally add it as a source option in the Syphon Outputs folder.

Keeping both modes working is load-bearing — it's how scenes get developed and debugged in isolation before being composed into a show.

---

## Scene mix — the load-bearing mixing parameter (structural)

Each scene exposes one parameter that is **the** per-scene mix knob for live performance. Conventionally named `fade` and bound to the UI label `Scene Fade`. Semantic meaning can be sketch-specific (body_text still uses `state.render.fade`; a scene could equivalently name it `glyphScale` if that reads right for the content), but its *structural role* is uniform and non-negotiable — this is the only parameter an operator uses to cross-fade scenes during a show.

**What "scene mix" does** — two responsibilities, both required:

1. **Alpha multiplier** on all visible draw calls for the scene. At 0 the scene is invisible, at 1 fully present, linearly in between. Every draw path (strokes, fills, particles, overlays) threads the fade into its alpha so nothing leaks through during a cross-fade.
2. **Quiescence signal** for state-update work. At `fade <= 0` the scene stops doing *unnecessary* work: trigger loops skip spawning ramps, emitter loops skip spawning particles, intersection/hand-bbox trigger scan loops short-circuit. In-flight ramps can continue (they're cheap and their writes are invisible); what's forbidden is new work spawned while invisible.

The second responsibility is the one that's easy to forget and the one that matters for running a show with many scenes. Without it: a "disabled" scene (fade=0) keeps allocating particles / scheduling ramps / touching phase state at full rate. Over minutes of stage time this is unbounded growth and wasted CPU. See `noop-checker.md` (same directory) for the prior audit that surfaced this across scenes.

**Current bindings:**

| Scene | Param | Notes |
|---|---|---|
| `burning_kinaree.ts` | `state.params.fade` | Section mixes multiply by `fade`; trigger branches gate on `mix <= 0`; orbit phase integration runs unconditionally (keeps motion continuous across transitions). Canonical implementation. |
| `p5gpu_tegaki_handwriting.ts` | `state.params.fade` | Early-return on fade=0 before `drawContourDebug`; glyph stroke alpha multiplies by fade; hand-particle emitter outer condition includes `fade > 0`; random-trigger branch has `if (fade <= 0) continue;`. Intersection/hand triggers are free (gated by the draw early-return). Debug overlays intentionally *do not* multiply by fade — they're dev-only and never run during a show. |
| `p5gpu_body_text.ts` | `state.render.fade` | Early-return at `fade <= 0`; alpha multiplier on strokes/fills. Spring physics runs inside `draw()` so it naturally stops with fade. |
| `fab_and_lies.ts` | `state.params.fade` | Combined with scene `mix` via `mix * fade`; launch and draw work are both gated when that product is 0. |
| `p5gpu_osc_note_trail.ts` | **not yet implemented** | Flagged in `noop-checker.md` as out-of-scope for the current cleanup pass but required before this scene is used in a show. UDP receiver + delay-buffer ring also need gating. |

**Scene mix vs `<scene>Enabled` toggle.** The Global tab's enable flags are not a replacement for `fade`. They only gate the scene's `draw()` call inside `combined.ts` — the scene's core-timing branches, provider ticks, emitter loops all keep running regardless. Useful for instant mute during development; unusable for on-stage transitions (hard pop, not a fade) and insufficient for quiescence (no-op cleanup relies on fade, not enable).

**Implementation discipline for new scenes:**

1. Name it `fade` on `state.params` (or whatever state shape the scene uses) and default it to `1.0`. Bind with label "Scene Fade" at the top of the scene's pane.
2. In `draw()`, compute `const fade = state.params.fade; if (fade <= 0) return;` as one of the first statements — before any trigger-processing helpers that fire from inside draw (intersection, hand bbox, etc.), but after any load-bearing phase integration that must keep running during fade=0 for motion continuity. The kinaree `orbitPhase` integration above the fade gate is the paradigm case — *don't* move it below.
3. Thread the fade multiplier into every `fill/stroke` alpha. For scenes with self-attenuating effects (particle systems), multiply their computed alpha by fade.
4. In every core-timing branch that schedules new work (triggers, emitters), add `if (state.params.fade <= 0) continue;` alongside the existing `paused` / mode checks. Not needed for logic that runs inside `draw()` — the early-return above covers it.
5. Sections with their own per-section `mix` (kinaree, fab_and_lies) compute `const m = section.mix * state.params.fade` and early-return when `m <= 0`. Scene-fade is the global multiplier; section-mix is the internal balance between sketch components.

---

## Window + render manager (`apps/deno-notebooks/window/`)

- `window.ts` — `createGpuWindow()` uses Deno FFI to the Rust `native/deno_window` lib to spawn a native window, extract the raw `NSView`, and hand it to `Deno.UnsafeWindowSurface` so WebGPU renders into it directly.
- `window_render_manager.ts` — thin orchestrator: creates `GpuWindow`, a `BlitPipeline`, and a `WindowTweakpane` (if `pane` is passed). Its `run()` is the `while (!closed)` loop that calls `window.pollEvents()`, the user frame fn, blits the returned texture to the swapchain, presents, and awaits `yieldMs` (default **1**; `combined.ts` sets 4). `0` would be a near-tight spin that starves WebSocket callbacks — see the yield-starvation invariant below.
- `blit.ts` — two flavors of blit:
  - **`createBlitPipeline` / `blit`** — opaque, `loadOp: "clear"`. Used by the render manager to paint the final composite onto the swapchain, and by each syphon output to copy its source into its bgra staging texture (the opaque write is fine because the clear wipes to black and the whole frame is then painted).
  - **`createAlphaBlitPipeline` / `alphaBlit`** — source-over alpha blending enabled on the pipeline target, `loadOp: "load"` so the destination is preserved. Used by the combined-mode compositor to layer per-scene offscreens onto `compositeTexture`.
- `mod.ts` re-exports everything consumers use (including both blit variants + the alpha pipeline factory).
- `ffi.ts` — the FFI symbol table (the canonical list of what the Rust lib exposes).

### Syphon packages (`apps/deno-notebooks/syphon/`)

- `syphon.ts` — **window-bound** `SyphonServer`. Binds to the GpuWindow's NSView/CAMetalLayer; `publishFrame()` latches what's on the surface. Not used by `combined.ts` anymore, but the OSC standalone still uses it.
- `headless_syphon.ts` — **headless** `HeadlessSyphonServer`. Takes arbitrary BGRA8 bytes via `publishFrame(pixelData, width, height, bytesPerRow)`. This is the primitive combined.ts builds its 3 outputs on.
- `staging_buffers.ts` — `alignedBytesPerRow(width)` helper (rounds to 256 — WebGPU row alignment requirement) + a `createStagingBufferPair` factory combined.ts does NOT use (it builds its own simpler busy-flag version inside `SyphonOutput` — see the Syphon section above).
- `headless_renderer.ts` — a self-contained async render loop that uses the staging pair with inline `await mapAsync`. Useful for standalone headless capture; we don't use it here because our render loop is synchronous, so `SyphonOutput` uses fire-and-forget + busy flags instead.

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

## Perf pane — parallel Vue client for the same protocol

The perf pane shares the kernel-side plumbing with the main Tweakpane — same `WindowTweakpane` class, same `TweakpaneServer`, same op-log replay, same WebSocket wire protocol — but routes to a **different browser bundle** with a **restricted op vocabulary**. This is easy to miss because `perfPane` is typed as `WindowTweakpane`; the switch happens in the shell-HTML renderer.

### How the routing happens

`createWindowTweakpane` accepts an optional `renderShell` option. `combined.ts` passes `renderPerfShellHtml` from `tools/perf_shell_html.ts`, which:

1. Loads the prebuilt Vue bundle at `webcomponents/perf-pane/dist/perf-pane.js` (the `@avtools/perf-pane` package).
2. Inlines it into the shell HTML and mounts a `<perf-pane-component>` custom element pointed at the same loopback WebSocket URL the main pane uses.
3. The custom element is a Vue app whose root is `apps/browser-projections/src/perfPane/PerfPaneRoot.vue`, driven by `perfPaneClient.ts`.

The main pane, by contrast, uses the default shell (`tools/tweakpane_shell_html.ts`) which mounts the full `tweakpane-client.ts` bundle. Both bundles connect to WebSockets served by `DenoNotebookBridge`; both receive the same `replay` + op-stream; they just interpret it differently.

### `renderShell` reaches two paths — native webview AND HTTP (phone, iframe)

There are **two places** a shell HTML gets produced for a single `WindowTweakpane`:

1. **Native wry webview.** `WindowTweakpane._createPanelHtml(renderShell)` generates the HTML once at construction time, writes it to a tempfile, and loads it into the webview. This always respected `renderShell`.
2. **HTTP-served clients** (phone scanning the QR code; notebook iframe). `DenoNotebookBridge`'s HTTP handler calls the adapter's `renderHTML(wsUrl, sessionId, sessionData)` (in `tools/tweakpaneAdapter.ts`) on each request. This path **used to hardcode** `renderTweakpaneShellHtml`, so the phone always loaded the default Tweakpane shell regardless of what `renderShell` the native webview got.

To keep both paths in sync, `renderShell` is now also registered on the `TweakpaneServer` via `server.setShellRenderer(renderer)`:

- `createWindowTweakpane` in `window/tweakpane_panel.ts` calls `pane.setShellRenderer(options.renderShell)` whenever a `renderShell` is provided, in addition to passing it to `_createPanelHtml`.
- The adapter's `renderHTML` (`tools/tweakpaneAdapter.ts`) checks `_sessionData.server.shellRenderer` first. If set, it calls that with `{ title, sessionId, wsUrl, mobileUrl, qrSvg }`; otherwise falls back to `renderTweakpaneShellHtml`.

Result: phone QR scan of the perf pane now loads the Vue shell, not Tweakpane. Without this step, the two browser clients diverge — native webview gets the custom shell, phone gets the default — and you'd see a full Tweakpane UI on your phone even though the floating native panel shows the Vue sliders.

When adding a new custom shell: you only have to pass it via `createWindowTweakpane({..., renderShell})`. The registration with `TweakpaneServer` is automatic. The types — `ServerShellRenderer` and `ServerShellRenderArgs` — are exported from `tools/tweakpaneServer.ts`.

### Op subset the perf client implements

`apps/browser-projections/src/perfPane/perfPaneClient.ts` handles only:

| Op                 | Behavior                                                                                       |
|--------------------|------------------------------------------------------------------------------------------------|
| `addTab`           | Renders tabbed pages with clickable buttons; each page is a flat list of sliders.              |
| `addBinding`       | **Only when `typeof op.value === 'number'`.** Becomes a `VerticalSlider`. Non-numeric dropped. |
| `refresh`          | Updates slider values from kernel-initiated writes.                                            |
| `bladeValue`       | Updates slider value for standalone blades (rare in perf usage).                               |
| `setProperty`      | Live updates for `label`, `min`, `max` on an existing slider.                                  |

Silently ignored (see `perfPaneClient.ts:208-211`):
- `addFolder` — **no folder hierarchy inside a tab page**. Sliders are flat per page.
- `addButton` — **no buttons** (no OSC one-shot triggers, no "Reset" buttons, etc.).
- `addBlade` — standalone slider/select blades.
- `addSeparator`, `remove`, `dispose` — layout and lifecycle ops.
- Non-numeric bindings — booleans, strings, and enum-`options` bindings never render.

### Implications for adding controls

- If you want a control to appear on the perf pane, it must be a **numeric binding inside a tab page** (root-level sliders also render, but combined.ts uses tabs). The existing `installMacros` + `MacroDef<number>` pattern is the only shape guaranteed to work.
- Want to group sliders? Use separate tab pages, not sub-folders.
- Want buttons, dropdowns, or non-numeric controls on the perf pane? You must **extend `PerfPaneClient` + `PerfPaneRoot.vue` and rebuild the bundle**. Alternatively, put those controls on the main Tweakpane, which handles everything.
- The main Tweakpane always renders every op. So controls added to the *main* pane don't need any awareness of the perf pane's limits. It's only adding things to `setupPerfPane` (or to anything that will be visible on the perf window) that is constrained.

### Rebuild

When editing `perfPaneClient.ts`, `PerfPaneRoot.vue`, or any Vue component under `apps/browser-projections/src/perfPane/`:

```
cd apps/browser-projections && npm run buildPerfPane
```

`perf_shell_html.ts` reads the built bundle at startup — no HMR.

### Why two clients instead of one pane with presets

The perf pane is optimized for live operation: big vertical sliders, chunky hit targets, tabs-not-folders, no dropdowns or text fields that require keyboard focus. It's a hands-on-phone-or-touchscreen tool, whereas the main pane is a full Tweakpane for fine tuning. The wire protocol is a convenient shared contract, and `installMacros` already produces ops (`addBinding` numeric in a tab page) that are exactly the intersection both clients render — so a single `macroDefs` export drives both panes automatically.

---

## Directory map — "where do I look when…"

| Task                                         | Where                                                                                     |
|----------------------------------------------|-------------------------------------------------------------------------------------------|
| add / modify a scene                         | `examples/hanoiShow/p5gpu_*.ts` (exports `setup`/`draw`/`cleanup`/`setupPane`/`state`)    |
| change aspect ratio / composite / add scene  | `examples/hanoiShow/combined.ts` (aspect consts, per-scene P5GPU, compositor encoder)     |
| change syphon source selection / output count | `examples/hanoiShow/combined.ts` (`syphonOutputs` array + `syphon{1,2,3}Source` params)  |
| alpha compositing pipeline                   | `apps/deno-notebooks/window/blit.ts` (`createAlphaBlitPipeline`, `alphaBlit`)             |
| share data across scenes                     | `*_provider.ts` (owns WS receiver, ticked once per frame in `combined.ts`)                |
| windowing / blit / render loop               | `apps/deno-notebooks/window/`                                                             |
| headless syphon primitives                   | `apps/deno-notebooks/syphon/headless_syphon.ts`, `syphon/staging_buffers.ts`              |
| pane protocol (kernel side)                  | `apps/deno-notebooks/tools/tweakpane{Server,Adapter,Protocol}.ts`                         |
| pane protocol (browser side, main pane)      | `webcomponents/tweakpane/src/tweakpane-client.ts` (rebuild `dist/` after edits)           |
| perf pane Vue client (browser side)          | `apps/browser-projections/src/perfPane/` → `perfPaneClient.ts`, `PerfPaneRoot.vue`, `components/VerticalSlider.vue` (rebuild via `npm run buildPerfPane`) |
| perf pane shell HTML (kernel side)           | `apps/deno-notebooks/tools/perf_shell_html.ts` — loads bundle from `webcomponents/perf-pane/dist/perf-pane.js` |
| shell-renderer routing (native + HTTP)       | `createWindowTweakpane` → `pane.setShellRenderer(...)` in `window/tweakpane_panel.ts`; consumed by `_createPanelHtml` (native) and `TweakpaneAdapter.renderHTML` (phone/iframe) |
| macro helper (shared between main + perf)    | `apps/deno-notebooks/tools/macros.ts` — `MacroDef<T>` + `installMacros`                   |
| native wry / winit / FFI                     | `apps/deno-notebooks/native/deno_window/src/lib.rs`                                       |
| native syphon FFI                            | `apps/deno-notebooks/native/syphon_bridge/src/lib.rs`                                     |
| FFI symbol list (window)                     | `apps/deno-notebooks/window/ffi.ts`                                                       |
| FFI symbol list (syphon)                     | `apps/deno-notebooks/syphon/ffi.ts`                                                       |
| HTTP server / WS upgrade / iframes           | `packages/ui-bridge/deno_notebook_bridge.ts`                                              |

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
- **`yieldMs` default is 1, not 0.** `WindowRenderManagerRunOptions.yieldMs` in `window/window_render_manager.ts` defaults to `1` when unset. Before: default was `0`, which made the render loop spin tightly between frames and caused tweakpane slider drags to arrive in chunks every few hundred ms instead of smoothly (the render loop out-competed WebSocket read callbacks for event-loop ticks). `1ms` is the minimum that keeps input flowing; scenes with heavier IO (combined.ts pumps UDP for OSC + two WS receivers) bump to `4`. If you author a new standalone scene and notice choppy slider response, raise `yieldMs` — don't chase it elsewhere.
- **Custom `<select>` replacement** (`tweakpane_shell_html.ts:426-517`) exists because WKWebView's native popup enters a modal tracking loop that freezes the GPU thread. Don't delete it.
- **Two native windows, not one.** The pane is a separate winit window, not a child view. Tab-toggle (`panel.ts:139`) shows/hides it; it doesn't overlay the GPU canvas.
- **Cleanup order** in `combined.ts` — scenes first, then providers, then the four P5GPUs, then composite texture, then syphon outputs. Providers mid-order so scenes can still flush in-flight WS callbacks on teardown.
- **P5GPU `loadOp: "load"` by default.** P5GPU's `endFrame()` preserves previous-frame pixels unless `clear()` or `background()` was called during the frame (`tools/p5gpu.ts:730` — `useLoadOp = !this._clearRequested && this._hasRenderedFrame`). In combined mode each scene relies on `autoClear = true` to force the per-frame clear; forget that and you get ghost trails.
- **Scenes must NOT call `background()` in exported `draw()`.** In combined mode it would clobber alpha and break compositing; in standalone mode it's the runner's job. The rule applies regardless of mode.
- **rgba→bgra swizzle is implicit.** Syphon's `bgra8unorm` staging texture + the blit shader's `vec4f(r,g,b,a)` output is what produces correct BGRA bytes for `publishFrame`. Change the staging format to rgba8 and the channels will come out wrong.
- **Syphon readback is always one frame behind.** Ping-pong buffers mean publishFrame sees the previous frame's pixels. Acceptable in practice; don't try to "fix" it with a single-buffer design — that'll introduce GPU stalls or force-blocking on mapAsync.
- **Three P5GPU instances all need their own font loads.** Today only `bodyP5` loads Charmonman (via `bodySetup(bodyP5)`). A future scene that uses a custom font on `oscP5` or `tegakiP5` needs its own `await p5.loadFont(...)` in that scene's setup — fonts do not cross P5GPU instances.
- **Perf pane is a different browser client.** `perfPane` is kernel-typed as `WindowTweakpane`, but its shell mounts `@avtools/perf-pane` (Vue), not `tweakpane-client`. It renders numeric sliders in tab pages only — `addFolder`, `addButton`, non-numeric `addBinding`, `addBlade`, `addSeparator` are silently dropped. If a control you add doesn't appear on the perf window, it's probably one of those ops. See "Perf pane — parallel Vue client" section.
- **Custom shells must reach both render paths.** A `renderShell` passed to `createWindowTweakpane` applies to the native webview *and* to HTTP-served clients (phone QR, notebook iframe) only because `createWindowTweakpane` calls `pane.setShellRenderer(renderShell)`. If you bypass `createWindowTweakpane` and wire a custom shell some other way, remember that the adapter's `renderHTML` falls back to the default Tweakpane shell whenever `server.shellRenderer` is unset — and the phone will silently show the wrong UI.

---

## Quick sanity tools

- `apps/deno-notebooks/scripts/webview_smoke.ts` — minimal create_webview / pump / ipc round-trip. Faster feedback than running `combined.ts` when the native lib rebuild looks broken.

---

## Out of scope for this doc

Read these files when you touch them; they aren't worth summarizing here:

- `tools/p5gpu.ts` — the WebGPU-backed p5-style renderer. Relevant internals mentioned in this doc: `beginFrame`/`endFrame` clear semantics (`:715-775`), `_clearRequested` / `_clearColor` state (`:722-723`), `loadOp: "load"` default.
- `@avtools/shader-fx` — `ShaderEffect` / generated shaders. Note `packages/shader-fx/generated-raw/shaders/composite.frag.raw.generated.ts` contains a proper `CompositeEffect` with blend modes (add/screen/multiply/overlay + opacity) — considered and not used here (our needs were simpler), but the upgrade path from `alphaBlit` to it is straightforward if per-layer blend modes become desirable.
- Individual scene logic (`p5gpu_osc_note_trail.ts`, `p5gpu_tegaki_handwriting.ts`, `p5gpu_body_text.ts`).

# Combined Sketch IO Lag Analysis

## Problem
When running the combined sketch (`combined.ts`), network IO updates feel choppy/stuttered:
- OSC pitch data (UDP, port 9003) — note trail line updates lag behind input
- WebSocket contour data (ws://127.0.0.1:9100) — body outline updates stutter

Both are smooth when running their respective standalone sketches.

Importantly, **rendering is not the issue**:
- Tegaki stroke animation stays smooth (driven by core-timing, not IO)
- Body text spring physics animation stays smooth (computed per-frame, not IO-dependent)
- Only data that arrives via network callbacks is affected

## What we've ruled out

### Rendering overhead
All three scenes render fine together — animations driven by internal state (core-timing phases, spring physics) remain smooth. The GPU work per frame is not saturating the frame budget.

### Core-timing macrotask pressure
The tegaki animation runs ~17 concurrent async branches (1 root tick + 1 trigger loop + ~15 active ramps), each doing `waitSec(1/60)`. The core-timing scheduler uses MessageChannel macrotask yields between timeslices. Initial hypothesis was that ~17 macrotask yields per frame could starve IO callbacks. However:
- ~17 branches doing trivial phase updates is not much work
- Tegaki slider responsiveness is the same in standalone vs combined
- Disabling core-timing (setting glyphScale=0) doesn't fix the IO lag

### Disabling the OSC server
Commenting out `oscSetup(device)` in the combined sketch (so no UDP listener is active) does **not** fix the WebSocket contour data stutter. The body text IO remains choppy even with OSC disabled.

## Architecture

### Network listeners in combined sketch
1. **node-osc UDP server** (port 9003) — uses npm `node-osc` package, which uses Node.js `dgram` under Deno's Node compat layer
2. **WebSocket client** to `ws://127.0.0.1:9100` — native Deno WebSocket, receives binary contour frames from Swift Vision app
3. **Deno.serve HTTP+WebSocket server** (random port) — tweakpane UI bridge, present in all sketches including standalone

### Render loop
`window/render_loop.ts` uses a tight `while(running)` async loop with `await new Promise(resolve => setTimeout(resolve, 0))` between frames. IO callbacks can only run during that setTimeout gap.

### How IO data flows
- OSC: `node-osc` server fires `"message"` callback → updates `state.note` fields → read by `draw()` next frame
- WebSocket: `ws.onmessage` callback → parses binary frame → sets `receiver.latestFrame` → read by `draw()` next frame
- Both are fire-and-forget into shared mutable state; `draw()` just reads whatever's current

## Open questions

- Why does the same WebSocket contour receiver work smoothly in standalone `p5gpu_body_text.ts` but stutter in the combined sketch?
- The standalone body_text sketch also has tweakpane (Deno.serve + WebSocket), so the combined sketch only adds the node-osc UDP server and the tegaki core-timing tree. But disabling OSC doesn't help.
- Is there something about having multiple P5GPU draw passes in the same `beginFrame/endFrame` that delays GPU queue submission and indirectly blocks the event loop?
- Could the tweakpane bridge behave differently with a much larger pane config (tabs + 30+ bindings vs ~15 in standalone)?
- Is `setTimeout(0)` in the render loop getting clamped differently when more async work is in flight?

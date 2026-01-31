# Windowed Rendering for Raw WebGPU Ports

## Overview

Add a native window (via winit Rust dylib + Deno FFI) to the existing headless raw-WebGPU power2d and shader-fx ports. The window presents rendered frames via `Deno.UnsafeWindowSurface`. Includes keyboard/mouse input piped back to Deno, a format-conversion blit shader, and a vsync'd render loop.

## Architecture

```
Deno (TypeScript)                          Rust dylib (winit)
─────────────────                          ──────────────────
requestWebGpuDevice()                      create_window(w, h)
  │                                          │
  ├─ get raw window handle ◄─────────────────┘
  │
  ├─ new Deno.UnsafeWindowSurface(handle)
  │    └─ ctx.configure({ device, format })
  │
  ├─ renderLoop():
  │    scene.render()          → offscreen GPUTexture (rgba16float)
  │    effects.render()        → offscreen GPUTexture
  │    blit(src, swapchain)    → fullscreen quad, format conversion
  │    surface.present()       → vsync
  │    poll_events() ──────────► winit pump → returns event buffer
  │    await setTimeout(0)     → yield to kernel
  │    loop
  │
  └─ headless mode (unchanged):
       scene.render() → writeTextureToPng()
```

## Deliverables

### 1. Rust dylib: `apps/deno-notebooks/native/deno_window/`

**Cargo.toml**
- `crate-type = ["cdylib"]`
- Dependencies: `winit = "0.30"`, `raw-window-handle = "0.6"`
- Release profile: `panic = "abort"`, `lto = true`, `codegen-units = 1`

**Exported FFI functions (`src/lib.rs`)**

```
create_window(width: u32, height: u32, title_ptr: *const u8, title_len: u32) -> *mut WindowState
get_raw_window_handle(state: *mut WindowState) -> usize    // NSView* on macOS, etc
get_raw_display_handle(state: *mut WindowState) -> usize    // null on macOS, wayland display on Linux
get_window_system(state: *mut WindowState) -> u32           // 0=cocoa, 1=x11, 2=wayland
poll_events(state: *mut WindowState, buf_ptr: *mut u8, buf_cap: u32) -> u32
    // Returns JSON-encoded events into caller's buffer
    // Returns byte count written, 0 if no events
resize_window(state: *mut WindowState, width: u32, height: u32) -> void
get_window_size(state: *mut WindowState, out_w: *mut u32, out_h: *mut u32) -> void
destroy_window(state: *mut WindowState) -> void
```

**Event JSON format:**
```json
[
  {"type":"key","key":"a","down":true},
  {"type":"mouse_move","x":100,"y":200},
  {"type":"mouse_button","button":0,"down":true,"x":100,"y":200},
  {"type":"scroll","dx":0,"dy":-3},
  {"type":"resize","width":800,"height":600},
  {"type":"close"}
]
```

**Internal design:**
- `WindowState` struct holds `winit::window::Window` + event accumulator
- winit 0.30 uses `ApplicationHandler` trait — event loop runs via `pump_events()` (non-blocking poll) rather than `run()` (blocking)
- Events accumulated into a `Vec`, serialized as JSON into the caller's buffer on `poll_events()`
- Cross-platform: macOS (Cocoa), Linux (X11 or Wayland auto-detected by winit)

---

### 2. TypeScript FFI wrapper: `apps/deno-notebooks/window/ffi.ts`

Following the midi_bridge pattern exactly:

```ts
export const FFI_SYMBOLS = {
  create_window:         { parameters: ["u32", "u32", "pointer", "u32"], result: "pointer" },
  get_raw_window_handle: { parameters: ["pointer"], result: "usize" },
  get_raw_display_handle:{ parameters: ["pointer"], result: "usize" },
  get_window_system:     { parameters: ["pointer"], result: "u32" },
  poll_events:           { parameters: ["pointer", "pointer", "u32"], result: "u32" },
  resize_window:         { parameters: ["pointer", "u32", "u32"], result: "void" },
  get_window_size:       { parameters: ["pointer", "pointer", "pointer"], result: "void" },
  destroy_window:        { parameters: ["pointer"], result: "void" },
} as const;
```

- Cross-platform library discovery (`.dylib` / `.so`)
- `openLibrary()` function matching midi_bridge pattern

---

### 3. TypeScript window manager: `apps/deno-notebooks/window/window.ts`

High-level wrapper:

```ts
export interface WindowOptions {
  width: number;
  height: number;
  title?: string;
}

export interface GpuWindow {
  device: GPUDevice;
  surface: Deno.UnsafeWindowSurface;
  ctx: GPUCanvasContext;
  format: GPUTextureFormat;
  width: number;
  height: number;
  pollEvents(): WindowEvent[];
  present(): void;
  close(): void;
}

export async function createGpuWindow(
  device: GPUDevice,
  options: WindowOptions,
): Promise<GpuWindow>
```

Implementation:
1. Calls `create_window()` via FFI
2. Reads back handle + display handle + window system enum
3. Maps system enum to `Deno.UnsafeWindowSurface` system string (`"cocoa"`, `"x11"`, `"wayland"`)
4. Creates `Deno.UnsafeWindowSurface`, gets `GPUCanvasContext`
5. Configures context with `presentMode: "fifo"` (vsync)
6. Returns `GpuWindow` object

---

### 4. Blit shader: `apps/deno-notebooks/window/blit.ts`

A minimal fullscreen-triangle shader + pipeline that samples an input texture and writes to the swapchain format. No vertex buffer needed — positions derived from `vertex_index`.

```wgsl
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;

@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / vec2f(textureDimensions(src));
  return textureSample(src, srcSampler, uv);
}
```

Exported as:
```ts
export function createBlitPipeline(device: GPUDevice, targetFormat: GPUTextureFormat): BlitPipeline
export function blit(encoder: GPUCommandEncoder, pipeline: BlitPipeline, src: GPUTextureView, dst: GPUTextureView): void
```

Handles rgba16float -> bgra8unorm (or whatever the surface wants) via the texture sample, which clamps to [0,1] on the output side.

---

### 5. Event types: `apps/deno-notebooks/window/events.ts`

```ts
export type WindowEvent =
  | { type: "key"; key: string; down: boolean }
  | { type: "mouse_move"; x: number; y: number }
  | { type: "mouse_button"; button: number; down: boolean; x: number; y: number }
  | { type: "scroll"; dx: number; dy: number }
  | { type: "resize"; width: number; height: number }
  | { type: "close" };
```

---

### 6. Render loop: `apps/deno-notebooks/window/render_loop.ts`

```ts
export interface RenderLoopOptions {
  window: GpuWindow;
  blitPipeline: BlitPipeline;
  onFrame: (frameNumber: number) => GPUTextureView;
  onEvent?: (event: WindowEvent) => void;
}

export function startRenderLoop(options: RenderLoopOptions): { stop(): void }
```

Loop body each frame:
1. `poll_events()` via FFI -> dispatch to `onEvent` callback
2. Call `onFrame()` — user renders scene + effects, returns output texture view
3. Get swapchain texture via `ctx.getCurrentTexture()`
4. Blit source -> swapchain via command encoder
5. `surface.present()` — blocks for vsync (~16ms)
6. `await new Promise(r => setTimeout(r, 0))` — yield to Deno event loop (lets Jupyter kernel process next cell)
7. Repeat until `stop()` called or close event received

---

### 7. Module exports: `apps/deno-notebooks/window/mod.ts`

Re-exports everything:
```ts
export { createGpuWindow, type GpuWindow, type WindowOptions } from "./window.ts";
export { createBlitPipeline, blit, type BlitPipeline } from "./blit.ts";
export { startRenderLoop, type RenderLoopOptions } from "./render_loop.ts";
export type { WindowEvent } from "./events.ts";
```

---

### 8. Windowed test script: `apps/deno-notebooks/raw-webgpu-windowed.ts`

Demonstrates the full pipeline — same scene setup as `raw-webgpu-power2d-shaderfx.ts` but rendering to a live window:

```ts
import { requestWebGpuDevice } from './raw-webgpu-helpers.ts';
import { createPower2DScene, selectPower2DFormat, BatchedStyledShape } from '@avtools/power2d/raw';
import { InstancedSolidMaterial } from '@avtools/power2d/generated-raw/shaders/instancedSolid.material.raw.generated.ts';
import { BloomEffect } from '@avtools/shader-fx/generated-raw/shaders/bloom.frag.raw.generated.ts';
import { createGpuWindow, createBlitPipeline, startRenderLoop } from './window/mod.ts';

const device = await requestWebGpuDevice();
const format = await selectPower2DFormat(device);
const win = await createGpuWindow(device, { width: 512, height: 512, title: "power2d" });
const blitPipeline = createBlitPipeline(device, win.format);

const scene = createPower2DScene({ device, width: 512, height: 512, format });
// ... set up shapes, effects (same as headless test) ...

startRenderLoop({
  window: win,
  blitPipeline,
  onFrame: (frame) => {
    // animate shapes based on frame number
    scene.render();
    bloomEffect.render();
    return bloomEffect.outputView;
  },
  onEvent: (e) => {
    if (e.type === "key" && e.key === "Escape") win.close();
    if (e.type === "resize") scene.resize(e.width, e.height);
  },
});
```

---

## File summary

| File | Purpose |
|------|---------|
| `apps/deno-notebooks/native/deno_window/Cargo.toml` | Rust project manifest |
| `apps/deno-notebooks/native/deno_window/src/lib.rs` | Winit window + FFI exports |
| `apps/deno-notebooks/window/ffi.ts` | Deno.dlopen wrapper |
| `apps/deno-notebooks/window/window.ts` | GpuWindow high-level API |
| `apps/deno-notebooks/window/blit.ts` | Blit shader + pipeline |
| `apps/deno-notebooks/window/events.ts` | Event type definitions |
| `apps/deno-notebooks/window/render_loop.ts` | Vsync render loop |
| `apps/deno-notebooks/window/mod.ts` | Re-exports |
| `apps/deno-notebooks/raw-webgpu-windowed.ts` | Windowed test script |

## Files unchanged

- `packages/power2d/raw/*` — no changes needed
- `packages/shader-fx/raw/*` — no changes needed
- `apps/deno-notebooks/raw-webgpu-helpers.ts` — headless path stays as-is
- `apps/deno-notebooks/raw-webgpu-power2d-shaderfx.ts` — headless test stays as-is

## Build & test

1. **Build Rust dylib:**
   ```bash
   cd apps/deno-notebooks/native/deno_window && cargo build --release
   ```

2. **Headless (CI, unchanged):**
   ```bash
   deno run --allow-all --unstable-webgpu raw-webgpu-power2d-shaderfx.ts
   ```

3. **Windowed:**
   ```bash
   deno run --allow-all --unstable-webgpu --unstable-ffi raw-webgpu-windowed.ts
   ```
   - Should open a window showing the rendered scene
   - Escape key closes it
   - Verify vsync (no tearing, ~60fps)

## Platform notes

- **macOS**: `get_window_system` returns 0 (cocoa). Surface: `Deno.UnsafeWindowSurface("cocoa", nsView, null)`. No extra dependencies beyond Rust toolchain.
- **RPi 5 (Linux)**: `get_window_system` returns 1 (x11) or 2 (wayland). May need `apt install libwayland-dev libxkbcommon-dev` or `libx11-dev` for winit build. Verify `navigator.gpu.requestAdapter()` succeeds (needs Vulkan v3dv driver).
- Same `cargo build --release` command on both platforms.

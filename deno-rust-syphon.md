# Deno → Rust → Syphon: Implementation Plan

## Overview

Publish WebGPU-rendered frames from Deno to other macOS applications via Syphon, with **zero CPU readback**. The approach intercepts the `CAMetalLayer` drawable that Deno/wgpu presents to, and GPU-blits each frame into a Syphon-managed IOSurface texture.

### Architecture Diagram

```
Deno (TypeScript)                    Rust cdylib (syphon_bridge)
─────────────────                    ───────────────────────────
createGpuWindow()                    Objective-C runtime via objc2
  └─ gets NSView* ──────────────────►  syphon_init(ns_view_ptr, name)
                                        ├─ load Syphon.framework via NSBundle
                                        ├─ get CAMetalLayer from NSView
                                        ├─ get MTLDevice from layer
                                        ├─ create MTLCommandQueue
                                        ├─ create SyphonMetalServer
                                        └─ return opaque *mut SyphonState

render loop:                         syphon_publish(state)
  onFrame() → user texture              ├─ layer.nextDrawable() → current drawable
  blit to swapchain                      ├─ blit drawable.texture → persistent texture
  device.queue.submit()                  ├─ publishFrameTexture on command buffer
  surface.present()                      ├─ commit command buffer
  syphon_publish() ─────────────────►    └─ Syphon notifies clients via IOSurface
```

---

## Phase 0: Feasibility Validation

**Goal**: Prove we can reach the CAMetalLayer's drawable texture from Rust, given only the NSView* pointer that `deno_window` already provides.

### What we know
- `deno_window` creates a winit window and extracts the `NSView*` as a `usize` ([lib.rs:218](apps/deno-notebooks/native/deno_window/src/lib.rs#L218): `RawWindowHandle::AppKit(handle) => handle.ns_view as usize`)
- This NSView* is passed to `Deno.UnsafeWindowSurface` which configures wgpu to present into the view's `CAMetalLayer`
- wgpu/Deno internally calls `[layer nextDrawable]` each frame and presents
- After `surface.present()` returns, the drawable is released back to the pool

### The critical question
Can we call `nextDrawable()` on the same `CAMetalLayer` from our Rust FFI **after** Deno has already presented, and get a reference to the **just-presented** drawable's texture?

**Answer: No.** After `present()`, the drawable is returned to the pool. We cannot retrieve the "last presented" texture this way.

### The actual approach: Post-present blit from the CAMetalLayer's internal state

Instead of intercepting `nextDrawable()`, we use a **simpler and more robust** approach:

1. **Before `surface.present()`** in the Deno render loop, call an FFI function that:
   - Gets the `CAMetalLayer` from the NSView
   - Calls `[layer nextDrawable]` to get the **current** drawable (the one Deno just rendered into)
   - Wait — this won't work either, because wgpu already called `nextDrawable()` and the drawable is in-flight

### Revised approach: GPU blit from an offscreen WebGPU texture

The cleanest approach that avoids all drawable lifetime issues:

1. **User renders to their own offscreen `GPUTexture`** (they already do this — see `onFrame()` in [render_loop.ts:32](apps/deno-notebooks/window/render_loop.ts#L32))
2. **The render loop blits the offscreen texture to the swapchain** for window display (already happens via [blit.ts](apps/deno-notebooks/window/blit.ts))
3. **In parallel**, we pass the offscreen texture's underlying `MTLTexture` pointer to Rust, which publishes it to Syphon

**Problem**: WebGPU doesn't expose the underlying `MTLTexture` pointer. Deno's WebGPU API is sandboxed.

### Final approach: CAMetalLayer interception via custom NSView subclass

This is the approach outlined in [initial_syphon_plan.md](initial_syphon_plan.md). We create a custom `NSView` subclass whose `-makeBackingLayer` returns our `CAMetalLayer` subclass. Our layer subclass intercepts `nextDrawable()` to capture each drawable before wgpu uses it.

**Sequence per frame:**
1. wgpu calls `[layer nextDrawable]` → our override fires, stashes `(frame_id, drawable)` in a ring buffer
2. wgpu renders into the drawable's texture
3. wgpu calls `[drawable present]`
4. From Deno JS, call `syphon_publish_frame(state, frame_id)` via FFI
5. Rust: look up the drawable in the ring, GPU-blit its texture into a persistent texture, publish via Syphon
6. Release the drawable reference

**Key insight**: We only need to hold an extra reference to the drawable long enough for the blit. Since `present()` doesn't immediately reclaim the drawable (it goes back to the pool once the display is done with it), holding a brief extra reference is safe as long as we release promptly.

**However**, there's a simpler variant: since Syphon's `publishFrameTexture:onCommandBuffer:imageRegion:flipped:` already **copies the texture internally** (it blits into its own IOSurface-backed texture), we can publish the drawable's texture directly and Syphon handles the copy.

---

## Phase 1: Rust Crate — `syphon_bridge`

### Location
```
apps/deno-notebooks/native/syphon_bridge/
├── Cargo.toml
├── build.rs
└── src/
    ├── lib.rs          # FFI exports
    ├── objc_classes.rs  # Objective-C class declarations & subclasses
    └── state.rs         # SyphonState struct and logic
```

### Cargo.toml
```toml
[package]
name = "syphon_bridge"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
objc2 = "0.6"
objc2-foundation = { version = "0.3", features = [
    "NSBundle", "NSString", "NSArray", "NSDictionary",
    "NSNotification", "NSObject", "NSThread"
] }
objc2-quartz-core = { version = "0.3", features = [
    "CALayer", "CAMetalLayer", "CAMetalDrawable"
] }
objc2-metal = { version = "0.3", features = [
    "MTLDevice", "MTLTexture", "MTLCommandBuffer", "MTLCommandQueue",
    "MTLCommandEncoder", "MTLBlitCommandEncoder", "MTLResource",
    "MTLPixelFormat"
] }
objc2-app-kit = { version = "0.3", features = ["NSView", "NSResponder"] }
block2 = "0.6"

[profile.release]
panic = "abort"
lto = true
codegen-units = 1
```

> **Note on versions**: The `objc2` ecosystem versions should be pinned to the latest compatible set. Check crates.io at build time — the versions above are representative of the 0.3.x/0.6.x line current as of early 2025. The exact feature flags may need adjustment based on which API surface each sub-crate exposes.

### build.rs
```rust
fn main() {
    // System frameworks needed at link time
    println!("cargo::rustc-link-lib=framework=Metal");
    println!("cargo::rustc-link-lib=framework=QuartzCore");
    println!("cargo::rustc-link-lib=framework=Foundation");
    println!("cargo::rustc-link-lib=framework=AppKit");
    println!("cargo::rustc-link-lib=framework=IOSurface");

    // Syphon.framework is loaded at runtime via NSBundle, not linked
}
```

### Key Design Decisions

#### Loading Syphon.framework at runtime (not link-time)
Syphon.framework is not a system framework. Rather than requiring it in a framework search path at compile time, we load it at runtime via `NSBundle::bundleWithPath()`. This is the pattern used by [syphon-python](https://github.com/cansik/syphon-python) and is more flexible for distribution.

#### Syphon.framework distribution strategy

**For end users**: A pre-built `Syphon.framework` is committed to the repo at `apps/deno-notebooks/native/syphon_bridge/frameworks/Syphon.framework`. This is a Release build of the framework, checked into git so that end users don't need Xcode or the Syphon source to use this module. The Rust code looks for it at this path by default (relative to the dylib location).

**For developers** modifying the Syphon integration or updating the framework version: Clone the Syphon-Framework repo locally (already at `Syphon-Framework/` in this repo) and rebuild:
```bash
xcodebuild -project Syphon-Framework/Syphon.xcodeproj \
  -scheme Syphon -configuration Release \
  -derivedDataPath build/syphon \
  ONLY_ACTIVE_ARCH=NO
# Then copy the built framework into the committed location:
rm -rf apps/deno-notebooks/native/syphon_bridge/frameworks/Syphon.framework
cp -R build/syphon/Build/Products/Release/Syphon.framework \
  apps/deno-notebooks/native/syphon_bridge/frameworks/
```

**Framework search order** (in `load_syphon_framework()`):
1. Explicit path if provided via `frameworkPath` option (for advanced users / testing)
2. `<dylib_dir>/frameworks/Syphon.framework` — the bundled copy next to `libsyphon_bridge.dylib`
3. `~/Library/Frameworks/Syphon.framework` — user-installed location
4. `/Library/Frameworks/Syphon.framework` — system-wide location

This means the default case (end user) requires zero configuration — the framework is found automatically next to the dylib.

#### Accessing Syphon classes via raw `objc2` messaging
Since we load Syphon at runtime, we can't use `extern_class!` with static linking. Instead:
```rust
use objc2::runtime::AnyClass;
use objc2::msg_send;

fn get_syphon_server_class() -> &'static AnyClass {
    AnyClass::get("SyphonMetalServer")
        .expect("SyphonMetalServer class not found — is Syphon.framework loaded?")
}
```

#### CAMetalLayer interception: Custom NSView subclass vs. post-hoc layer access

**Option A: Custom NSView subclass** (from the original plan)
- Override `makeBackingLayer` to return a `CAMetalLayer` subclass that intercepts `nextDrawable()`
- **Problem**: The NSView must be created *before* passing it to Deno/wgpu. This means `syphon_bridge` must create the window, not `deno_window`. This couples the two crates.

**Option B: Access the existing layer after window creation** (simpler)
- After `createGpuWindow()` returns, the NSView already has a `CAMetalLayer` (set up by wgpu)
- From Rust, given the NSView pointer: `let layer = msg_send![ns_view, layer]` → cast to `CAMetalLayer`
- Get the `MTLDevice` from the layer: `let device = msg_send![layer, device]`
- Create a `SyphonMetalServer` with this device
- Each frame, after wgpu renders but **before** `surface.present()`:
  - Call `[layer nextDrawable]` — but wait, wgpu already consumed the current drawable

**Option C: Observe the drawable via layer properties**
- `CAMetalLayer` doesn't expose "the last presented drawable" — `nextDrawable()` gives the *next* one

**Option B revised: Use a separate command queue on the same device**

After wgpu presents, the texture data is in the CAMetalLayer's internal IOSurface. We can't easily get at it without intercepting the drawable.

### Chosen approach: Option A (Custom NSView) — but with a twist

We modify `deno_window` to accept an **externally-provided NSView pointer** instead of always creating its own. Then `syphon_bridge` creates the custom NSView with the intercepting layer, and passes it to `deno_window`.

**Alternative simpler approach**: `syphon_bridge` **replaces** the layer on the existing NSView after window creation but before WebGPU surface creation. This is a one-time operation:

```rust
// After deno_window creates the window but BEFORE createGpuWindow configures the surface:
let ns_view: *mut NSView = /* from get_raw_window_handle */;
let intercepting_layer = InterceptingMetalLayer::new();
msg_send![ns_view, setLayer: intercepting_layer];
msg_send![ns_view, setWantsLayer: true];
```

**But this is fragile** — wgpu may replace the layer during surface configuration.

### FINAL CHOSEN APPROACH: Separate offscreen texture path

After extensive analysis, the cleanest approach that works **without modifying `deno_window`** and **without fighting wgpu's layer management** is:

1. `syphon_bridge` creates its own `MTLDevice` + `MTLCommandQueue` + persistent `MTLTexture` (IOSurface-backed)
2. The persistent texture is the same device as wgpu's (we get the device from the NSView's CAMetalLayer)
3. We expose the IOSurface as a Deno-visible `GPUTexture` — **but WebGPU doesn't support importing external textures**

### TRULY FINAL APPROACH: Intercept at the Deno render loop level

The user's `onFrame()` callback returns a `GPUTextureView` pointing at their offscreen render target. The render loop then blits this to the swapchain. We add a **second blit** — from the swapchain texture (after it's been written) to a Syphon-published texture — all on the GPU.

But we still can't get the MTLTexture pointer from WebGPU.

### ACTUAL IMPLEMENTATION: Layer interception with `syphon_bridge` owning the window

The approach that works cleanly requires `syphon_bridge` to **own the NSView creation** so it can install the intercepting layer. Here's how:

---

## Revised Architecture

```
syphon_bridge (Rust cdylib)
├── Creates NSView with InterceptingMetalLayer (CAMetalLayer subclass)
├── Returns NSView* to Deno
├── Deno passes NSView* to Deno.UnsafeWindowSurface (skipping deno_window's view)
├── InterceptingMetalLayer.nextDrawable() stashes each drawable in a ring buffer
├── After each frame render + present, Deno calls syphon_publish()
├── syphon_publish() retrieves the stashed drawable, publishes its texture to Syphon
└── Releases drawable reference
```

**This means `syphon_bridge` subsumes part of `deno_window`'s responsibility** (the NSView creation), but `deno_window` still handles the winit event loop and window chrome. We modify `deno_window` minimally to accept an external NSView.

### Cleaner alternative: Extend `deno_window` to support a "layer hook"

Add a callback to `deno_window` that fires with the NSView pointer after the window is created but before returning. The callback installs the intercepting layer. This keeps the crates decoupled.

---

## Revised Phase 1: Extend `deno_window` with a view hook

### Changes to `deno_window`

Add a new FFI function:
```rust
/// Returns the NSView* pointer for the window (macOS only).
/// This is the same value as get_raw_window_handle on macOS.
#[no_mangle]
pub extern "C" fn get_ns_view(state: *mut WindowState) -> usize {
    // Already implemented as get_raw_window_handle on macOS
    get_raw_window_handle(state)
}
```

No changes needed — `get_raw_window_handle` already returns the NSView* on macOS.

## Phase 1 (Revised): `syphon_bridge` Crate

### Strategy: Post-hoc layer replacement

After `deno_window` creates the window but **before** `createGpuWindow()` calls `Deno.UnsafeWindowSurface()`, we:

1. Call `syphon_init(ns_view_ptr)` from Deno
2. In Rust, replace the NSView's layer with our `InterceptingMetalLayer`
3. Then proceed with `createGpuWindow()` which will configure wgpu on our custom layer
4. wgpu's `nextDrawable()` calls go through our layer's override

### FFI Surface

```rust
// ── Lifecycle ──────────────────────────────────────────────
#[no_mangle]
pub extern "C" fn syphon_init(
    ns_view_ptr: usize,           // NSView* from deno_window
    name_ptr: *const u8,          // UTF-8 server name
    name_len: u32,
    framework_path_ptr: *const u8, // OPTIONAL: explicit path to Syphon.framework (null = auto-detect)
    framework_path_len: u32,       // 0 if framework_path_ptr is null
) -> *mut SyphonState;
// When framework_path_ptr is null, searches: <dylib_dir>/frameworks/, ~/Library/Frameworks/, /Library/Frameworks/

#[no_mangle]
pub extern "C" fn syphon_destroy(state: *mut SyphonState);

// ── Per-frame ──────────────────────────────────────────────
/// Call AFTER rendering but BEFORE surface.present().
/// Returns the frame_id of the captured drawable.
#[no_mangle]
pub extern "C" fn syphon_latch_and_publish(state: *mut SyphonState) -> u64;

// ── Queries ────────────────────────────────────────────────
#[no_mangle]
pub extern "C" fn syphon_has_clients(state: *mut SyphonState) -> u32;

#[no_mangle]
pub extern "C" fn syphon_set_name(
    state: *mut SyphonState,
    name_ptr: *const u8,
    name_len: u32,
);

// ── Diagnostics (for automated testing) ────────────────────
/// Returns the number of times nextDrawable() has been intercepted.
#[no_mangle]
pub extern "C" fn syphon_get_intercept_count(state: *mut SyphonState) -> u64;

/// Returns 1 if the SyphonMetalServer has been lazily initialized, 0 otherwise.
#[no_mangle]
pub extern "C" fn syphon_is_server_ready(state: *mut SyphonState) -> u32;

/// Returns the width and height of the last published texture (0,0 if none).
#[no_mangle]
pub extern "C" fn syphon_get_last_texture_size(
    state: *mut SyphonState,
    out_w: *mut u32,
    out_h: *mut u32,
);

/// Writes the server name (UTF-8) into the provided buffer.
/// Returns required size. If buf is null or too small, writes nothing.
#[no_mangle]
pub extern "C" fn syphon_get_server_name(
    state: *mut SyphonState,
    buf_ptr: *mut u8,
    buf_cap: u32,
) -> u32;
```

### Internal Implementation

#### `InterceptingMetalLayer` — CAMetalLayer subclass defined in Rust

Using `objc2`'s `define_class!` macro:

```rust
use objc2::define_class;
use objc2::rc::Retained;
use objc2_quartz_core::{CAMetalLayer, CAMetalDrawable};
use std::sync::atomic::{AtomicU64, Ordering};

struct InterceptingIvars {
    frame_id: AtomicU64,
    // Ring buffer of (frame_id, drawable) — 3 entries for triple buffering
    ring: Mutex<[(u64, Option<Retained<ProtocolObject<dyn CAMetalDrawable>>>); 3]>,
    ring_idx: AtomicUsize,
}

define_class!(
    #[unsafe(super = CAMetalLayer)]
    #[ivars = InterceptingIvars]
    struct InterceptingMetalLayer;

    unsafe impl InterceptingMetalLayer {
        #[method_id(nextDrawable)]
        fn next_drawable(&self) -> Option<Retained<ProtocolObject<dyn CAMetalDrawable>>> {
            // Call super
            let drawable: Option<Retained<_>> = unsafe { msg_send_id![super(self), nextDrawable] };

            if let Some(ref d) = drawable {
                let fid = self.ivars().frame_id.fetch_add(1, Ordering::SeqCst);
                let idx = self.ivars().ring_idx.fetch_add(1, Ordering::SeqCst) % 3;
                let mut ring = self.ivars().ring.lock().unwrap();
                ring[idx] = (fid, Some(d.clone()));
            }

            drawable
        }
    }
);
```

> **Note**: The exact `define_class!` syntax for overriding a method like `nextDrawable` that returns `id<CAMetalDrawable>` (a protocol object) may need adjustment based on the `objc2` version. The `msg_send_id!` macro handles the retain semantics. This is the conceptually correct pattern — exact syntax should be validated against `objc2` 0.6.x docs.

#### `SyphonState` struct

```rust
pub struct SyphonState {
    ns_view: *mut AnyObject,        // Retained NSView reference
    layer: Retained<InterceptingMetalLayer>,
    device: Retained<ProtocolObject<dyn MTLDevice>>,
    command_queue: Retained<ProtocolObject<dyn MTLCommandQueue>>,
    syphon_server: Retained<AnyObject>, // SyphonMetalServer (loaded at runtime)
    frame_id: AtomicU64,
}
```

#### `syphon_init` implementation outline

```rust
pub extern "C" fn syphon_init(...) -> *mut SyphonState {
    // 1. Load Syphon.framework (auto-detect or use explicit path)
    let fw_path = if framework_path_ptr.is_null() {
        find_syphon_framework() // searches <dylib_dir>/frameworks/, ~/Library/Frameworks/, etc.
    } else {
        String::from(framework_path)
    };
    let bundle_path = NSString::from_str(&fw_path);
    let bundle = NSBundle::bundleWithPath(&bundle_path).expect("Syphon.framework not found");
    bundle.load();

    // 2. Create InterceptingMetalLayer
    let layer = InterceptingMetalLayer::new();

    // 3. Install on NSView
    let ns_view: &NSView = unsafe { &*(ns_view_ptr as *const NSView) };
    ns_view.setWantsLayer(true);
    ns_view.setLayer(Some(&layer));

    // 4. Wait for wgpu to configure the layer (device will be set by wgpu later)
    //    We defer device/server creation to the first publish call
    //    OR we can create the server lazily

    Box::into_raw(Box::new(SyphonState { ... }))
}
```

**Important timing issue**: When `syphon_init` runs, wgpu hasn't configured the layer yet (no device, no pixel format). The `MTLDevice` is set by wgpu during `surface.configure()`. We must handle this:

**Solution**: Lazy initialization. The `SyphonMetalServer` and `MTLCommandQueue` are created on the first call to `syphon_latch_and_publish`, by which point wgpu has configured the layer's device.

#### `syphon_latch_and_publish` implementation outline

```rust
pub extern "C" fn syphon_latch_and_publish(state: *mut SyphonState) -> u64 {
    let state = unsafe { &mut *state };

    // Lazy init: create server + command queue on first call
    if state.syphon_server.is_none() {
        let device = state.layer.device(); // Now set by wgpu
        let queue = device.newCommandQueue();
        let server_class = AnyClass::get("SyphonMetalServer").unwrap();
        let server = msg_send_id![
            msg_send_id![server_class, alloc],
            initWithName: &*state.name,
            device: &*device,
            options: std::ptr::null::<AnyObject>()
        ];
        state.device = Some(device);
        state.command_queue = Some(queue);
        state.syphon_server = Some(server);
    }

    // Get the latest drawable from the ring buffer
    let ring = state.layer.ivars().ring.lock().unwrap();
    let latest_idx = (state.layer.ivars().ring_idx.load(Ordering::SeqCst) - 1) % 3;
    let (frame_id, drawable_opt) = &ring[latest_idx];

    if let Some(drawable) = drawable_opt {
        let texture = drawable.texture();
        let size = NSRect::new(
            NSPoint::new(0.0, 0.0),
            NSSize::new(texture.width() as f64, texture.height() as f64),
        );

        let cmd_buf = state.command_queue.commandBuffer();

        // Syphon copies the texture internally via blit or shader
        msg_send![
            &*state.syphon_server.as_ref().unwrap(),
            publishFrameTexture: &*texture,
            onCommandBuffer: &*cmd_buf,
            imageRegion: size,
            flipped: false
        ];

        cmd_buf.commit();

        return *frame_id;
    }

    0 // No drawable available
}
```

### Drawable lifetime considerations

The key risk is holding a drawable reference too long, starving the `CAMetalLayer` pool. Mitigations:

1. **Release immediately after publish**: After `publishFrameTexture:onCommandBuffer:` encodes the blit, we can release our reference to the drawable. Syphon's blit is GPU-side; it doesn't need the drawable CPU-side after encoding.

2. **Triple buffering**: `CAMetalLayer` typically has 3 drawables. Holding one extra briefly is fine.

3. **Ring buffer cleanup**: The ring buffer holds at most 3 entries. Each new `nextDrawable()` overwrites the oldest slot, releasing its drawable reference.

4. **Timeout**: If `syphon_latch_and_publish` isn't called for a few frames, the ring buffer naturally drains as new drawables overwrite old entries.

---

## Phase 2: TypeScript FFI Bindings

### Location
```
apps/deno-notebooks/syphon/
├── ffi.ts       # Raw FFI symbol definitions and library loading
├── syphon.ts    # High-level SyphonServer class
└── mod.ts       # Public exports
```

### `ffi.ts`

```typescript
export const FFI_SYMBOLS = {
  syphon_init: {
    parameters: ["usize", "pointer", "u32", "pointer", "u32"],
    result: "pointer",
  },
  syphon_destroy: {
    parameters: ["pointer"],
    result: "void",
  },
  syphon_latch_and_publish: {
    parameters: ["pointer"],
    result: "u64",
  },
  syphon_has_clients: {
    parameters: ["pointer"],
    result: "u32",
  },
  syphon_set_name: {
    parameters: ["pointer", "pointer", "u32"],
    result: "void",
  },
  // Diagnostics (for automated testing)
  syphon_get_intercept_count: {
    parameters: ["pointer"],
    result: "u64",
  },
  syphon_is_server_ready: {
    parameters: ["pointer"],
    result: "u32",
  },
  syphon_get_last_texture_size: {
    parameters: ["pointer", "pointer", "pointer"],
    result: "void",
  },
  syphon_get_server_name: {
    parameters: ["pointer", "pointer", "u32"],
    result: "u32",
  },
} as const;
```

### `syphon.ts` — High-level API

```typescript
export interface SyphonOptions {
  serverName?: string;
  frameworkPath?: string; // optional override; default: auto-detected by Rust (bundled copy next to dylib)
  libPath?: string;       // path to libsyphon_bridge.dylib
}

export class SyphonServer {
  #state: Deno.PointerValue;
  #lib: Deno.DynamicLibrary<typeof FFI_SYMBOLS>;

  constructor(nsViewPtr: bigint | number, options?: SyphonOptions) {
    this.#lib = openLibrary(options?.libPath);
    const name = encodeString(options?.serverName ?? "Deno Syphon");
    // Pass null for framework path to let Rust auto-detect (bundled copy next to dylib)
    const fwPath = options?.frameworkPath ? encodeString(options.frameworkPath) : { ptr: null, len: 0 };
    this.#state = this.#lib.symbols.syphon_init(
      nsViewPtr,
      name.ptr, name.len,
      fwPath.ptr, fwPath.len,
    );
    if (!this.#state) throw new Error("Failed to init Syphon bridge");
  }

  /** Call after rendering, before surface.present() */
  publishFrame(): bigint {
    return this.#lib.symbols.syphon_latch_and_publish(this.#state);
  }

  get hasClients(): boolean {
    return this.#lib.symbols.syphon_has_clients(this.#state) !== 0;
  }

  set name(n: string) {
    const { ptr, len } = encodeString(n);
    this.#lib.symbols.syphon_set_name(this.#state, ptr, len);
  }

  destroy() {
    this.#lib.symbols.syphon_destroy(this.#state);
    this.#lib.close();
  }
}
```

---

## Phase 3: Integration with the Render Loop

### Modified `createGpuWindow` flow

The integration requires a specific ordering:

```typescript
// 1. Create window (gets NSView*)
const lib = openWindowLibrary();
const windowState = lib.symbols.create_window(w, h, titlePtr, titleLen);
const nsViewPtr = lib.symbols.get_raw_window_handle(windowState);

// 2. Install intercepting layer BEFORE WebGPU surface creation
const syphon = new SyphonServer(nsViewPtr, {
  serverName: "My Deno App",
  // frameworkPath is auto-detected (bundled Syphon.framework next to dylib)
});

// 3. NOW create the WebGPU surface (wgpu configures our intercepting layer)
const surface = new Deno.UnsafeWindowSurface({ system: "cocoa", ... });
const ctx = surface.getContext("webgpu");
ctx.configure({ device, format, ... });

// 4. Render loop
while (running) {
  const outputView = onFrame(frameNum);
  const swapTexture = ctx.getCurrentTexture();
  // blit outputView → swapTexture
  device.queue.submit([encoder.finish()]);

  // Publish to Syphon BEFORE present (drawable is still valid)
  syphon.publishFrame();

  surface.present();
}

// 5. Cleanup
syphon.destroy();
```

### Modified `render_loop.ts`

Add optional Syphon support to `startRenderLoop`:

```typescript
export interface RenderLoopOptions {
  window: GpuWindow;
  blitPipeline: BlitPipeline;
  onFrame: (frameNumber: number) => GPUTextureView;
  onEvent?: (event: WindowEvent) => void;
  syphon?: SyphonServer; // NEW: optional Syphon publisher
}

// In the loop body, after blit + submit but before present:
if (options.syphon) {
  options.syphon.publishFrame();
}
options.window.present();
```

### Alternatively: `createSyphonGpuWindow` helper

A convenience function that handles the ordering:

```typescript
export async function createSyphonGpuWindow(
  device: GPUDevice,
  options: WindowOptions & SyphonOptions,
): Promise<GpuWindow & { syphon: SyphonServer }> {
  // 1. Create native window
  // 2. Init syphon (installs intercepting layer)
  // 3. Create WebGPU surface
  // 4. Return combined object
}
```

---

## Phase 4: Build System

### Build script: `scripts/build_syphon_bridge.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Build the Rust crate
cargo build --release --manifest-path "$root_dir/native/syphon_bridge/Cargo.toml"

echo "Built $root_dir/native/syphon_bridge/target/release/libsyphon_bridge.dylib"
```

### Pre-built Syphon.framework (committed to repo)

A pre-built `Syphon.framework` is committed at:
```
apps/deno-notebooks/native/syphon_bridge/frameworks/Syphon.framework
```

This is what end users consume — no Xcode or Syphon source needed. The Rust auto-detection finds it relative to `libsyphon_bridge.dylib`.

### Rebuilding Syphon.framework (for developers only)

If you need to update the bundled framework (e.g., after pulling a new Syphon-Framework version):

```bash
# 1. Clone Syphon-Framework if not already present
#    (already at Syphon-Framework/ in this repo)

# 2. Build from source (requires Xcode CLI tools)
xcodebuild -project Syphon-Framework/Syphon.xcodeproj \
  -scheme Syphon \
  -configuration Release \
  -derivedDataPath build/syphon \
  ONLY_ACTIVE_ARCH=NO

# 3. Copy into the committed location
rm -rf apps/deno-notebooks/native/syphon_bridge/frameworks/Syphon.framework
cp -R build/syphon/Build/Products/Release/Syphon.framework \
  apps/deno-notebooks/native/syphon_bridge/frameworks/

# 4. Commit the updated framework
git add apps/deno-notebooks/native/syphon_bridge/frameworks/Syphon.framework
git commit -m "Update bundled Syphon.framework"
```

### .gitignore additions
```
native/syphon_bridge/target/
build/syphon/
# NOTE: native/syphon_bridge/frameworks/Syphon.framework is intentionally tracked in git
```

---

## Phase 5: Testing & Validation (Automated CLI Tests)

Every test below is designed to be **run from the command line** and **exit with code 0 on success, non-zero on failure**. A coding agent can iterate by running these tests after each change.

### Test Tier 0: Build verification

These must pass before any runtime tests.

```bash
# T0-a: Bundled Syphon.framework exists
test -d apps/deno-notebooks/native/syphon_bridge/frameworks/Syphon.framework
# Exit 0 = pass. The pre-built framework is committed in the repo.
# If missing, a developer must build from source (see Phase 4).

# T0-b: syphon_bridge Rust crate compiles
cargo build --release --manifest-path apps/deno-notebooks/native/syphon_bridge/Cargo.toml
# Exit 0 = pass. Produces libsyphon_bridge.dylib
```

**Agent workflow**: Run T0-a and T0-b after any Rust or build.rs change. If T0-a fails, the bundled Syphon.framework is missing — build from source per Phase 4 instructions. If T0-b fails, fix the Rust code before proceeding.

### Test Tier 1: Rust unit tests (no GPU required)

Add `#[cfg(test)]` module in `src/lib.rs` or `src/state.rs` for logic that doesn't need a real Metal device:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_buffer_wraps_correctly() {
        // Test that the ring buffer stores and overwrites entries correctly
        // Test that frame_id increments monotonically
        // Test edge case: reading from empty ring returns None
    }

    #[test]
    fn syphon_framework_loads() {
        // Attempt to load Syphon.framework from the build output path
        // Assert that the SyphonMetalServer class is available
        // Uses the bundled framework committed alongside the crate
        let loaded = load_syphon_framework("frameworks/Syphon.framework");
        assert!(loaded, "Syphon.framework failed to load");
        let cls = objc2::runtime::AnyClass::get("SyphonMetalServer");
        assert!(cls.is_some(), "SyphonMetalServer class not found after loading");
    }

    #[test]
    fn syphon_framework_classes_available() {
        // After loading, verify all needed classes exist
        load_syphon_framework("...");
        for name in ["SyphonMetalServer", "SyphonMetalClient", "SyphonServerDirectory"] {
            assert!(AnyClass::get(name).is_some(), "Class {name} not found");
        }
    }
}
```

```bash
# T1: Run Rust unit tests
cargo test --manifest-path apps/deno-notebooks/native/syphon_bridge/Cargo.toml
# Exit 0 = all tests pass
```

### Test Tier 2: FFI smoke test (Deno loads dylib, calls basic functions)

File: `apps/deno-notebooks/libraryIntegrationTests/syphon-smoke-test.ts`

This test verifies the dylib loads and basic FFI calls work **without creating a window or GPU context**. It exercises the "no-op" paths.

```typescript
/**
 * Smoke test: load libsyphon_bridge.dylib and verify FFI symbols resolve.
 * Run: deno run --unstable-ffi --allow-ffi --allow-env --allow-read syphon-smoke-test.ts
 * Exit 0 = pass, non-zero = fail.
 */

const SYMBOLS = {
  syphon_init: { parameters: ["usize", "pointer", "u32", "pointer", "u32"], result: "pointer" },
  syphon_destroy: { parameters: ["pointer"], result: "void" },
  syphon_latch_and_publish: { parameters: ["pointer"], result: "u64" },
  syphon_has_clients: { parameters: ["pointer"], result: "u32" },
  syphon_set_name: { parameters: ["pointer", "pointer", "u32"], result: "void" },
  syphon_get_intercept_count: { parameters: ["pointer"], result: "u64" },
  syphon_is_server_ready: { parameters: ["pointer"], result: "u32" },
  syphon_get_last_texture_size: { parameters: ["pointer", "pointer", "pointer"], result: "void" },
  syphon_get_server_name: { parameters: ["pointer", "pointer", "u32"], result: "u32" },
} as const;

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`FAIL: ${msg}`); Deno.exit(1); }
}

const lib = Deno.dlopen(
  new URL("../native/syphon_bridge/target/release/libsyphon_bridge.dylib", import.meta.url),
  SYMBOLS,
);
console.log("OK: dylib loaded, all symbols resolved");

// Calling with null state should not crash (functions should null-check)
const nullResult = lib.symbols.syphon_has_clients(null);
assert(nullResult === 0, "syphon_has_clients(null) should return 0");
console.log("OK: null-safety check passed");

const readyResult = lib.symbols.syphon_is_server_ready(null);
assert(readyResult === 0, "syphon_is_server_ready(null) should return 0");
console.log("OK: syphon_is_server_ready(null) = 0");

lib.close();
console.log("ALL SMOKE TESTS PASSED");
Deno.exit(0);
```

```bash
# T2: FFI smoke test
deno run --unstable-ffi --allow-ffi --allow-env --allow-read \
  apps/deno-notebooks/libraryIntegrationTests/syphon-smoke-test.ts
# Exit 0 = pass
```

### Test Tier 3: Windowed integration test (GPU + layer interception)

File: `apps/deno-notebooks/libraryIntegrationTests/syphon-integration-test.ts`

This test creates a real window, installs the intercepting layer, renders N frames via WebGPU, publishes to Syphon, and validates state via the diagnostic FFI functions. It runs for a fixed number of frames then exits — no human interaction needed.

```typescript
/**
 * Integration test: create window, init syphon, render 30 frames, validate.
 * Run: deno run --unstable-ffi --unstable-webgpu --allow-ffi --allow-env --allow-read syphon-integration-test.ts
 * Exit 0 = pass, non-zero = fail.
 */

const TARGET_FRAMES = 30;
const WIDTH = 256;
const HEIGHT = 256;

// 1. Create window via deno_window FFI
// 2. Get NSView pointer
// 3. Call syphon_init(nsViewPtr, ...) to install intercepting layer
// 4. Create Deno.UnsafeWindowSurface on the same NSView
// 5. Configure WebGPU context
// 6. Render TARGET_FRAMES frames (clear to a solid color)
//    Each frame:
//      a. pollEvents()
//      b. getCurrentTexture() + render pass (clear to red)
//      c. submit command buffer
//      d. syphon_latch_and_publish()
//      e. surface.present()
// 7. Assert: syphon_get_intercept_count() >= TARGET_FRAMES
// 8. Assert: syphon_is_server_ready() === 1
// 9. Assert: syphon_get_last_texture_size() === (WIDTH, HEIGHT)
// 10. syphon_destroy() + destroy_window()
// 11. Exit 0

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`FAIL: ${msg}`); Deno.exit(1); }
}

// ... (full implementation follows the createGpuWindow pattern from window.ts
//      but with syphon_init injected between window creation and surface creation)

const interceptCount = lib.symbols.syphon_get_intercept_count(syphonState);
assert(interceptCount >= BigInt(TARGET_FRAMES),
  `Expected >= ${TARGET_FRAMES} intercepts, got ${interceptCount}`);

const serverReady = lib.symbols.syphon_is_server_ready(syphonState);
assert(serverReady === 1, `Server should be ready after publishing, got ${serverReady}`);

const sizeOut = new Uint32Array(2);
lib.symbols.syphon_get_last_texture_size(
  syphonState,
  Deno.UnsafePointer.of(sizeOut.subarray(0, 1)),
  Deno.UnsafePointer.of(sizeOut.subarray(1, 2)),
);
assert(sizeOut[0] === WIDTH, `Expected width ${WIDTH}, got ${sizeOut[0]}`);
assert(sizeOut[1] === HEIGHT, `Expected height ${HEIGHT}, got ${sizeOut[1]}`);

console.log("ALL INTEGRATION TESTS PASSED");
Deno.exit(0);
```

```bash
# T3: Windowed integration test
deno run --unstable-ffi --unstable-webgpu --allow-ffi --allow-env --allow-read \
  apps/deno-notebooks/libraryIntegrationTests/syphon-integration-test.ts
# Exit 0 = pass
```

### Test Tier 4: Two-process Syphon server/client test

File: `apps/deno-notebooks/libraryIntegrationTests/syphon-client-test.ts`

This is the most comprehensive test. It spawns two processes:
1. **Server process**: Renders frames and publishes to Syphon (like T3)
2. **Client process**: Uses `SyphonServerDirectory` + `SyphonMetalClient` to receive frames and validate them

The client needs its own FFI functions exposed from `syphon_bridge`:

```rust
// Additional FFI for client-side testing
#[no_mangle]
pub extern "C" fn syphon_list_servers(buf_ptr: *mut u8, buf_cap: u32) -> u32;
// Returns JSON array of server descriptions: [{"name":"...","appName":"...","uuid":"..."}]

#[no_mangle]
pub extern "C" fn syphon_client_create(
    server_uuid_ptr: *const u8,
    server_uuid_len: u32,
    framework_path_ptr: *const u8,
    framework_path_len: u32,
) -> *mut SyphonClientState;

#[no_mangle]
pub extern "C" fn syphon_client_has_new_frame(state: *mut SyphonClientState) -> u32;

#[no_mangle]
pub extern "C" fn syphon_client_get_frame_size(
    state: *mut SyphonClientState,
    out_w: *mut u32,
    out_h: *mut u32,
) -> u32; // returns 1 if frame available, 0 if not

#[no_mangle]
pub extern "C" fn syphon_client_destroy(state: *mut SyphonClientState);
```

**Test orchestrator** (`syphon-e2e-test.sh`):
```bash
#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== Building syphon_bridge ==="
cargo build --release --manifest-path "$root/native/syphon_bridge/Cargo.toml"

echo "=== Starting Syphon server process ==="
deno run --unstable-ffi --unstable-webgpu --allow-ffi --allow-env --allow-read \
  "$root/libraryIntegrationTests/syphon-server-process.ts" &
SERVER_PID=$!

# Give server time to start and register with Syphon
sleep 3

echo "=== Running Syphon client validation ==="
deno run --unstable-ffi --allow-ffi --allow-env --allow-read \
  "$root/libraryIntegrationTests/syphon-client-process.ts"
CLIENT_EXIT=$?

# Clean up server
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

if [ $CLIENT_EXIT -eq 0 ]; then
  echo "=== E2E TEST PASSED ==="
  exit 0
else
  echo "=== E2E TEST FAILED ==="
  exit 1
fi
```

**`syphon-server-process.ts`** (runs for ~10 seconds then exits):
```typescript
// Creates window, inits syphon server with name "Deno Syphon Test",
// renders 300 frames (solid red), publishes each, then exits.
```

**`syphon-client-process.ts`** (validates server is visible and frames arrive):
```typescript
// 1. Call syphon_list_servers() - assert "Deno Syphon Test" appears
// 2. Create client for that server UUID
// 3. Poll for up to 5 seconds until syphon_client_has_new_frame() returns 1
// 4. Assert frame size matches expected (256x256)
// 5. Destroy client, exit 0
```

```bash
# T4: End-to-end two-process test
bash apps/deno-notebooks/scripts/syphon-e2e-test.sh
# Exit 0 = pass
```

### Master test runner: `scripts/test_syphon.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=============================="
echo "  Syphon Bridge Test Suite"
echo "=============================="

echo ""
echo "--- T0-a: Checking bundled Syphon.framework ---"
if [ ! -d "$root/native/syphon_bridge/frameworks/Syphon.framework" ]; then
  echo "FAIL: Bundled Syphon.framework not found."
  echo "  Build from source: see 'Rebuilding Syphon.framework' in deno-rust-syphon.md"
  exit 1
fi
echo "PASS: Syphon.framework present"

echo ""
echo "--- T0-b: Building syphon_bridge ---"
cargo build --release --manifest-path "$root/native/syphon_bridge/Cargo.toml"
echo "PASS: syphon_bridge built"

echo ""
echo "--- T1: Rust unit tests ---"
cargo test --manifest-path "$root/native/syphon_bridge/Cargo.toml"
echo "PASS: Rust unit tests"

echo ""
echo "--- T2: FFI smoke test ---"
deno run --unstable-ffi --allow-ffi --allow-env --allow-read \
  "$root/libraryIntegrationTests/syphon-smoke-test.ts"
echo "PASS: FFI smoke test"

echo ""
echo "--- T3: Windowed integration test ---"
deno run --unstable-ffi --unstable-webgpu --allow-ffi --allow-env --allow-read \
  "$root/libraryIntegrationTests/syphon-integration-test.ts"
echo "PASS: Windowed integration test"

echo ""
echo "--- T4: E2E server/client test ---"
bash "$root/scripts/syphon-e2e-test.sh"
echo "PASS: E2E test"

echo ""
echo "=============================="
echo "  ALL TESTS PASSED"
echo "=============================="
```

### How a coding agent should use these tests

| After this change... | Run this test | Expected time |
|---------------------|---------------|---------------|
| Any `Cargo.toml` / `build.rs` change | T0-b | ~30s |
| Any Rust source change | T0-b then T1 | ~45s |
| Ring buffer or framework loading logic | T1 | ~15s |
| FFI signature changes | T0-b then T2 | ~35s |
| Layer interception logic | T0-b, T1, T3 | ~60s |
| Publish logic or Syphon server code | T0-b, T1, T3 | ~60s |
| TypeScript binding changes | T2, T3 | ~30s |
| Full validation before PR | `test_syphon.sh` (all) | ~3 min |

### Key constraints for running tests on macOS

- Tests T3 and T4 require a **GPU** (Metal-capable Mac). They will fail in headless CI (Linux containers, etc.)
- Tests T3 and T4 create a **real window** — they work in a normal macOS desktop session (including via SSH with display forwarding disabled — macOS creates offscreen windows fine)
- No tests require **human interaction** — all validate via assert + exit code
- The Deno flags `--unstable-ffi --unstable-webgpu --allow-ffi --allow-env --allow-read` are required and safe for test scripts

---

## Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| wgpu replaces our custom layer during surface configuration | High | Test empirically. If wgpu replaces the layer, we need to override `setLayer:` on the NSView to reject replacements, or use the `makeBackingLayer` approach with a custom NSView subclass. |
| `define_class!` for CAMetalLayer subclass has unexpected limitations in `objc2` | Medium | Fall back to raw `objc2::runtime::ClassBuilder` to register the class manually. The API is lower-level but gives full control. |
| Drawable pool starvation when Syphon publish is slow | Medium | Release drawable reference immediately after encoding the blit command (before committing). Syphon internally copies, so the drawable can be freed. |
| `objc2-quartz-core` doesn't expose `CAMetalDrawable` or `nextDrawable` | Medium | Use raw `msg_send!` / `msg_send_id!` with protocol object casts. The method selector `nextDrawable` is well-known. |
| Syphon.framework built for wrong architecture (x86 vs arm64) | Low | Build universal binary with `ONLY_ACTIVE_ARCH=NO` or match the current system arch. |
| Thread safety: `nextDrawable` called from render thread, publish from main thread | Medium | The ring buffer uses `Mutex` which is safe. Keep critical sections short. The `InterceptingMetalLayer` ivars are designed for concurrent access. |

---

## Alternative Approach: ScreenCaptureKit (rejected)

Using ScreenCaptureKit to capture the window would be simpler (no layer interception needed) but:
- Requires screen recording permission
- Adds latency (at least one frame)
- CPU overhead for the capture pipeline
- Can't capture occluded windows on older macOS versions

The layer interception approach has **zero latency** and **zero CPU readback**.

---

## Alternative Approach: Custom Deno op (rejected)

Adding a Deno runtime op that exposes the underlying `MTLTexture` pointer from a `GPUTexture` would be the cleanest solution, but:
- Requires modifying Deno's source or maintaining a fork
- Not portable
- Breaks the WebGPU abstraction

---

## Summary of Deliverables

1. **`native/syphon_bridge/`** — Rust cdylib crate with:
   - `InterceptingMetalLayer` (CAMetalLayer subclass via `objc2`)
   - Runtime Syphon.framework loading
   - `SyphonMetalServer` wrapper
   - Drawable ring buffer with frame ID tracking
   - 9 FFI functions: `init`, `destroy`, `latch_and_publish`, `has_clients`, `set_name`, `get_intercept_count`, `is_server_ready`, `get_last_texture_size`, `get_server_name`
   - Optional client FFI for E2E testing: `list_servers`, `client_create`, `client_has_new_frame`, `client_get_frame_size`, `client_destroy`
   - Rust unit tests (`cargo test`)

2. **`syphon/`** — TypeScript module with:
   - FFI bindings (`ffi.ts`)
   - `SyphonServer` class (`syphon.ts`)
   - Public exports (`mod.ts`)

3. **Modified `window/window.ts`** — Reordered initialization to support layer interception

4. **Modified `window/render_loop.ts`** — Optional `syphon` parameter for automatic per-frame publishing

5. **`scripts/build_syphon_bridge.sh`** — Build script
6. **`scripts/test_syphon.sh`** — Master test runner (runs all tiers, exits 0/1)
7. **`scripts/syphon-e2e-test.sh`** — Two-process E2E test orchestrator

8. **Test files in `libraryIntegrationTests/`**:
   - `syphon-smoke-test.ts` — T2: dylib loads, null-safety checks
   - `syphon-integration-test.ts` — T3: window + GPU + layer interception + publish validation
   - `syphon-server-process.ts` — T4 server half: renders and publishes for ~10s
   - `syphon-client-process.ts` — T4 client half: discovers server, receives frame, validates size

---

## Implementation Order

Each step below includes the test command a coding agent should run to validate before moving to the next step.

1. **Build Syphon.framework from local clone and bundle it**
   - Run `xcodebuild` against `Syphon-Framework/` (see Phase 4)
   - Copy result to `native/syphon_bridge/frameworks/Syphon.framework`
   - Commit the framework to the repo
   - Validate: `test -d apps/deno-notebooks/native/syphon_bridge/frameworks/Syphon.framework` (T0-a)

2. **Scaffold `native/syphon_bridge/` with Cargo.toml and build.rs**
   - Create minimal `lib.rs` with stub FFI functions that return 0/null
   - Validate: `cargo build --release ...` (T0-b)

3. **Write T2 smoke test (`syphon-smoke-test.ts`)**
   - Validate: `deno run ... syphon-smoke-test.ts` — should pass against stubs (T2)

4. **Implement runtime Syphon.framework loading**
   - Add `load_syphon_framework()` function
   - Add Rust unit test for framework loading
   - Validate: `cargo test ...` (T1)

5. **Implement `InterceptingMetalLayer` with `define_class!` (or `ClassBuilder` fallback)**
   - Add diagnostic FFI: `syphon_get_intercept_count`
   - Validate: T1 (unit tests for ring buffer logic)

6. **Implement `syphon_init` — install layer on NSView**
   - Write T3 integration test (`syphon-integration-test.ts`)
   - Validate: T0-b, T2, T3 — intercept count should be >= TARGET_FRAMES

7. **Implement lazy `SyphonMetalServer` creation**
   - Validate: T3 — `syphon_is_server_ready()` should return 1 after first publish

8. **Implement `syphon_latch_and_publish` with drawable ring buffer**
   - Validate: T3 — `syphon_get_last_texture_size()` should return correct dimensions

9. **Write TypeScript bindings (`syphon/ffi.ts`, `syphon.ts`, `mod.ts`)**
   - Validate: T2, T3

10. **Implement client-side FFI for E2E testing**
    - Write T4 test scripts (`syphon-server-process.ts`, `syphon-client-process.ts`, `syphon-e2e-test.sh`)
    - Validate: T4

11. **Write master test runner and run full suite**
    - Validate: `bash scripts/test_syphon.sh` — all tiers pass

12. **Integrate with `render_loop.ts`** (optional Syphon parameter)
    - Validate: T3 still passes with the new render loop path

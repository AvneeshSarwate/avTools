# Headless Syphon Implementation Plan

## Motivation: Why This Is Necessary

The existing Syphon implementation (`createSyphonGpuWindow`) works by intercepting
`CAMetalLayer.nextDrawable()` on a real macOS window to capture native `MTLTexture`
handles — the only bridge between Deno's WebGPU API and native Metal textures.

This breaks when the window is **occluded** (on a different macOS desktop/Space, or
behind a full-screen app on a single monitor). macOS stops recycling Metal drawables
for occluded windows because the compositor is not presenting them. The drawable pool
(~3 drawables) exhausts, and `getCurrentTexture()` (which calls `nextDrawable`)
**blocks indefinitely**, freezing the entire render loop. Meanwhile, non-GPU async
tasks (like the `core-timing` loop sending OSC messages) continue unaffected because
they don't touch the Metal drawable pipeline.

This is a fundamental macOS compositor behavior — not a bug in wgpu, Deno, or winit.
It cannot be worked around with CAMetalLayer configuration (`displaySyncEnabled`,
`presentsWithTransaction`, `allowsNextDrawableTimeout`), window level tricks, or App
Nap suppression. A detached NSView (no window) also fails because drawable recycling
depends on active compositing.

**The only viable workaround within Deno's WebGPU constraints** is to bypass the
`CAMetalLayer` drawable pipeline entirely: render to an offscreen `GPUTexture`, read
pixels back to CPU via `copyTextureToBuffer` + `mapAsync`, and publish them to Syphon
through a new FFI path that creates its own `MTLTexture` from raw pixel data. On Apple
Silicon's unified memory, 1-frame pipelined readback costs < 0.5ms per frame with
~16ms of added latency — acceptable for most audiovisual installation work.

---

## Overview

This document describes a complete "headless Syphon" mode that publishes frames to
Syphon via CPU readback from a WebGPU offscreen texture, fully decoupled from any
window surface. It runs parallel to the existing `createSyphonGpuWindow` +
intercepting-layer approach. The user picks the mode at sketch creation time.

**Key properties:**
- No window required for Syphon output (optional preview window)
- 1-frame pipelined CPU readback (two staging buffers, ping-pong)
- Timer-driven rendering via `core-timing` instead of vsync
- Cross-platform readback path (works on macOS and Windows)
- Rust side creates its own Metal device + SyphonMetalServer, receives raw pixels via FFI

---

## Part 1: Rust Side (syphon_bridge)

### 1.1 New State Type: `HeadlessSyphonState`

A separate struct from `SyphonState`. It does not have an NSView, layer, drawable
ring, or present-drawable hook. It owns its own Metal device and command queue.

```rust
pub struct HeadlessSyphonState {
    device: *mut Object,           // id<MTLDevice> created by this state
    command_queue: *mut Object,    // id<MTLCommandQueue>
    syphon_server: *mut Object,    // SyphonMetalServer*
    server_name: String,
    framework_hint: Option<String>,

    // Texture pool: two textures for double-buffering on the Rust side.
    // When a frame arrives, we write into texture[write_idx], publish it,
    // then toggle write_idx. This avoids recreating textures each frame.
    textures: [*mut Object; 2],    // id<MTLTexture>
    tex_width: u32,
    tex_height: u32,
    write_idx: usize,

    publish_flipped: AtomicU32,
    published_frame_count: AtomicU64,

    // Debug
    debug_enabled: bool,
    debug_log_interval_ms: u64,
    debug_last_log_ms: AtomicU64,
    debug_last_publish_count: AtomicU64,
}
```

### 1.2 New FFI Functions

#### `syphon_headless_init`

Creates a headless SyphonMetalServer with its own MTLDevice. No NSView, no
CAMetalLayer, no intercepting layer.

```rust
#[no_mangle]
pub extern "C" fn syphon_headless_init(
    name_ptr: *const u8,
    name_len: u32,
    framework_path_ptr: *const u8,
    framework_path_len: u32,
) -> *mut HeadlessSyphonState {
    let server_name = unsafe {
        let decoded = bytes_to_string(name_ptr, name_len);
        if decoded.is_empty() { "Deno Syphon Headless".to_string() } else { decoded }
    };

    let framework_hint = unsafe {
        let decoded = bytes_to_string(framework_path_ptr, framework_path_len);
        if decoded.is_empty() { None } else { Some(decoded) }
    };

    // Load Syphon framework
    let _ = load_syphon_framework(framework_hint.as_deref());
    let server_class = match Class::get("SyphonMetalServer") {
        Some(cls) => cls,
        None => return ptr::null_mut(),
    };

    // Create our own Metal device
    let device = unsafe { MTLCreateSystemDefaultDevice() };
    if device.is_null() {
        return ptr::null_mut();
    }

    let queue: *mut Object = unsafe { msg_send![device, newCommandQueue] };
    if queue.is_null() {
        return ptr::null_mut();
    }

    // Create SyphonMetalServer
    let name = unsafe { nsstring_from_str(&server_name) };
    if name.is_null() {
        unsafe { let _: () = msg_send![queue, release]; }
        return ptr::null_mut();
    }

    let server_alloc: *mut Object = unsafe { msg_send![server_class, alloc] };
    let server: *mut Object = unsafe {
        msg_send![
            server_alloc,
            initWithName: name
            device: device
            options: ptr::null::<Object>()
        ]
    };
    unsafe { let _: () = msg_send![name, release]; }

    if server.is_null() {
        unsafe { let _: () = msg_send![queue, release]; }
        return ptr::null_mut();
    }

    let debug_enabled = env_flag("SYPHON_BRIDGE_DEBUG");
    let debug_log_interval_ms = env_u64("SYPHON_BRIDGE_DEBUG_INTERVAL_MS", 1000);
    let publish_flipped =
        env_flag("SYPHON_BRIDGE_FLIP_Y") || env_flag("SYPHON_BRIDGE_FLIPPED");

    let state = Box::new(HeadlessSyphonState {
        device,
        command_queue: queue,
        syphon_server: server,
        server_name,
        framework_hint,
        textures: [ptr::null_mut(), ptr::null_mut()],
        tex_width: 0,
        tex_height: 0,
        write_idx: 0,
        publish_flipped: AtomicU32::new(u32::from(publish_flipped)),
        published_frame_count: AtomicU64::new(0),
        debug_enabled,
        debug_log_interval_ms,
        debug_last_log_ms: AtomicU64::new(monotonic_millis()),
        debug_last_publish_count: AtomicU64::new(0),
    });

    Box::into_raw(state)
}
```

#### `syphon_headless_publish_frame`

Receives raw pixel data from the TypeScript side, uploads it to an MTLTexture via
`replaceRegion:mipmapLevel:withBytes:bytesPerRow:`, then publishes via
SyphonMetalServer.

```rust
#[no_mangle]
pub extern "C" fn syphon_headless_publish_frame(
    state: *mut HeadlessSyphonState,
    pixel_data: *const u8,
    width: u32,
    height: u32,
    bytes_per_row: u32,
    pixel_format: u32,  // 0 = BGRA8, 1 = RGBA8
) -> u64 {
    if state.is_null() || pixel_data.is_null() || width == 0 || height == 0 {
        return 0;
    }
    let state = unsafe { &mut *state };

    // Ensure textures are the right size. Recreate if dimensions changed.
    if state.tex_width != width || state.tex_height != height {
        unsafe { state.recreate_textures(width, height); }
    }

    let texture = state.textures[state.write_idx];
    if texture.is_null() {
        return 0;
    }

    // Upload pixel data to texture via replaceRegion
    unsafe {
        // MTLRegion { origin: {0,0,0}, size: {width, height, 1} }
        let region = MTLRegion {
            origin: MTLOrigin { x: 0, y: 0, z: 0 },
            size: MTLSize { width: width as u64, height: height as u64, depth: 1 },
        };

        let _: () = msg_send![
            texture,
            replaceRegion: region
            mipmapLevel: 0u64
            withBytes: pixel_data as *const c_void
            bytesPerRow: bytes_per_row as u64
        ];
    }

    // Create command buffer and publish
    unsafe {
        let cmd_buf: *mut Object = msg_send![state.command_queue, commandBuffer];
        if cmd_buf.is_null() {
            return 0;
        }

        let image_region = NSRect {
            origin: NSPoint { x: 0.0, y: 0.0 },
            size: NSSize { width: width as f64, height: height as f64 },
        };

        let flipped = if state.publish_flipped.load(Ordering::Relaxed) != 0 {
            YES
        } else {
            NO
        };

        let _: () = msg_send![
            state.syphon_server,
            publishFrameTexture: texture
            onCommandBuffer: cmd_buf
            imageRegion: image_region
            flipped: flipped
        ];

        // Commit the command buffer so Syphon can read the texture
        let _: () = msg_send![cmd_buf, commit];
    }

    // Toggle write index for double-buffering
    state.write_idx = (state.write_idx + 1) % 2;

    state.published_frame_count.fetch_add(1, Ordering::Relaxed) + 1
}
```

#### Helper: `recreate_textures`

```rust
impl HeadlessSyphonState {
    unsafe fn recreate_textures(&mut self, width: u32, height: u32) {
        // Release old textures
        for tex in &mut self.textures {
            if !tex.is_null() {
                let _: () = msg_send![*tex, release];
                *tex = ptr::null_mut();
            }
        }

        // Create MTLTextureDescriptor
        let desc_cls = Class::get("MTLTextureDescriptor").unwrap();
        let desc: *mut Object = msg_send![desc_cls, texture2DDescriptorWithPixelFormat:
            80u64  // MTLPixelFormatBGRA8Unorm = 80
            width: width as u64
            height: height as u64
            mipmapped: NO
        ];

        // Set usage to ShaderRead (1) so Syphon can sample it
        let _: () = msg_send![desc, setUsage: 1u64]; // MTLTextureUsageShaderRead

        for i in 0..2 {
            let texture: *mut Object = msg_send![self.device, newTextureWithDescriptor: desc];
            self.textures[i] = texture;
        }

        self.tex_width = width;
        self.tex_height = height;
    }
}
```

#### Additional MTL types needed

```rust
#[repr(C)]
#[derive(Clone, Copy)]
struct MTLOrigin {
    x: u64,
    y: u64,
    z: u64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct MTLSize {
    width: u64,
    height: u64,
    depth: u64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct MTLRegion {
    origin: MTLOrigin,
    size: MTLSize,
}
```

#### `syphon_headless_destroy`

```rust
#[no_mangle]
pub extern "C" fn syphon_headless_destroy(state: *mut HeadlessSyphonState) {
    if state.is_null() {
        return;
    }
    unsafe {
        drop(Box::from_raw(state));
    }
}
```

The `Drop` impl for `HeadlessSyphonState`:

```rust
impl Drop for HeadlessSyphonState {
    fn drop(&mut self) {
        if !self.syphon_server.is_null() {
            unsafe {
                if responds_to_selector(self.syphon_server, sel!(stop)) {
                    let _: () = msg_send![self.syphon_server, stop];
                }
                let _: () = msg_send![self.syphon_server, release];
            }
            self.syphon_server = ptr::null_mut();
        }
        for tex in &mut self.textures {
            if !tex.is_null() {
                unsafe { let _: () = msg_send![*tex, release]; }
                *tex = ptr::null_mut();
            }
        }
        if !self.command_queue.is_null() {
            unsafe { let _: () = msg_send![self.command_queue, release]; }
            self.command_queue = ptr::null_mut();
        }
        // Note: do NOT release device -- MTLCreateSystemDefaultDevice returns
        // an autoreleased singleton on modern macOS. Releasing it can crash.
    }
}
```

#### Utility FFI functions (mirror existing API)

```rust
#[no_mangle]
pub extern "C" fn syphon_headless_has_clients(state: *mut HeadlessSyphonState) -> u32 {
    if state.is_null() { return 0; }
    let state = unsafe { &*state };
    if state.syphon_server.is_null() { return 0; }
    let has: BOOL = unsafe { msg_send![state.syphon_server, hasClients] };
    u32::from(has == YES)
}

#[no_mangle]
pub extern "C" fn syphon_headless_set_name(
    state: *mut HeadlessSyphonState,
    name_ptr: *const u8,
    name_len: u32,
) {
    if state.is_null() { return; }
    let new_name = unsafe { bytes_to_string(name_ptr, name_len) };
    if new_name.is_empty() { return; }
    let state = unsafe { &mut *state };
    state.server_name = new_name.clone();
    if !state.syphon_server.is_null() {
        unsafe {
            if responds_to_selector(state.syphon_server, sel!(setName:)) {
                let ns_name = nsstring_from_str(&new_name);
                if !ns_name.is_null() {
                    let _: () = msg_send![state.syphon_server, setName: ns_name];
                    let _: () = msg_send![ns_name, release];
                }
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn syphon_headless_set_flipped(
    state: *mut HeadlessSyphonState,
    flipped: u32,
) {
    if state.is_null() { return; }
    let state = unsafe { &*state };
    state.publish_flipped.store(u32::from(flipped != 0), Ordering::Relaxed);
}

#[no_mangle]
pub extern "C" fn syphon_headless_get_published_count(
    state: *mut HeadlessSyphonState,
) -> u64 {
    if state.is_null() { return 0; }
    let state = unsafe { &*state };
    state.published_frame_count.load(Ordering::Relaxed)
}
```

#### Non-macOS stubs

All headless functions get no-op stubs in the `#[cfg(not(target_os = "macos"))]`
module, exactly as the existing functions do.

### 1.3 Pixel Format Decision

**WebGPU's preferred canvas format on macOS is `bgra8unorm`.** The offscreen
render texture will use `bgra8unorm` as well. The MTLTexture we create in Rust
uses `MTLPixelFormatBGRA8Unorm` (value 80). This means **no pixel format
conversion is needed** on either side. The bytes flow as BGRA from WebGPU through
the staging buffer into Rust and directly into the MTLTexture.

The `pixel_format` parameter on `syphon_headless_publish_frame` is reserved for
future use (e.g., if someone renders to `rgba8unorm` and needs a swizzle on the
Rust side). For now, always pass 0 (BGRA8).

### 1.4 `replaceRegion` vs Blit Command Encoder

We use `replaceRegion:mipmapLevel:withBytes:bytesPerRow:` (CPU upload) rather
than a blit command encoder for these reasons:

1. The data is already in CPU memory (mapped staging buffer). A blit encoder
   would require first uploading to a staging MTLBuffer, then blitting to
   texture -- two steps instead of one.
2. `replaceRegion` is synchronous and does not require a command buffer for the
   upload itself. We only need the command buffer for the Syphon publish call.
3. For 1920x1080 BGRA8 (~8MB), `replaceRegion` is fast enough. Metal internally
   uses DMA for this on Apple Silicon.

### 1.5 Texture Reuse Strategy

We use a pool of 2 textures (double-buffered on the Rust side). This prevents
Syphon from reading a texture while we are writing to it. The `write_idx`
alternates between 0 and 1 each frame. Since Syphon retains the published
texture until the next publish, this gives exactly the overlap protection needed.

If the frame dimensions change (e.g., user resizes the optional preview window),
both textures are destroyed and recreated at the new size. This is a rare event.

---

## Part 2: TypeScript Side

### 2.1 FFI Symbol Additions

Add to `ffi.ts`:

```typescript
// Headless Syphon FFI symbols -- append to FFI_SYMBOLS
syphon_headless_init: {
  parameters: ["pointer", "u32", "pointer", "u32"],
  result: "pointer",
},
syphon_headless_destroy: {
  parameters: ["pointer"],
  result: "void",
},
syphon_headless_publish_frame: {
  parameters: ["pointer", "pointer", "u32", "u32", "u32", "u32"],
  result: "u64",
},
syphon_headless_has_clients: {
  parameters: ["pointer"],
  result: "u32",
},
syphon_headless_set_name: {
  parameters: ["pointer", "pointer", "u32"],
  result: "void",
},
syphon_headless_set_flipped: {
  parameters: ["pointer", "u32"],
  result: "void",
},
syphon_headless_get_published_count: {
  parameters: ["pointer"],
  result: "u64",
},
```

### 2.2 `HeadlessSyphonServer` Class

New class in `syphon/headless_syphon.ts`:

```typescript
import {
  encodeString,
  openLibrary,
  type SyphonLibrary,
} from "./ffi.ts";

export interface HeadlessSyphonOptions {
  serverName?: string;
  flipY?: boolean;
  frameworkPath?: string;
  libPath?: string;
}

export class HeadlessSyphonServer {
  #state: Deno.PointerValue;
  #lib: SyphonLibrary;
  #closed = false;

  constructor(options: HeadlessSyphonOptions = {}) {
    this.#lib = openLibrary(options.libPath);

    const name = encodeString(options.serverName ?? "Deno Syphon Headless");
    const frameworkPath = options.frameworkPath
      ? encodeString(options.frameworkPath)
      : null;

    this.#state = this.#lib.symbols.syphon_headless_init(
      name.ptr,
      name.len,
      frameworkPath?.ptr ?? null,
      frameworkPath?.len ?? 0,
    );

    if (!this.#state) {
      this.#lib.close();
      throw new Error("Failed to initialize headless syphon bridge.");
    }

    if (options.flipY !== undefined) {
      this.#lib.symbols.syphon_headless_set_flipped(
        this.#state,
        options.flipY ? 1 : 0,
      );
    }
  }

  /**
   * Publish a frame from raw pixel data.
   * @param pixelData - Raw BGRA8 pixel data (Uint8Array)
   * @param width - Frame width in pixels
   * @param height - Frame height in pixels
   * @param bytesPerRow - Bytes per row (may include padding)
   * @returns Published frame count
   */
  publishFrame(
    pixelData: Uint8Array,
    width: number,
    height: number,
    bytesPerRow: number,
  ): bigint {
    if (!this.#state) return 0n;
    return this.#lib.symbols.syphon_headless_publish_frame(
      this.#state,
      Deno.UnsafePointer.of(pixelData),
      width,
      height,
      bytesPerRow,
      0, // pixel_format: 0 = BGRA8
    );
  }

  get hasClients(): boolean {
    if (!this.#state) return false;
    return this.#lib.symbols.syphon_headless_has_clients(this.#state) !== 0;
  }

  get publishedCount(): bigint {
    if (!this.#state) return 0n;
    return this.#lib.symbols.syphon_headless_get_published_count(this.#state);
  }

  set name(value: string) {
    if (!this.#state) return;
    const name = encodeString(value);
    this.#lib.symbols.syphon_headless_set_name(
      this.#state,
      name.ptr,
      name.len,
    );
  }

  destroy() {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#state) {
      this.#lib.symbols.syphon_headless_destroy(this.#state);
      this.#state = null;
    }
    this.#lib.close();
  }

  [Symbol.dispose]() {
    this.destroy();
  }
}
```

### 2.3 Staging Buffer Manager

New file: `syphon/staging_buffers.ts`

This manages two GPU staging buffers in a ping-pong arrangement. Frame N renders
while frame N-1's staging buffer is being mapped and read.

```typescript
/// <reference lib="dom" />

/**
 * bytesPerRow alignment for WebGPU's copyTextureToBuffer.
 * Must be a multiple of 256 bytes.
 */
export function alignedBytesPerRow(width: number, bytesPerPixel: number = 4): number {
  return Math.ceil((width * bytesPerPixel) / 256) * 256;
}

export interface StagingBufferPair {
  /** Total number of staging buffers (always 2 for ping-pong) */
  readonly count: 2;

  /**
   * Get the staging buffer to write into this frame.
   * Automatically handles creation/resizing.
   */
  getWriteBuffer(device: GPUDevice, width: number, height: number): {
    buffer: GPUBuffer;
    bytesPerRow: number;
    bufferSize: number;
  };

  /**
   * Get the staging buffer from the previous frame that should be
   * ready to map. Returns null on the very first frame (nothing to read yet).
   */
  getReadBuffer(): {
    buffer: GPUBuffer;
    bytesPerRow: number;
    width: number;
    height: number;
  } | null;

  /**
   * Call after submitting GPU commands. Advances the ping-pong index.
   */
  advance(): void;

  /** Release GPU resources. */
  destroy(): void;
}

interface StagingEntry {
  buffer: GPUBuffer | null;
  bytesPerRow: number;
  width: number;
  height: number;
  bufferSize: number;
  hasData: boolean; // true once a copyTextureToBuffer has been submitted
}

export function createStagingBufferPair(): StagingBufferPair {
  const entries: [StagingEntry, StagingEntry] = [
    { buffer: null, bytesPerRow: 0, width: 0, height: 0, bufferSize: 0, hasData: false },
    { buffer: null, bytesPerRow: 0, width: 0, height: 0, bufferSize: 0, hasData: false },
  ];

  let writeIdx = 0;
  let frameCount = 0;

  function ensureBuffer(
    device: GPUDevice,
    entry: StagingEntry,
    width: number,
    height: number,
  ): void {
    const bytesPerRow = alignedBytesPerRow(width);
    const bufferSize = bytesPerRow * height;

    if (
      entry.buffer &&
      entry.width === width &&
      entry.height === height
    ) {
      return; // Already correct size
    }

    // Destroy old buffer if it exists
    entry.buffer?.destroy();

    entry.buffer = device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    entry.bytesPerRow = bytesPerRow;
    entry.width = width;
    entry.height = height;
    entry.bufferSize = bufferSize;
    entry.hasData = false;
  }

  return {
    count: 2,

    getWriteBuffer(device: GPUDevice, width: number, height: number) {
      const entry = entries[writeIdx];
      ensureBuffer(device, entry, width, height);
      return {
        buffer: entry.buffer!,
        bytesPerRow: entry.bytesPerRow,
        bufferSize: entry.bufferSize,
      };
    },

    getReadBuffer() {
      if (frameCount < 1) return null; // No previous frame yet

      const readIdx = (writeIdx + 1) % 2;
      const entry = entries[readIdx];

      if (!entry.buffer || !entry.hasData) return null;

      return {
        buffer: entry.buffer,
        bytesPerRow: entry.bytesPerRow,
        width: entry.width,
        height: entry.height,
      };
    },

    advance() {
      entries[writeIdx].hasData = true;
      writeIdx = (writeIdx + 1) % 2;
      frameCount++;
    },

    destroy() {
      for (const entry of entries) {
        entry.buffer?.destroy();
        entry.buffer = null;
        entry.hasData = false;
      }
    },
  };
}
```

### 2.4 `createHeadlessSyphonRenderer` Function

This is the main entry point for the headless Syphon mode. It creates the
offscreen rendering pipeline, staging buffers, and the readback loop.

New file: `syphon/headless_renderer.ts`

```typescript
/// <reference lib="dom" />

import { launch, type DateTimeContext } from "@avtools/core-timing";
import { HeadlessSyphonServer, type HeadlessSyphonOptions } from "./headless_syphon.ts";
import {
  createStagingBufferPair,
  alignedBytesPerRow,
  type StagingBufferPair,
} from "./staging_buffers.ts";

export interface HeadlessSyphonRendererOptions {
  width: number;
  height: number;
  fps?: number;              // default 60
  syphon?: HeadlessSyphonOptions;
}

export interface HeadlessSyphonRenderer {
  /** The GPU device used for rendering */
  device: GPUDevice;

  /** Width and height of the offscreen render target */
  width: number;
  height: number;

  /** The offscreen texture to render into each frame */
  renderTexture: GPUTexture;

  /** The HeadlessSyphonServer instance for querying state */
  syphon: HeadlessSyphonServer;

  /**
   * Start the timer-driven render loop.
   * @param onFrame - Called each frame. Render your scene into renderTexture.
   *                  Return the GPUCommandEncoder used (so we can append the
   *                  copy-to-staging-buffer command to the same submission).
   * @returns A handle to stop the loop.
   */
  start(onFrame: (frameNumber: number, renderTexture: GPUTexture) => GPUCommandEncoder): {
    stop(): void;
  };

  /** Clean up all resources */
  destroy(): void;
}

export function createHeadlessSyphonRenderer(
  device: GPUDevice,
  options: HeadlessSyphonRendererOptions,
): HeadlessSyphonRenderer {
  const width = options.width;
  const height = options.height;
  const fps = options.fps ?? 60;

  // Create offscreen render texture.
  // Usage: RENDER_ATTACHMENT (to render into it) + COPY_SRC (to copy to staging buffer)
  // + TEXTURE_BINDING (so it can be used as a texture in bind groups, e.g. for blit)
  const renderTexture = device.createTexture({
    size: { width, height },
    format: "bgra8unorm",
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.TEXTURE_BINDING,
  });

  // Create Syphon server
  const syphon = new HeadlessSyphonServer(options.syphon);

  // Create staging buffer pair
  const staging = createStagingBufferPair();

  let destroyed = false;

  function start(
    onFrame: (frameNumber: number, renderTexture: GPUTexture) => GPUCommandEncoder,
  ): { stop(): void } {
    let running = true;

    const task = launch(async (ctx: DateTimeContext) => {
      let frame = 0;

      while (running && !destroyed) {
        // --- Kick off readback of the PREVIOUS frame's staging buffer ---
        // This runs in a branch so it does not block the timing loop.
        const readInfo = staging.getReadBuffer();
        if (readInfo) {
          // Capture values for the closure
          const { buffer, bytesPerRow, width: rw, height: rh } = readInfo;

          ctx.branch(async () => {
            try {
              await buffer.mapAsync(GPUMapMode.READ);
              const mapped = new Uint8Array(buffer.getMappedRange());

              // Publish to Syphon. The mapped data stays valid until unmap().
              // bytesPerRow may include padding (multiple of 256).
              syphon.publishFrame(mapped, rw, rh, bytesPerRow);

              buffer.unmap();
            } catch (e) {
              // mapAsync can fail if the buffer was destroyed or the device is lost.
              console.error("Headless Syphon readback failed:", e);
            }
          });
        }

        // --- Render the current frame ---
        const encoder = onFrame(frame, renderTexture);

        // --- Copy render texture to the staging buffer for THIS frame ---
        const writeInfo = staging.getWriteBuffer(device, width, height);
        encoder.copyTextureToBuffer(
          { texture: renderTexture },
          {
            buffer: writeInfo.buffer,
            bytesPerRow: writeInfo.bytesPerRow,
            rowsPerImage: height,
          },
          { width, height, depthOrArrayLayers: 1 },
        );

        // Submit all GPU work (render + copy)
        device.queue.submit([encoder.finish()]);

        // Advance the staging buffer ping-pong
        staging.advance();

        frame++;

        // Wait for the next frame tick
        await ctx.waitSec(1 / fps);
      }
    }, { bpm: 60 });

    return {
      stop() {
        running = false;
        task.cancel();
      },
    };
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    staging.destroy();
    renderTexture.destroy();
    syphon.destroy();
  }

  return {
    device,
    width,
    height,
    renderTexture,
    syphon,
    start,
    destroy,
  };
}
```

### 2.5 Optional Preview Window

The user can optionally create a regular winit window (WITHOUT the intercepting
layer) to see what they are rendering. This is completely independent of the
Syphon output. The sketch just blits the `renderTexture` to the window surface
in the same frame callback.

```typescript
import { createGpuWindow } from "../window/window.ts";
import { createBlitPipeline, blit } from "../window/blit.ts";

// Optional: create a preview window (no Syphon interception)
const previewWindow = await createGpuWindow(device, {
  width: 1280,
  height: 720,
  title: "Headless Syphon Preview",
});
const blitPipeline = createBlitPipeline(device, previewWindow.format);

// In the onFrame callback, after rendering:
// Blit renderTexture to the preview window
const swapTexture = previewWindow.ctx.getCurrentTexture();
blit(device, encoder, blitPipeline, renderTexture.createView(), swapTexture.createView());
// ... then submit and present the preview window
```

This is shown in the full sketch example below.

---

## Part 3: bytesPerRow Padding

WebGPU's `copyTextureToBuffer` requires `bytesPerRow` to be a multiple of 256
bytes. For BGRA8 (4 bytes/pixel):

| Width | Raw bytes/row | Aligned bytesPerRow | Padding bytes/row |
|-------|---------------|---------------------|-------------------|
| 640   | 2560          | 2560                | 0                 |
| 720   | 2880          | 3072                | 192               |
| 800   | 3200          | 3328                | 128               |
| 1024  | 4096          | 4096                | 0                 |
| 1280  | 5120          | 5120                | 0                 |
| 1920  | 7680          | 7680                | 0                 |

Formula: `alignedBytesPerRow = ceil(width * 4 / 256) * 256`

The Rust `replaceRegion:withBytes:bytesPerRow:` call receives the same
`bytesPerRow` value, so it correctly handles the padding. Metal skips the padding
bytes at the end of each row.

---

## Part 4: Sketch-Level API Comparison

### Current approach: window-based Syphon

```typescript
// rothko_lerp.ts (simplified current approach)
import { createSyphonGpuWindow } from "../syphon/mod.ts";
import { createBlitPipeline, blit } from "../window/mod.ts";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();

// Creates window + intercepting CAMetalLayer + SyphonMetalServer
const win = await createSyphonGpuWindow(device, {
  width: 1280,
  height: 720,
  title: "Rothko",
  syphon: { serverName: "Rothko", flipY: true },
});

const blitPipeline = createBlitPipeline(device, win.format);

// Render loop driven by vsync (getCurrentTexture blocks until next frame)
let running = true;
while (running) {
  const events = win.pollEvents();
  for (const ev of events) {
    if (ev.type === "close") running = false;
  }
  if (!running || win.closed) break;

  // ... render to offscreen texture ...
  const outputView = renderMyScene(device);

  const swapTexture = win.ctx.getCurrentTexture();
  const encoder = device.createCommandEncoder();
  blit(device, encoder, blitPipeline, outputView, swapTexture.createView());
  device.queue.submit([encoder.finish()]);
  win.syphon.publishFrame();  // triggers intercept-based publish
  win.present();

  await new Promise(r => setTimeout(r, 0));
}
win.close();
```

### New approach: headless Syphon

```typescript
// rothko_headless_syphon.ts
import { createHeadlessSyphonRenderer } from "../syphon/headless_renderer.ts";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();

// No window created. Syphon works entirely through CPU readback.
const renderer = createHeadlessSyphonRenderer(device, {
  width: 1280,
  height: 720,
  fps: 60,
  syphon: {
    serverName: "Rothko Headless",
    flipY: true,
  },
});

const { stop } = renderer.start((frameNumber, renderTexture) => {
  const encoder = device.createCommandEncoder();

  // Render your scene into renderTexture
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: renderTexture.createView(),
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: 0.2, g: 0.1, b: 0.05, a: 1.0 },
    }],
  });
  // ... draw rothko rectangles ...
  pass.end();

  // Return the encoder. The headless renderer will append
  // copyTextureToBuffer and submit it.
  return encoder;
});

// Run for 60 seconds then stop
setTimeout(() => {
  stop();
  renderer.destroy();
}, 60_000);
```

### New approach: headless Syphon WITH optional preview window

```typescript
// rothko_headless_syphon_with_preview.ts
import { createHeadlessSyphonRenderer } from "../syphon/headless_renderer.ts";
import { createGpuWindow } from "../window/window.ts";
import { createBlitPipeline, blit } from "../window/blit.ts";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();

// Create a plain preview window (no intercepting layer)
const previewWindow = await createGpuWindow(device, {
  width: 1280,
  height: 720,
  title: "Rothko Preview (headless syphon)",
});
const blitPipeline = createBlitPipeline(device, previewWindow.format);

// Create headless syphon renderer
const renderer = createHeadlessSyphonRenderer(device, {
  width: 1280,
  height: 720,
  fps: 60,
  syphon: {
    serverName: "Rothko Headless",
    flipY: true,
  },
});

const { stop } = renderer.start((frameNumber, renderTexture) => {
  // Poll preview window events
  const events = previewWindow.pollEvents();
  for (const ev of events) {
    if (ev.type === "close") {
      stop();
      return device.createCommandEncoder(); // dummy, won't be used
    }
  }

  const encoder = device.createCommandEncoder();

  // Render scene into the headless render texture
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: renderTexture.createView(),
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: 0.2, g: 0.1, b: 0.05, a: 1.0 },
    }],
  });
  // ... draw rothko rectangles ...
  pass.end();

  // Also blit to preview window
  try {
    const swapTexture = previewWindow.ctx.getCurrentTexture();
    blit(
      device,
      encoder,
      blitPipeline,
      renderTexture.createView(),
      swapTexture.createView(),
    );
    // Note: present() must be called AFTER submit, but the headless renderer
    // handles submit. So we schedule present after.
    queueMicrotask(() => previewWindow.present());
  } catch {
    // Window may have closed
  }

  return encoder;
});
```

---

## Part 5: Detailed Pipeline Diagram

```
Frame N timeline:

  core-timing tick
        |
        v
  onFrame(N, renderTexture)     <-- user renders scene
        |
        |  [GPU] render pass writes to renderTexture
        |
        v
  encoder.copyTextureToBuffer   <-- copy renderTexture -> stagingBuffer[N % 2]
        |
        v
  device.queue.submit([...])    <-- submit render + copy
        |
        v
  staging.advance()             <-- mark buffer N as "has data", flip index
        |
        |  [parallel, in ctx.branch()]
        |     |
        |     v
        |  stagingBuffer[(N-1) % 2].mapAsync(READ)
        |     |
        |     v
        |  mapped = getMappedRange()
        |     |
        |     v
        |  syphon.publishFrame(mapped, w, h, bytesPerRow)
        |     |  --> FFI call to syphon_headless_publish_frame
        |     |     --> replaceRegion on MTLTexture
        |     |     --> publishFrameTexture:onCommandBuffer:
        |     |     --> commit command buffer
        |     |
        |     v
        |  buffer.unmap()
        |
        v
  await ctx.waitSec(1/fps)      <-- wait for next frame tick
```

Key points:
- The readback of frame N-1 happens concurrently with the rendering of frame N.
- The `ctx.branch()` ensures the mapAsync does not block the timing loop.
- The latency is exactly 1 frame: what Syphon publishes is always 1 frame behind
  what is currently being rendered.
- On the very first frame, there is no previous buffer to read, so we skip the
  readback branch.

---

## Part 6: Error Handling

### mapAsync failure

If `buffer.mapAsync(GPUMapMode.READ)` throws (device lost, buffer destroyed,
etc.), the `catch` in the branch logs the error and continues. The frame is
simply not published to Syphon. The render loop continues uninterrupted.

### Rust Metal device creation failure

If `MTLCreateSystemDefaultDevice()` returns null (no GPU available), or
`SyphonMetalServer` fails to initialize, `syphon_headless_init` returns
`ptr::null_mut()`. The TypeScript constructor throws an error. The sketch should
handle this at the top level.

### Buffer resize

If the user changes the render dimensions mid-session, both staging buffers are
recreated by `ensureBuffer` in the staging buffer manager. The Rust-side textures
are recreated by `recreate_textures` when the width/height parameters change on
`syphon_headless_publish_frame`.

### Device lost

WebGPU's device lost event should trigger cleanup. The sketch should listen for
`device.lost` and call `renderer.destroy()`.

---

## Part 7: Memory Management

### Staging buffers (TypeScript)

Two `GPUBuffer` objects with `MAP_READ | COPY_DST` usage. Destroyed when:
- `renderer.destroy()` is called
- Dimensions change (old buffers destroyed, new ones created)

### MTLTextures (Rust)

Two `id<MTLTexture>` objects. Destroyed when:
- `syphon_headless_destroy` is called (Drop impl)
- Dimensions change (`recreate_textures` releases old, creates new)

### MTLCommandBuffer (Rust)

Created fresh each frame inside `syphon_headless_publish_frame`. Not retained --
Metal auto-releases it after commit + completion.

### SyphonMetalServer (Rust)

Created once in `syphon_headless_init`, stopped and released in Drop.

---

## Part 8: File Layout

New and modified files:

```
apps/deno-notebooks/
  native/syphon_bridge/
    src/
      lib.rs              # MODIFIED: add HeadlessSyphonState, new FFI functions,
                          #            MTLRegion/MTLOrigin/MTLSize types,
                          #            non-macOS stubs

  syphon/
    ffi.ts                # MODIFIED: add headless FFI symbols
    syphon.ts             # UNCHANGED
    headless_syphon.ts    # NEW: HeadlessSyphonServer class
    staging_buffers.ts    # NEW: StagingBufferPair, alignedBytesPerRow
    headless_renderer.ts  # NEW: createHeadlessSyphonRenderer
    mod.ts                # MODIFIED: re-export headless types
```

### Updated `syphon/mod.ts`

```typescript
export { FFI_SYMBOLS, type SyphonLibrary, type SyphonSymbols } from "./ffi.ts";
export {
  createSyphonGpuWindow,
  type SyphonOptions,
  SyphonServer,
  type SyphonWindowOptions,
} from "./syphon.ts";
export {
  HeadlessSyphonServer,
  type HeadlessSyphonOptions,
} from "./headless_syphon.ts";
export {
  createHeadlessSyphonRenderer,
  type HeadlessSyphonRenderer,
  type HeadlessSyphonRendererOptions,
} from "./headless_renderer.ts";
export {
  createStagingBufferPair,
  alignedBytesPerRow,
  type StagingBufferPair,
} from "./staging_buffers.ts";
```

---

## Part 9: Build Instructions

After modifying `lib.rs`, rebuild the native library:

```bash
cd apps/deno-notebooks/native/syphon_bridge
cargo build --release
```

The dylib at `target/release/libsyphon_bridge.dylib` will contain the new
symbols. No changes to `Cargo.toml` are needed -- all dependencies are already
present.

---

## Part 10: Testing Checklist

1. **Basic headless publish**: Create `HeadlessSyphonServer`, publish a solid
   color frame, verify it appears in Syphon Simple Client.

2. **Full render loop**: Run `createHeadlessSyphonRenderer` with a simple
   animated scene. Verify smooth output in Syphon Simple Client at the target
   FPS.

3. **Preview window**: Same as above but with an optional `createGpuWindow`
   preview. Verify both the window and Syphon show the same content.

4. **Frame pipelining**: Add timing logs to verify that frame N-1's readback
   completes while frame N is rendering, not blocking.

5. **Dimension change**: Mid-session resize test (if using preview window).
   Verify no crash, textures recreated correctly.

6. **No clients**: Verify the render loop does not crash when no Syphon clients
   are connected. The publish calls should succeed silently.

7. **Existing window-based path**: Verify `createSyphonGpuWindow` still works
   identically (regression test).

8. **SYPHON_BRIDGE_DEBUG**: Set environment variable, verify debug logs appear
   for headless mode.

---

## Part 11: Future Considerations

### Windows/Spout support

The CPU readback path (`copyTextureToBuffer` + `mapAsync` + FFI publish) is
cross-platform. On Windows, a future `spout_headless_publish_frame` FFI function
would receive the same raw pixel buffer. The staging buffer manager and render
loop are reusable.

### GPU-to-GPU path (zero-copy)

On macOS, it is theoretically possible to share the Metal texture between
WebGPU's Metal backend and Syphon without CPU readback. This would require:
- Extracting the `id<MTLTexture>` from WebGPU's internal texture
- Passing it directly to `publishFrameTexture:onCommandBuffer:`

This is highly runtime-specific (depends on Deno's WebGPU implementation
exposing the Metal texture handle) and fragile. The CPU readback path is the
reliable, portable solution. The GPU-to-GPU path could be added later as an
optimization for cases where the overhead of readback is too high (e.g., 4K
at 60fps = ~500MB/s through the CPU).

### Alternative: IOSurface sharing

Another zero-copy approach would be to back the WebGPU texture with an
IOSurface and share it with Syphon via `SyphonMetalServer`'s IOSurface
support. This is even more runtime-dependent and is not worth pursuing until
the CPU readback path proves to be a bottleneck.

# Syphon vs Spout: Deep Analysis for Cross-Platform Texture Sharing

## 1. Your Current Syphon Implementation (Summary)

### Rust Side ([lib.rs](native/syphon_bridge/src/lib.rs) — 1913 lines)

**Two parallel architectures in one crate:**

| | Windowed (`SyphonState`) | Headless (`HeadlessSyphonState`) |
|---|---|---|
| **Mechanism** | Method-swizzles `presentDrawable:` on the concrete MTLCommandBuffer class + intercepts `nextDrawable` via a `CAMetalLayer` subclass | Creates its own `MTLDevice`, uploads CPU pixels via `replaceRegion:withBytes:bytesPerRow:` |
| **Copy cost** | Zero-copy — Syphon reads the same IOSurface-backed drawable texture | CPU→GPU upload each frame (~0.5ms at 1080p on Apple Silicon) |
| **Window required** | Yes (NSView + CAMetalLayer) | No |
| **Texture management** | System manages drawables (triple-buffered by CAMetalLayer) | Double-buffered `MTLTexture[2]` created on first publish, recreated on resize |
| **Syphon server init** | Lazy — waits for first `latch_and_publish` (device not yet assigned to layer at init time) | Eager — created during `syphon_headless_init` |

**Key architectural patterns:**
- Runtime Obj-C class registration (`ClassDecl`) for the intercepting layer subclass
- Global `presentDrawable:` method swizzle (applied to the private concrete command buffer class)
- Syphon.framework loaded dynamically via `NSBundle` with a cascade of search paths
- All state is `Box::into_raw()` / `Box::from_raw()` for FFI pointer ownership
- Non-macOS stubs compile cleanly on Linux/Windows (empty enums, null returns)

### TypeScript Side ([syphon/](syphon/))

- **Windowed**: `createSyphonGpuWindow()` hooks `beforeSurfaceCreate` to grab the NSView pointer, creates `SyphonServer`, wraps `win.close()` for cleanup
- **Headless**: `createHeadlessSyphonRenderer()` orchestrates: offscreen `GPUTexture` → `copyTextureToBuffer` → ping-pong `StagingBufferPair` → `mapAsync` → `HeadlessSyphonServer.publishFrame()` via FFI
- The ping-pong staging buffers give **1-frame pipelined readback** — frame N-1 is read back while frame N renders

---

## 2. The macOS Occlusion Problem (Why Headless Was Needed)

The motivating problem: macOS stops recycling `CAMetalLayer` drawables when a window is **occluded** (different Space, behind a fullscreen app). The 3-drawable pool exhausts, and `getCurrentTexture()` → `nextDrawable` **blocks indefinitely**, freezing the render loop. This is fundamental macOS compositor behavior — not a bug in wgpu/Deno/winit.

### Does This Same Problem Exist on Windows?

**No. Windows does NOT have this problem.** The differences are fundamental:

| Aspect | macOS | Windows |
|--------|-------|---------|
| Occluded window | `nextDrawable()` blocks **indefinitely** | `Present()` returns `DXGI_STATUS_OCCLUDED` **immediately** |
| Minimized window | Same blocking | App gets `WM_SIZE`/`SIZE_MINIMIZED`, can skip rendering; `Present()` returns status without blocking |
| Different virtual desktop | Blocks (compositor stops recycling) | DWM continues compositing for taskbar thumbnails; no starvation |
| Shared texture validity | IOSurface remains valid regardless | DX11 shared handle remains valid regardless |

On Windows, DXGI swap chains are application-controlled. The DWM tells the application the window is occluded and lets it decide what to do, rather than starving it of resources.

**Bottom line**: A headless Spout mode is still *desirable* for architectural cleanliness (no unnecessary window), but it is not *required* to avoid blocking like on macOS.

---

## 3. Spout Architecture Deep-Dive

### Core Sharing Mechanism

Spout uses **DirectX 11 shared textures** (`D3D11_RESOURCE_MISC_SHARED` flag) as its universal exchange format:

1. Sender creates a DX11 texture with a shared HANDLE
2. Share handle + metadata (width, height, format) registered in **Windows named shared memory** ("SpoutSenderNames")
3. Receiver opens the handle via `OpenSharedResource()` to get a `ID3D11Texture2D`
4. For OpenGL apps: `WGL_NV_DX_interop` bridges GL↔DX (zero-copy on NVIDIA/AMD/Intel)

### Three Layers of Fallback

| Layer | Mechanism | Latency | Window Required |
|-------|-----------|---------|-----------------|
| GPU interop | DX11 shared texture + `wglDXOpenDeviceNV` | ~0.45ms @ 4K | No |
| CPU staging | DX11 staging textures with `Map`/`Unmap` | ~5-7ms @ 4K | No |
| Memory share | Named shared memory (legacy 2.006) | Higher | No |

### The SpoutDX `SendImage()` Path (Most Relevant for Your Use Case)

```
SendImage(unsigned char* pData, width, height, pitch)
  → CheckSender()               // init/validate shared texture
  → frame.CheckTextureAccess()  // acquire named mutex (67ms timeout)
  → UpdateSubresource()         // CPU pixels → GPU shared texture directly
  → Flush() + SetNewFrame()     // force queue completion, signal frame
  → AllowTextureAccess()        // release mutex
```

This is the equivalent of your `syphon_headless_publish_frame` — takes raw pixels, uploads to GPU. **No window, no rendering context on the sender side beyond a DX11 device.**

### Sender Registry (vs Syphon)

| | Spout | Syphon |
|---|---|---|
| Discovery | Named shared memory maps | Distributed notifications + NSConnection |
| Entry storage | 256-byte name string per sender | NSDictionary via distributed objects |
| Metadata | `SharedTextureInfo` struct in per-sender shared memory (shareHandle, width, height, format) | Distributed via Syphon framework |
| Stale cleanup | `CleanSenders()` checks if shared memory is accessible | Automatic via Mach port invalidation |

### Thread Safety

Spout uses a multi-layered synchronization approach:
- **Named mutexes** (cross-process): 67ms timeout on `WaitForSingleObject` — skip frame rather than deadlock
- **Keyed mutexes** (DX11-native): `IDXGIKeyedMutex::AcquireSync` for GPU pipeline sync
- **Named semaphores**: Frame counting/signaling between processes
- **GL/DX interop locks**: `wglDXLockObjectsNV` / `wglDXUnlockObjectsNV`

---

## 4. Spout Graphics API Support

| API | Status | Notes |
|-----|--------|-------|
| DirectX 11 | Primary | Core sharing mechanism |
| OpenGL | Full | Via `WGL_NV_DX_interop` bridge |
| DirectX 9 | Legacy | SpoutDX9 module |
| DirectX 12 | Supported | SpoutDX12 via `D3D11On12` compatibility layer |
| Vulkan | Not native | Would need `VK_KHR_external_memory_win32` |
| WebGPU | Via CPU readback | Or wgpu's new `texture_from_d3d11_shared_handle` (PR #6161 merged) |

---

## 5. Building a Rust `spout_bridge` — Strategy

### Existing Rust Crates

There is one: [`spout_texture_share`](https://lib.rs/crates/spout_texture_share) (v0.1.0, Dec 2022) — **abandoned**. Uses `autocxx`/`cxx` with bundled C++ source, ~16MB. Not production-ready.

### Recommended Approach: C Wrapper + Rust FFI

SpoutLibrary exposes a **COM-style vtable** with a single `extern "C"` entry point (`GetSpout() → SPOUTHANDLE`). All methods are virtual. The cleanest FFI path:

**Write a thin C wrapper** (flat `extern "C"` functions):

```c
// spout_c_api.h
extern "C" {
    void* spout_sender_create(const char* name, unsigned int width, unsigned int height);
    int   spout_sender_send_image(void* handle, const unsigned char* pixels,
                                   unsigned int width, unsigned int height,
                                   unsigned int bytes_per_row);
    int   spout_sender_has_clients(void* handle);
    void  spout_sender_set_name(void* handle, const char* name);
    void  spout_sender_destroy(void* handle);
    // ... mirror the syphon_headless_* API shape
}
```

Then in Rust, use `bindgen` on this header. This mirrors your existing `syphon_bridge` pattern where Rust owns the state as an opaque pointer.

### Proposed `SpoutState` (analogous to `HeadlessSyphonState`)

```rust
pub struct SpoutState {
    spout_handle: *mut c_void,  // SPOUTHANDLE from GetSpout()
    server_name: String,
    width: u32,
    height: u32,
    published_frame_count: AtomicU64,
    // ...
}
```

### FFI Functions to Expose (mirroring `syphon_headless_*`)

| Function | Purpose |
|----------|---------|
| `spout_headless_init(name_ptr, name_len) -> *mut SpoutState` | Create DX11 device + Spout sender |
| `spout_headless_publish_frame(state, pixels, w, h, bytes_per_row, format) -> u64` | Upload pixels via `SendImage()` |
| `spout_headless_has_clients(state) -> u32` | Check if receivers connected |
| `spout_headless_set_name(state, name_ptr, name_len)` | Rename sender |
| `spout_headless_destroy(state)` | Release sender + DX device |
| `spout_headless_get_published_count(state) -> u64` | Frame counter |

### Build Considerations

- The Spout CMake build is **Windows-only** (explicitly rejects other platforms)
- Builds with MSVC static runtime (`/MT`) by default
- ARM support available (downloads `sse2neon.h` for SIMD)
- The SpoutDX path (no OpenGL dependency) is the right target — avoids `WGL_NV_DX_interop` complexity

---

## 6. TypeScript Side for Spout

The TypeScript implementation would be nearly identical to the headless Syphon path. The key files to create:

```
syphon/   →   spout/
  ffi.ts                    # Spout FFI symbols (mirrors syphon headless symbols)
  headless_spout.ts         # HeadlessSpoutServer class
  mod.ts                    # Exports
```

The `staging_buffers.ts` and `headless_renderer.ts` are **reusable as-is** — they are not Syphon-specific. They handle GPU readback and render loop orchestration generically. You'd just swap `HeadlessSyphonServer` for `HeadlessSpoutServer` in the renderer.

---

## 7. Key Differences in Implementation

| Concern | Syphon (macOS) | Spout (Windows) |
|---------|---------------|-----------------|
| **Pixel format** | `bgra8unorm` (Metal native) | `DXGI_FORMAT_B8G8R8A8_UNORM` (DX11 native) — same bytes |
| **Row alignment** | 256-byte for WebGPU `copyTextureToBuffer` | Spout's `SendImage` accepts arbitrary pitch |
| **Framework loading** | Dynamic `NSBundle.load` with path cascade | `LoadLibrary("SpoutLibrary.dll")` or static link |
| **Device creation** | `MTLCreateSystemDefaultDevice()` (singleton, don't release) | `D3D11CreateDevice()` (ref-counted COM, release normally) |
| **Texture upload** | `replaceRegion:withBytes:bytesPerRow:` | `UpdateSubresource()` or `Map`/`Unmap` |
| **Cross-process sync** | IOSurface handles inherent sync | Named mutexes (67ms timeout) + keyed mutexes + semaphores |
| **Non-platform stubs** | Empty enums + null returns for non-macOS | Same pattern for non-Windows |

---

## 8. Summary Recommendations

1. **Headless approach works perfectly on Windows too** — not required to avoid blocking (like macOS), but still the cleanest architecture for a framework-agnostic pipeline

2. **The CPU readback path is the practical choice**: `render offscreen → mapAsync → SendImage()`. Same pipeline as headless Syphon, just different FFI target

3. **The staging buffer infrastructure is reusable** — `staging_buffers.ts` and `headless_renderer.ts` are graphics-API-agnostic

4. **For Rust FFI**: Write a thin C wrapper around SpoutLibrary (or SpoutDX directly), then `bindgen` + `cdylib` — mirrors the existing `syphon_bridge` pattern

5. **Future zero-copy path**: wgpu has merged DX11 shared texture import (PR #6161), which could enable direct GPU→Spout without CPU readback. But this is outside standard WebGPU API

6. **BGRA8 format alignment**: Both Syphon (Metal) and Spout (DX11) use BGRA8 as the default format, and WebGPU's preferred canvas format on both platforms is `bgra8unorm` — so no pixel format conversion is needed on either platform

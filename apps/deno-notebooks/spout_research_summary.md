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

### The SpoutLibrary API Problem

SpoutLibrary exposes a **COM-style vtable** with a single `extern "C"` entry point (`GetSpout() → SPOUTHANDLE`). All actual methods (`SendImage`, `SetSenderName`, etc.) are **C++ virtual methods** — not flat C functions. This means you can't directly `#[link]` or `Deno.dlopen()` them.

Two approaches were considered:

| Option | Approach | Fragility | Understandability |
|--------|----------|-----------|-------------------|
| **A. COM vtable from Rust** | Reconstruct C++ vtable layout in Rust, call through function pointers | **High** — must match exact method order, no compile-time check, silent crashes on mismatch | **Low** — requires understanding C++ ABI, vtable layout, unsafe casts |
| **B. Thin C wrapper DLL** | Pre-built DLL that flattens vtable into `extern "C"` functions | **Low** — C++ compiler verifies API calls at wrapper build time, Rust side is standard FFI | **High** — two layers of obvious code, each readable independently |

### Chosen Approach: Option B — Pre-built Thin C Wrapper DLL

**Why Option B wins:** The C++ compiler catches SpoutLibrary API changes at wrapper build time (not as runtime crashes). The Rust FFI is dead-simple flat `extern "C"` bindings. Each layer is independently inspectable. The cost is one extra DLL in the repo, which is negligible.

**This mirrors the Syphon pattern:** Syphon.framework is a pre-built binary providing a clean API surface. The thin C wrapper DLL serves the same role — a stable, flat API surface that Rust can trivially call.

### Layer 1: `spout_c_api.dll` (Pre-built, Checked Into Repo)

A ~50-line C++ file that wraps SpoutLibrary's vtable methods into flat C functions:

```cpp
// spout_c_api.cpp — build once with MSVC, check DLL into repo
#include "SpoutLibrary.h"

extern "C" {

__declspec(dllexport)
void* spout_create(const char* name) {
    SPOUTLIBRARY* spout = GetSpout();
    if (!spout) return nullptr;
    spout->SetSenderName(name);
    return (void*)spout;
}

__declspec(dllexport)
int spout_send_image(void* handle, const unsigned char* pixels,
                     unsigned int width, unsigned int height,
                     unsigned int bytes_per_row, int invert) {
    SPOUTLIBRARY* spout = (SPOUTLIBRARY*)handle;
    // SpoutDX SendImage accepts pitch directly
    return spout->SendImage(pixels, width, height, GL_BGRA_EXT, invert) ? 1 : 0;
}

__declspec(dllexport)
int spout_get_width(void* handle) {
    return ((SPOUTLIBRARY*)handle)->GetWidth();
}

__declspec(dllexport)
int spout_get_height(void* handle) {
    return ((SPOUTLIBRARY*)handle)->GetHeight();
}

__declspec(dllexport)
void spout_set_sender_name(void* handle, const char* name) {
    ((SPOUTLIBRARY*)handle)->SetSenderName(name);
}

__declspec(dllexport)
int spout_get_sender_count(void* handle) {
    return ((SPOUTLIBRARY*)handle)->GetSenderCount();
}

__declspec(dllexport)
void spout_destroy(void* handle) {
    SPOUTLIBRARY* spout = (SPOUTLIBRARY*)handle;
    spout->Release();
}

} // extern "C"
```

**Header (`spout_c_api.h`):**
```c
extern "C" {
    void* spout_create(const char* name);
    int   spout_send_image(void* handle, const unsigned char* pixels,
                           unsigned int width, unsigned int height,
                           unsigned int bytes_per_row, int invert);
    int   spout_get_width(void* handle);
    int   spout_get_height(void* handle);
    void  spout_set_sender_name(void* handle, const char* name);
    int   spout_get_sender_count(void* handle);
    void  spout_destroy(void* handle);
}
```

**One-time build (not needed by end users):**
```bash
# On a Windows machine with MSVC:
cl /LD /MT spout_c_api.cpp /I<SpoutLibrary_include_dir> SpoutLibrary.lib /Fe:spout_c_api.dll
```

### Layer 2: Rust `spout_bridge` (Built by End Users via `cargo build`)

The Rust crate dynamically loads both DLLs at runtime — no C++ compiler needed:

```rust
// native/spout_bridge/src/lib.rs
use libloading::{Library, Symbol};
use std::sync::atomic::{AtomicU64, Ordering};

pub struct SpoutState {
    c_api_lib: Library,         // spout_c_api.dll
    spout_lib: Library,         // SpoutLibrary.dll (loaded as dependency)
    handle: *mut std::ffi::c_void,
    server_name: String,
    published_frame_count: AtomicU64,
}

// FFI functions exposed to Deno (mirrors syphon_headless_* API)
#[no_mangle]
pub extern "C" fn spout_headless_init(
    name_ptr: *const u8, name_len: usize
) -> *mut SpoutState {
    // Load DLLs from candidate paths (same cascade pattern as Syphon)
    // Call spout_create(name) via loaded symbol
    // Return Box::into_raw(Box::new(state))
}

#[no_mangle]
pub extern "C" fn spout_headless_publish_frame(
    state: *mut SpoutState,
    pixels: *const u8,
    width: u32, height: u32,
    bytes_per_row: u32,
    format: u32,
) -> u64 {
    // Call spout_send_image() via loaded symbol
    // Increment and return frame count
}

#[no_mangle]
pub extern "C" fn spout_headless_destroy(state: *mut SpoutState) {
    // Call spout_destroy() via loaded symbol
    // Drop the Box
}
```

### FFI Functions Exposed to Deno (mirroring `syphon_headless_*`)

| Function | Purpose |
|----------|---------|
| `spout_headless_init(name_ptr, name_len) -> *mut SpoutState` | Load DLLs + create Spout sender |
| `spout_headless_publish_frame(state, pixels, w, h, bytes_per_row, format) -> u64` | Upload pixels via `spout_send_image()` |
| `spout_headless_set_name(state, name_ptr, name_len)` | Rename sender |
| `spout_headless_destroy(state)` | Release sender + unload DLLs |
| `spout_headless_get_published_count(state) -> u64` | Frame counter |

### DLL Loading Strategy (Mirrors Syphon Framework Cascade)

```rust
fn candidate_dll_paths(explicit_hint: Option<&str>) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(hint) = explicit_hint {
        paths.push(PathBuf::from(hint));
    }
    // Next to the built spout_bridge.dll
    if let Some(dir) = dylib_directory() {
        paths.push(dir.join("dlls/spout_c_api.dll"));
        paths.push(dir.join("dlls/SpoutLibrary.dll"));
    }
    // Relative to repo root (development)
    paths.push(repo_root().join("native/spout_bridge/dlls/spout_c_api.dll"));
    // System PATH (fallback)
    paths.push(PathBuf::from("spout_c_api.dll"));
    paths
}
```

### File Structure

```
native/spout_bridge/
├── Cargo.toml                          # cdylib + libloading dep
├── build.rs                            # cfg(windows) — link system libs
├── src/lib.rs                          # Load DLLs at runtime, expose FFI
├── dlls/
│   ├── README.md                       # "Pre-built Spout DLLs for Windows"
│   ├── SpoutLibrary.dll                # Pre-built, checked into repo (~500KB)
│   ├── SpoutLibrary.lib                # Import lib (only for rebuilding c_api)
│   └── spout_c_api.dll                 # Pre-built thin wrapper (~50KB)
├── c_wrapper/
│   ├── spout_c_api.cpp                 # Source for the thin wrapper
│   ├── spout_c_api.h                   # Flat C header
│   └── BUILD_INSTRUCTIONS.md           # How to rebuild (one-time, MSVC)
└── target/release/
    └── spout_bridge.dll                # cargo build output
```

### Build Considerations

- **End users only need Rust** — `cargo build` produces `spout_bridge.dll`, loads pre-built DLLs at runtime
- The Spout CMake build is **Windows-only** (explicitly rejects other platforms)
- Pre-built DLLs use MSVC static runtime (`/MT`) — no MSVC redistributable needed
- The SpoutDX path (no OpenGL dependency) is the right target — avoids `WGL_NV_DX_interop` complexity
- Non-Windows stubs compile cleanly (empty functions, null returns) — same pattern as `syphon_bridge`
- ARM Windows support available if needed (Spout downloads `sse2neon.h` for SIMD)

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

4. **Option B (thin C wrapper DLL) is the chosen FFI strategy**: Pre-build `spout_c_api.dll` + `SpoutLibrary.dll`, check both into the repo. Rust loads them at runtime via `libloading` — same pattern as Syphon's `NSBundle.load`. End users only need Rust installed.

5. **Why not COM vtable from Rust (Option A)**: Requires manually matching C++ vtable layout — no compile-time verification, silent crashes on mismatch when Spout updates. Option B catches API changes at C++ compile time (when rebuilding the wrapper), and the Rust FFI is trivial flat `extern "C"` calls.

6. **End-user build story**: `setup.sh` installs Rust → `cargo build` builds `spout_bridge.dll` → pre-built `spout_c_api.dll` and `SpoutLibrary.dll` are already in the repo. No MSVC, no C++ toolchain, no CMake.

7. **Future zero-copy path**: wgpu has merged DX11 shared texture import (PR #6161), which could enable direct GPU→Spout without CPU readback. But this is outside standard WebGPU API

8. **BGRA8 format alignment**: Both Syphon (Metal) and Spout (DX11) use BGRA8 as the default format, and WebGPU's preferred canvas format on both platforms is `bgra8unorm` — so no pixel format conversion is needed on either platform

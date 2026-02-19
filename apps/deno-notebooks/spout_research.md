# Spout Implementation Research

> Research conducted by parallel opus agents analyzing the existing Syphon implementation
> and the Spout SDK for building equivalent Windows support.

---

# Agent: Rust Syphon Implementation

Here is a comprehensive analysis of the Syphon bridge Rust implementation.

---

## Comprehensive Analysis of the Syphon Bridge (`native/syphon_bridge/`)

### File: `/Users/avneeshsarwate/agentCombine/avTools/apps/deno-notebooks/native/syphon_bridge/src/lib.rs`

The entire implementation lives in a single 1913-line `lib.rs`. The file is split into two conditional modules -- the real macOS implementation (`#[cfg(target_os = "macos")] mod macos`) and a stub module (`#[cfg(not(target_os = "macos"))] mod macos`). Both are re-exported at the crate root with `pub use macos::*`.

---

### 1. Build Infrastructure

**`Cargo.toml`** (line 1-20): The crate is a `cdylib` -- a C-ABI shared library (`.dylib` on macOS). Dependencies are minimal:
- `libc` -- for `dladdr` and C types
- `objc` 0.2 -- for Objective-C runtime interop (`msg_send!`, `Class`, `ClassDecl`, etc.)
- `once_cell` -- for `Lazy` statics
- `serde` + `serde_json` -- for serializing server listings to JSON

Release profile uses `panic = "abort"`, LTO, and single codegen unit for a small, optimized binary.

**`build.rs`** (line 1-8): Links five Apple frameworks plus the Objective-C runtime:
- `Metal` -- GPU API
- `QuartzCore` -- for `CAMetalLayer`
- `Foundation` -- `NSString`, `NSBundle`, `NSArray`, `NSDictionary`
- `AppKit` -- for `NSView`
- `IOSurface` -- required by Syphon internally for inter-process texture sharing
- `objc` -- the runtime itself

**`Syphon.framework`** is NOT linked at build time. It is loaded dynamically at runtime via `NSBundle.bundleWithPath:` / `load` (lines 1109-1141). This is critical because Syphon is a third-party framework, not an Apple system framework.

---

### 2. The Windowed (`SyphonState`) Approach -- Intercepting CAMetalLayer

This is the primary, zero-copy path for publishing frames from a visible window.

#### 2a. Core Data Structures

**`SyphonState`** (lines 185-205): The main state for windowed Syphon publishing. Fields:
- `ns_view: *mut Object` -- the raw pointer to the NSView whose layer is intercepted
- `layer: *mut Object` -- the intercepting `CAMetalLayer` subclass instance
- `ring: Arc<DrawableRing>` -- ring buffer that captures drawables as they come through
- `server_name: String`, `framework_hint: Option<String>`, `loaded_framework_path: Option<String>` -- naming and framework loading state
- `command_queue: *mut Object` -- Metal command queue for publishing
- `syphon_server: *mut Object` -- the `SyphonMetalServer` instance
- `publish_enabled: AtomicU32` -- flag to gate whether the presentDrawable hook actually publishes
- `publish_flipped: AtomicU32` -- controls Y-flip for the Syphon publish call
- `published_frame_count: AtomicU64`, `present_hook_count: AtomicU64` -- counters for diagnostics
- `debug_*` fields -- throttled stderr debug logging controlled by `SYPHON_BRIDGE_DEBUG` env var
- `last_width: AtomicU32`, `last_height: AtomicU32` -- cached texture dimensions

**`DrawableRing`** (lines 93-176): A fixed-size ring buffer of 3 entries (`RING_SIZE = 3`), each holding a `(frame_id, drawable_ptr)`. Protected by a `Mutex`. Its purpose is to capture `CAMetalDrawable` pointers as they flow through `nextDrawable`. Key methods:
- `record_drawable(drawable)` -- retains the drawable, releases the oldest entry at that slot, stores in ring, advances write index
- `take_latest()` -- returns the most recently recorded drawable (for alternative use, currently `#[allow(dead_code)]`)
- `intercept_count()` -- returns total number of interceptions (diagnostic)
- `Drop` -- releases all remaining retained drawables

Note: `take_latest()` is marked `dead_code`. The current design does NOT use the ring to retrieve drawables for publishing. Instead, publishing happens directly inside the `presentDrawable:` hook. The ring exists for diagnostic/debugging/future use.

#### 2b. The Intercepting Layer Class

**`ensure_intercepting_layer_class()`** (lines 799-819): Uses the `objc` crate's `ClassDecl` to dynamically register a new Objective-C class at runtime named `AvToolsInterceptingMetalLayer`, which is a subclass of `CAMetalLayer`. It overrides exactly one method:

- `nextDrawable` -- the `intercept_next_drawable` function (lines 780-797)

When this method is called (by WebGPU / wgpu / Metal internally), it:
1. Calls `super.nextDrawable` (forwarding to `CAMetalLayer`)
2. Looks up the `DrawableRing` for this layer in the global `LAYER_RINGS` map
3. If found, calls `ring.record_drawable(drawable)` to capture the drawable

**Global registries** (lines 178-181):
- `LAYER_RINGS: Lazy<Mutex<HashMap<usize, Weak<DrawableRing>>>>` -- maps layer pointer to its ring (weak ref so ring is owned by `SyphonState`)
- `LAYER_STATES: Lazy<Mutex<HashMap<usize, usize>>>` -- maps layer pointer to `SyphonState` pointer (for the `presentDrawable` hook to find the state)

#### 2c. The presentDrawable: Hook

This is the most architecturally significant piece. Rather than polling the ring buffer, the code hooks into Metal's command buffer submission path.

**`ensure_present_drawable_hook(device)`** (lines 728-758): Called once, uses `OnceLock` to guarantee single execution. It:
1. Creates a temporary command queue and command buffer from the device
2. Gets the **concrete runtime class** of the command buffer (via `object_getClass`)
3. Finds the `presentDrawable:` instance method on that class
4. Saves the **original implementation pointer** in `ORIGINAL_PRESENT_DRAWABLE_IMP`
5. **Swizzles** the method implementation to point to `intercept_present_drawable`
6. Releases the temporary objects

This is a classic Objective-C method swizzle. It replaces the implementation of `presentDrawable:` on the concrete `MTLCommandBuffer` implementation class (which is a private Apple class like `MTLIOAccelCommandBuffer`).

**`intercept_present_drawable(this, cmd, drawable)`** (lines 761-778): The hook function, called every time ANY command buffer calls `presentDrawable:`. It:
1. Calls `lookup_state_for_drawable(drawable)` -- walks `drawable.layer` to find the `SyphonState` in the `LAYER_STATES` map
2. If a state is found and `publish_enabled` is set:
   - Calls `state.publish_on_command_buffer(drawable, this)` where `this` is the command buffer
3. Calls `state.maybe_debug_log()` for periodic diagnostics
4. **Always calls the original `presentDrawable:`** implementation, so the actual screen presentation still happens

**`publish_on_command_buffer(drawable, command_buffer)`** (lines 408-448): The actual Syphon publish call:
1. Gets the `MTLTexture` from the drawable
2. Reads width/height from the texture
3. Constructs an `NSRect` image region
4. Calls `[SyphonMetalServer publishFrameTexture:onCommandBuffer:imageRegion:flipped:]`
5. Increments the published frame count

This is a **zero-copy** approach: the texture being presented to the screen is the same texture handed to Syphon. No pixel readback, no extra copy. Syphon uses `IOSurface` backing under the hood to share the texture with client processes.

#### 2d. Initialization Flow (`syphon_init`, lines 1143-1232)

1. Decodes the server name and framework path from raw byte pointers
2. Reads environment variables: `SYPHON_BRIDGE_DEBUG`, `SYPHON_BRIDGE_DEBUG_INTERVAL_MS`, `SYPHON_BRIDGE_FLIP_Y`/`SYPHON_BRIDGE_FLIPPED`
3. Attempts to load Syphon.framework
4. Creates an instance of the intercepting `CAMetalLayer` subclass
5. Sets the layer on the NSView: `[nsView setWantsLayer:YES]`, `[nsView setLayer:layer]`
6. Disables `framebufferOnly` on the layer (so the texture can be read by Syphon)
7. Disables `allowsNextDrawableTimeout` (prevents Metal from returning nil on timeout)
8. Creates the `DrawableRing` and registers it + the state pointer in the global maps
9. Returns a heap-allocated `Box<SyphonState>` as a raw pointer

The `SyphonMetalServer` is NOT created during init. It is lazily created on the first call to `publish_latest()` / `ensure_server_ready()` (lines 347-398). This is because the Metal device is obtained from the layer, which may not have a device assigned yet at init time.

#### 2e. Layer Pointer Refresh (`refresh_layer_pointer`, lines 318-335)

The NSView's layer can change (e.g., if the window system replaces it). This method checks `[nsView layer]` and if it has changed, updates all the global registries to point to the new layer. Called in `ensure_server_ready()`.

---

### 3. The Headless (`HeadlessSyphonState`) Approach -- CPU Readback

This is for publishing frames without a visible window, using pixel data uploaded from CPU memory.

#### 3a. Core Data Structure

**`HeadlessSyphonState`** (lines 207-223): Fields:
- `device: *mut Object` -- Metal device created via `MTLCreateSystemDefaultDevice()`
- `command_queue: *mut Object` -- Metal command queue
- `syphon_server: *mut Object` -- `SyphonMetalServer` instance (created eagerly during init, unlike windowed)
- `textures: [*mut Object; 2]` -- a **double-buffered** pair of `MTLTexture` objects
- `tex_width: u32`, `tex_height: u32` -- current texture dimensions
- `write_idx: usize` -- alternates 0/1 for double buffering
- `publish_flipped`, `published_frame_count`, `debug_*` -- same as windowed

#### 3b. Initialization (`syphon_headless_init`, lines 1287-1385)

Unlike windowed init, this is **eager**:
1. Loads Syphon.framework immediately
2. Creates a Metal device via `MTLCreateSystemDefaultDevice()`
3. Creates a command queue
4. Creates the `SyphonMetalServer` immediately (no lazy init)
5. Textures are NOT created yet -- they are lazily created/resized on the first publish call

#### 3c. Texture Management (`recreate_textures`, lines 539-586)

Called when the incoming frame dimensions change or on first publish:
1. Releases any existing textures
2. Creates a `MTLTextureDescriptor` with:
   - Pixel format `80u64` = `MTLPixelFormatBGRA8Unorm` (standard 8-bit BGRA)
   - Usage `1u64` = `MTLTextureUsageShaderRead` (minimum needed for Syphon to read the texture)
3. Creates two textures from the descriptor (double-buffering)
4. On failure, cleans up any partially created textures

#### 3d. Publishing (`syphon_headless_publish_frame`, lines 1397-1482)

The core function, called from Deno FFI every frame:
1. Validates inputs: non-null pixel data, non-zero dimensions, `bytes_per_row >= width * 4`
2. If texture size has changed, calls `recreate_textures()`
3. Picks the current write-side texture via `textures[write_idx]`
4. Uploads pixel data via `[MTLTexture replaceRegion:mipmapLevel:withBytes:bytesPerRow:]` -- this is a **CPU-to-GPU synchronous upload** using an `MTLRegion` struct
5. Creates a new command buffer from the queue
6. Calls `[SyphonMetalServer publishFrameTexture:onCommandBuffer:imageRegion:flipped:]`
7. Commits the command buffer: `[commandBuffer commit]`
8. Advances `write_idx = (write_idx + 1) % 2` (double buffer flip)
9. Increments published frame count

The double-buffering ensures that while Syphon might still be reading from the previous texture (via IOSurface), the new frame is being written to the other texture. This prevents tearing/flickering that was mentioned in the git history ("fix flickering with atlas issues").

#### 3e. Device Lifetime Note

In the `Drop` implementation for `HeadlessSyphonState` (lines 282-315), there is an explicit comment: "Intentionally do not release self.device. MTLCreateSystemDefaultDevice() returns an autoreleased singleton on current macOS versions and releasing it can crash." This is a known Metal quirk.

---

### 4. All FFI Functions Exposed

Every `#[no_mangle] pub extern "C"` function is an FFI entry point. Here is the complete list:

**Windowed Server:**
| Function | Signature | Purpose |
|---|---|---|
| `syphon_init` | `(ns_view_ptr: usize, name_ptr: *const u8, name_len: u32, fw_ptr: *const u8, fw_len: u32) -> *mut SyphonState` | Create windowed state, install intercepting layer |
| `syphon_destroy` | `(state: *mut SyphonState)` | Drop the state, clean up server/layer/ring |
| `syphon_latch_and_publish` | `(state: *mut SyphonState) -> u64` | Enable publishing, return published frame count |
| `syphon_has_clients` | `(state: *mut SyphonState) -> u32` | 1 if Syphon clients are connected |
| `syphon_set_name` | `(state: *mut SyphonState, name_ptr: *const u8, name_len: u32)` | Change server name at runtime |
| `syphon_set_flipped` | `(state: *mut SyphonState, flipped: u32)` | Toggle Y-flip for published frames |
| `syphon_get_intercept_count` | `(state: *mut SyphonState) -> u64` | Total number of drawables intercepted |
| `syphon_is_server_ready` | `(state: *mut SyphonState) -> u32` | 1 if SyphonMetalServer is initialized |
| `syphon_get_last_texture_size` | `(state: *mut SyphonState, out_w: *mut u32, out_h: *mut u32)` | Read last published texture dimensions |
| `syphon_get_server_name` | `(state: *mut SyphonState, buf_ptr: *mut u8, buf_cap: u32) -> u32` | Read server name into buffer (returns needed bytes) |

**Headless Server:**
| Function | Signature | Purpose |
|---|---|---|
| `syphon_headless_init` | `(name_ptr: *const u8, name_len: u32, fw_ptr: *const u8, fw_len: u32) -> *mut HeadlessSyphonState` | Create headless state with own Metal device |
| `syphon_headless_destroy` | `(state: *mut HeadlessSyphonState)` | Drop state, release textures/queue/server |
| `syphon_headless_publish_frame` | `(state: *mut HeadlessSyphonState, pixel_data: *const u8, width: u32, height: u32, bytes_per_row: u32, pixel_format: u32) -> u64` | Upload CPU pixels, publish via Syphon |
| `syphon_headless_has_clients` | `(state: *mut HeadlessSyphonState) -> u32` | 1 if clients connected |
| `syphon_headless_set_name` | `(state: *mut HeadlessSyphonState, name_ptr: *const u8, name_len: u32)` | Change server name |
| `syphon_headless_set_flipped` | `(state: *mut HeadlessSyphonState, flipped: u32)` | Toggle Y-flip |
| `syphon_headless_get_published_count` | `(state: *mut HeadlessSyphonState) -> u64` | Total frames published |

**Discovery / Client:**
| Function | Signature | Purpose |
|---|---|---|
| `syphon_list_servers` | `(buf_ptr: *mut u8, buf_cap: u32) -> u32` | JSON-encode available Syphon servers into buffer |
| `syphon_client_create` | `(uuid_ptr: *const u8, uuid_len: u32, fw_ptr: *const u8, fw_len: u32) -> *mut SyphonClientState` | Create a Syphon client by server UUID |
| `syphon_client_has_new_frame` | `(state: *mut SyphonClientState) -> u32` | 1 if server has published a new frame |
| `syphon_client_get_frame_size` | `(state: *mut SyphonClientState, out_w: *mut u32, out_h: *mut u32) -> u32` | Get latest frame dimensions |
| `syphon_client_destroy` | `(state: *mut SyphonClientState)` | Stop and release the client |

All string parameters use the `(ptr, len)` pattern rather than null-terminated C strings, which is natural for Deno FFI where JavaScript strings are encoded to UTF-8 byte arrays.

---

### 5. Metal Texture Management Summary

**Windowed path**: No textures are explicitly created. The `CAMetalDrawable`'s backing texture (created by the system as part of the `CAMetalLayer` triple-buffering) is passed directly to Syphon. The key configuration is `setFramebufferOnly: NO` on the layer, which ensures the texture has the read access that Syphon needs.

**Headless path**: Two `MTLTexture` objects are explicitly created with:
- `MTLPixelFormatBGRA8Unorm` (format code `80`)
- `MTLTextureUsageShaderRead` (usage code `1`)
- Created via `[MTLDevice newTextureWithDescriptor:]`
- Lazily (re)created when dimensions change
- Double-buffered to avoid read/write conflicts between CPU upload and Syphon's GPU read
- Released on destroy and on resize

---

### 6. Objective-C Runtime Usage

The crate uses the `objc` 0.2 crate extensively. Key patterns:

**`msg_send!` macro**: Used pervasively for all Objective-C method calls. Examples:
- `msg_send![drawable, retain]` / `msg_send![drawable, release]` -- manual reference counting
- `msg_send![self.syphon_server, publishFrameTexture:texture onCommandBuffer:cmd_buf imageRegion:region flipped:flipped]` -- multi-argument Syphon publish call
- `msg_send![class!(NSString), alloc]` -- class method calls
- `msg_send![super(this, superclass), nextDrawable]` -- super calls in overridden methods

**`Class::get("ClassName")`**: Used to check whether Syphon classes are loaded (since the framework is dynamically loaded):
- `Class::get("SyphonMetalServer")`
- `Class::get("SyphonMetalClient")`
- `Class::get("SyphonServerDirectory")`
- `Class::get("CAMetalLayer")`
- `Class::get("MTLTextureDescriptor")`

**`ClassDecl`**: Used in `ensure_intercepting_layer_class()` to register a new Objective-C class at runtime that subclasses `CAMetalLayer`.

**Method swizzling** (lines 728-758): Uses low-level runtime functions directly:
- `object_getClass()` -- gets the isa pointer (concrete class) of an instance
- `class_getInstanceMethod()` -- finds a method struct by selector
- `method_getImplementation()` -- extracts the function pointer (IMP) from a method
- `method_setImplementation()` -- replaces the IMP with a new function pointer
- `std::mem::transmute` -- casts between Rust function pointers and Objective-C `Imp` type

**NSBundle dynamic loading** (lines 1109-1141): `[NSBundle bundleWithPath:]` + `[bundle load]` to load `Syphon.framework` at runtime.

**`sel!()` macro**: Used for selector construction: `sel!(stop)`, `sel!(setName:)`, `sel!(nextDrawable)`, `sel!(presentDrawable:)`, etc.

**`responds_to_selector`** helper (lines 821-827): Wraps `[obj respondsToSelector:]` with a null check, used defensively before calling optional methods like `stop` and `setName:`.

---

### 7. Non-macOS Stub Implementations (lines 1762-1910)

Under `#[cfg(not(target_os = "macos"))]`, the module defines:
- Empty enums for `SyphonState`, `SyphonClientState`, `HeadlessSyphonState`
- Every FFI function has an identical signature but returns `ptr::null_mut()`, `0`, or is empty
- This allows the crate to compile on non-macOS platforms without errors, which is useful if it is part of a larger workspace or cross-compilation toolchain

---

### 8. Key Architectural Patterns and Decisions

**a) Two-level interception for windowed publishing**: The design uses BOTH a `CAMetalLayer` subclass (to intercept `nextDrawable` and record drawables into the ring) AND a `presentDrawable:` method swizzle (where the actual publishing happens). The ring buffer captures drawables for diagnostic purposes, while the actual publish happens synchronously inside the presentation path. This ensures perfect timing alignment -- the exact frame being presented is the frame that gets published to Syphon.

**b) Lazy server initialization**: The windowed `SyphonMetalServer` is not created until the first time publishing is requested. This is because the Metal device is obtained from the layer, which may not be fully configured at `syphon_init` time (e.g., the WebGPU backend may not have set the device on the layer yet).

**c) Method swizzle scope**: The `presentDrawable:` swizzle is applied to the CONCRETE runtime class of a command buffer instance, not to a base class. This means it swizzles a private Apple class. The swizzle uses `OnceLock` to guarantee it happens exactly once. The hook is global -- it fires for ALL command buffers -- but only takes action when it can look up a `SyphonState` for the drawable's layer.

**d) Framework dynamic loading with fallback cascade**: The Syphon framework is loaded at runtime via `NSBundle`, not linked at compile time. The search order is carefully designed for both development (next to the dylib, relative to crate root, relative to CWD ancestors) and deployment (user/system Library paths). The `dylib_directory()` helper uses `dladdr` to find the path of the running `libsyphon_bridge.dylib` itself.

**e) All state is heap-allocated and pointer-managed**: `Box::into_raw()` / `Box::from_raw()` is the ownership transfer pattern. The Deno FFI side holds the raw pointer as an opaque handle and passes it back on every call.

**f) Double-buffering in headless**: The two-texture ring prevents the CPU upload to texture N from conflicting with Syphon's GPU read of texture N-1 (which happens asynchronously via IOSurface).

**g) Debug logging is performance-aware**: Uses atomic compare-exchange on a millisecond timestamp to throttle log output, with configurable interval. The logging computes FPS from delta counters.

**h) Syphon client support**: There is a basic `SyphonClientState` that wraps `SyphonMetalClient` for receiving frames from other Syphon servers. It supports discovery (`syphon_list_servers` returns JSON), creation by UUID, frame availability checking, and frame size queries. It does not (yet) support pixel readback from received frames.

**i) Server directory introspection**: `collect_server_entries()` (lines 922-988) enumerates the `SyphonServerDirectory.sharedDirectory.servers` array, which contains `NSDictionary` objects. Since the dictionary key names are not part of a public API, the code uses heuristic matching (lowercase key contains "uuid", "name", "app") to extract fields. `looks_like_uuid()` is used as a fallback to identify UUID values.

**j) String buffer protocol**: Multiple functions use a two-call protocol for returning variable-length data. If `buf_cap` is too small, the function returns the required size. The caller can then allocate a larger buffer and call again. `syphon_list_servers` and `syphon_get_server_name` both use this pattern.

---

# Agent: TypeScript Syphon Implementation

Here is a comprehensive analysis of the entire Syphon TypeScript implementation.

---

## 1. FFI Bridge (`/Users/avneeshsarwate/agentCombine/avTools/apps/deno-notebooks/syphon/ffi.ts`)

This file is the lowest layer -- it defines the contract between Deno's JavaScript runtime and a compiled Rust dynamic library (`libsyphon_bridge.dylib`).

### Library Loading

`openLibrary()` calls `Deno.dlopen()` with the symbol table. The `defaultLibUrl()` helper resolves the path relative to the source file, looking under `../native/syphon_bridge/target/release/`. It tries platform-appropriate filenames (`.dylib` on macOS, `.so` on Linux, `.dll` on Windows). Notably, it does a test-open to validate the library exists before returning the URL, which is a nice touch for providing clear error messages.

### Symbol Table: Two Parallel APIs

The `FFI_SYMBOLS` object declares **two complete, parallel APIs** in the Rust dylib:

**Windowed API** (texture-interception based):
- `syphon_init(nsViewPtr, namePtr, nameLen, frameworkPathPtr, frameworkPathLen) -> statePtr` -- Requires an NSView pointer. The Rust side likely uses IOSurface interception to capture what is rendered into that view.
- `syphon_latch_and_publish(statePtr) -> u64` -- Latches the current IOSurface from the view's Metal layer and publishes it. Returns a count/timestamp.
- `syphon_destroy`, `syphon_has_clients`, `syphon_set_name`, `syphon_set_flipped`
- `syphon_get_intercept_count` -- Diagnostic: how many times the surface has been intercepted.
- `syphon_is_server_ready`, `syphon_get_last_texture_size`, `syphon_get_server_name`

**Headless API** (CPU pixel-buffer based):
- `syphon_headless_init(namePtr, nameLen, frameworkPathPtr, frameworkPathLen) -> statePtr` -- No NSView required. Creates a Syphon server that accepts raw pixel data.
- `syphon_headless_publish_frame(statePtr, pixelDataPtr, width, height, bytesPerRow, pixelFormat) -> u64` -- Accepts a raw CPU buffer and publishes it. The pixel format parameter is passed as `0` from TS, meaning BGRA8.
- `syphon_headless_destroy`, `syphon_headless_has_clients`, `syphon_headless_set_name`, `syphon_headless_set_flipped`
- `syphon_headless_get_published_count` -- Diagnostic counter.

**Client API** (for receiving Syphon frames):
- `syphon_list_servers(bufferPtr, bufferLen) -> u32`
- `syphon_client_create(serverNamePtr, serverNameLen, appNamePtr, appNameLen) -> clientPtr`
- `syphon_client_has_new_frame(clientPtr) -> u32`
- `syphon_client_get_frame_size(clientPtr, widthPtr, heightPtr) -> u32`
- `syphon_client_destroy(clientPtr)`

### String Encoding Helper

`encodeString()` converts a JS string to UTF-8 bytes and obtains a raw pointer via `Deno.UnsafePointer.of()`. This is used throughout to pass string arguments across the FFI boundary. The null-check (`bytes.length ? ... : null`) handles the empty-string edge case.

---

## 2. Windowed SyphonServer (`/Users/avneeshsarwate/agentCombine/avTools/apps/deno-notebooks/syphon/syphon.ts`)

### Architecture: IOSurface Interception

The windowed path works by **intercepting the IOSurface** that backs a macOS window's Metal layer. This is the zero-copy path -- the Rust side hooks into the window's CAMetalLayer, and when `latch_and_publish` is called, it grabs the current backing surface and hands it directly to the Syphon framework. No pixel copying needed.

### SyphonServer Class

```
constructor(nsViewPtr, options)
```

The constructor requires a raw `NSView` pointer (as a `bigint`). It:
1. Opens the Rust dylib via `openLibrary()`
2. Encodes the server name and optional framework path as UTF-8
3. Calls `syphon_init()` passing all five parameters: the NSView pointer, name pointer+length, framework path pointer+length
4. Stores the returned opaque state pointer in `#state`
5. Optionally sets the flip-Y flag

Key methods:
- `publishFrame()` -- Calls `syphon_latch_and_publish`. This is the critical per-frame call. Returns a bigint (likely a frame counter or timestamp from Rust).
- `hasClients` / `serverReady` / `interceptCount` / `lastTextureSize` / `name` -- Query properties. The `name` getter uses a two-pass pattern: first call with null/0 to get required length, then allocate and call again.
- `destroy()` -- Calls `syphon_destroy` then closes the dylib. Has a `#closed` guard against double-destroy. Also implements `Symbol.dispose` for `using` syntax.

### createSyphonGpuWindow

This is the high-level convenience function. It:
1. Hooks into the window creation pipeline via `beforeSurfaceCreate` callback
2. The callback receives a `BeforeSurfaceCreateInfo` which contains the `surfaceDisplayHandle` -- this is the NSView pointer
3. Validates the window system is "cocoa" (macOS only)
4. Constructs a `SyphonServer` with that NSView pointer
5. Wraps the `window.close()` to also destroy the Syphon server
6. Returns the window object augmented with a `.syphon` property

The key insight: the NSView pointer is obtained **during window creation** from Deno's native windowing system. The Syphon server attaches to that exact view so it can intercept whatever is rendered there.

---

## 3. HeadlessSyphonServer (`/Users/avneeshsarwate/agentCombine/avTools/apps/deno-notebooks/syphon/headless_syphon.ts`)

### Architecture: CPU Pixel Upload

The headless path is fundamentally different. There is no window, no NSView, no IOSurface interception. Instead:
1. The GPU renders to an offscreen texture
2. That texture is copied to a staging buffer
3. The staging buffer is mapped to CPU memory
4. The raw pixel bytes are passed across FFI to the Rust side
5. Rust publishes them through the Syphon framework

### HeadlessSyphonServer Class

The constructor is simpler -- no NSView pointer needed. It calls `syphon_headless_init()` with just the server name and framework path.

The critical method is `publishFrame(pixelData, width, height, bytesPerRow)`:
1. Takes a `Uint8Array` of raw pixel data
2. Gets a raw pointer to the array's backing memory via `Deno.UnsafePointer.of()`
3. Calls `syphon_headless_publish_frame()` with the pointer, dimensions, bytes-per-row, and pixel format (hardcoded to `0` = BGRA8)
4. Returns a bigint count

The `bytesPerRow` parameter is important because GPU readbacks often have row alignment padding (256-byte alignment in WebGPU), so `bytesPerRow` may be larger than `width * 4`.

Other properties: `hasClients`, `publishedCount`, `name` setter.

---

## 4. Staging Buffers (`/Users/avneeshsarwate/agentCombine/avTools/apps/deno-notebooks/syphon/staging_buffers.ts`)

This is the most architecturally interesting piece. It implements a **double-buffered (ping-pong) GPU readback strategy** to hide latency.

### The Problem

GPU readback is inherently asynchronous and slow:
1. You issue `copyTextureToBuffer` on a command encoder
2. You submit that encoder to the GPU queue
3. You wait for the GPU to finish (`onSubmittedWorkDone`)
4. You map the buffer to CPU address space (`buffer.mapAsync`)
5. You read the bytes

If you do this synchronously every frame, you stall the CPU waiting for the GPU, killing performance.

### The Solution: Ping-Pong Buffers

Two staging buffers alternate roles:
- **Buffer A** is being written to by the GPU (current frame's copy destination)
- **Buffer B** was written to last frame and is now ready for CPU readback

Each frame:
1. Read from the "old" buffer (one frame behind)
2. Write to the "current" buffer
3. Advance: swap roles

This means the published Syphon frame is always **one frame behind** the GPU render. This is a deliberate tradeoff: one frame of latency in exchange for no GPU/CPU synchronization stalls.

### Implementation Details

`alignedBytesPerRow(width, bytesPerPixel=4)`: Computes the 256-byte aligned row stride. WebGPU requires `bytesPerRow` in buffer-to-texture copies to be a multiple of 256. For a 1920px wide BGRA texture: `1920 * 4 = 7680`, which is already a multiple of 256, so no padding. For odd widths, padding is added.

`StagingEntry` tracks per-buffer state:
- `buffer: GPUBuffer | null` -- the actual GPU buffer
- `bytesPerRow`, `width`, `height`, `bufferSize` -- dimensions (cached for resize detection)
- `hasData: boolean` -- whether this buffer has been written to at least once

`createStagingBufferPair()` returns an object with:

- `getWriteBuffer(device, width, height)` -- Returns the current write-side buffer, lazily creating or resizing it via `ensureBuffer()`. The buffer has `COPY_DST | MAP_READ` usage -- it can receive GPU copies and be mapped for CPU reading.

- `getReadBuffer()` -- Returns the opposite buffer (the one NOT being written to). Returns `null` if `frameCount < 1` (no data has been written yet -- first frame). The read index is `(writeIdx + 1) % 2`, which is always the other slot.

- `advance()` -- Marks the current write buffer as having data, then flips `writeIdx` to the other slot. Increments `frameCount`.

- `destroy()` -- Cleans up both GPU buffers.

The `ensureBuffer` function is smart about resizes: it compares all dimension fields and only recreates the buffer if something changed. This handles dynamic resolution changes gracefully.

---

## 5. Headless Renderer (`/Users/avneeshsarwate/agentCombine/avTools/apps/deno-notebooks/syphon/headless_renderer.ts`)

This is the **orchestration layer** that ties everything together into a complete render loop.

### createHeadlessSyphonRenderer

Setup phase:
1. Clamps width/height to >= 1, fps to >= 1 (default 60)
2. Creates a `GPUTexture` with format `bgra8unorm` and usage flags: `RENDER_ATTACHMENT | COPY_DST | COPY_SRC | TEXTURE_BINDING` -- this texture can be rendered into, copied from, used as a bind group source, and received copies
3. Creates a `HeadlessSyphonServer`
4. Creates a `StagingBufferPair`

### The Render Loop (inside `start()`)

The `start()` method accepts an `onFrame` callback that takes `(frameNumber, renderTexture)` and must return a `GPUCommandEncoder`. The caller renders into the texture and returns the encoder (without finishing or submitting it -- the renderer adds more commands).

The loop uses `@avtools/core-timing`'s `launch()` function with a `DateTimeContext`. Each iteration:

**Step 1 -- Read back the previous frame (if available):**
```typescript
const readInfo = staging.getReadBuffer();
if (readInfo) {
    await device.queue.onSubmittedWorkDone();
    await buffer.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(buffer.getMappedRange());
    syphon.publishFrame(bytes, rw, rh, bytesPerRow);
    buffer.unmap();
}
```
On the first frame, `getReadBuffer()` returns null (no previous data), so this is skipped. On subsequent frames, it:
- Waits for all submitted GPU work to complete
- Maps the read buffer to CPU
- Gets the raw bytes
- Passes them to `syphon.publishFrame()` which crosses FFI into Rust
- Unmaps the buffer

**Step 2 -- Render the current frame:**
```typescript
encoder = onFrame(frame, renderTexture);
```
The user's callback draws into `renderTexture` and returns its command encoder.

**Step 3 -- Copy to staging buffer and submit:**
```typescript
const writeInfo = staging.getWriteBuffer(device, width, height);
encoder.copyTextureToBuffer(
    { texture: renderTexture },
    { buffer: writeInfo.buffer, bytesPerRow: writeInfo.bytesPerRow, rowsPerImage: height },
    { width, height, depthOrArrayLayers: 1 },
);
device.queue.submit([encoder.finish()]);
staging.advance();
```
The renderer appends a `copyTextureToBuffer` command to the same encoder the user returned. This copies the rendered texture into the current write-side staging buffer. Then it submits the encoder and advances the staging pair (swapping write/read sides).

**Step 4 -- Wait for next frame:**
```typescript
await ctx.waitSec(1 / fps);
```
Uses core-timing to wait the appropriate duration for the target framerate.

### Timing Characteristics

The `@avtools/core-timing` `launch()` is called with `{ bpm: 60 }`. The `ctx.waitSec(1/fps)` call provides frame pacing. Since the readback `await`s are also in the loop body, the actual frame time is: `max(readback_time, 1/fps)`. If readback takes longer than the frame budget, the framerate drops naturally rather than queueing up work.

### Lifecycle

- `stop()` sets `running = false`, causing the loop to exit on its next iteration
- `destroy()` tears down staging buffers, the render texture, and the Syphon server

---

## 6. Module Exports (`/Users/avneeshsarwate/agentCombine/avTools/apps/deno-notebooks/syphon/mod.ts`)

Clean barrel exports of all public types and functions from all submodules. The public API surface is:
- `FFI_SYMBOLS`, `SyphonLibrary`, `SyphonSymbols` -- for advanced users who want raw FFI access
- `SyphonServer`, `createSyphonGpuWindow`, `SyphonOptions`, `SyphonWindowOptions` -- windowed path
- `HeadlessSyphonServer`, `HeadlessSyphonOptions` -- headless server only
- `createHeadlessSyphonRenderer`, `HeadlessSyphonRenderer`, `HeadlessSyphonRendererOptions` -- full headless pipeline
- `alignedBytesPerRow`, `createStagingBufferPair`, `StagingBufferPair` -- staging utilities

---

## Complete Data Flow Summary

### Windowed Path (zero-copy)
```
GPU renders to window's CAMetalLayer
    |
    v
syphon_latch_and_publish() -- Rust intercepts the IOSurface backing the layer
    |
    v
Syphon framework publishes the IOSurface directly (no pixel copy)
    |
    v
Syphon clients receive the frame
```

### Headless Path (CPU readback with ping-pong)
```
Frame N:
    [1] Map staging buffer B (written in frame N-1), read pixels, pass to syphon_headless_publish_frame()
    [2] User callback renders into renderTexture via GPUCommandEncoder
    [3] Append copyTextureToBuffer from renderTexture -> staging buffer A
    [4] Submit encoder (GPU executes render + copy asynchronously)
    [5] Advance: A becomes the read buffer, B becomes the write buffer
    [6] Wait for next frame tick

Frame N+1:
    [1] Map staging buffer A (written in frame N), read pixels, publish
    [2] Render into renderTexture
    [3] Copy renderTexture -> staging buffer B
    [4] Submit
    [5] Advance
    ...
```

The one-frame latency tradeoff is that published Syphon frames lag the GPU render by exactly one frame. The `onSubmittedWorkDone()` call before `mapAsync()` ensures the GPU has finished writing to the read buffer before mapping it. The ping-pong pattern means the GPU is never blocked waiting on a CPU map -- it always has a free buffer to write to.

---

# Agent: Headless Syphon Sketch Examples

Here is a comprehensive summary of the three syphon example files and their underlying infrastructure.

---

## 1. How the Headless Syphon Sketch Is Structured

**File:** `/Users/avneeshsarwate/agentCombine/avTools/apps/deno-notebooks/examples/p5gpu_text_lfo_perf_syphon_headless.ts`

The headless sketch has no window at all. Its structure is:

1. **GPU device creation** -- manually requests a WebGPU adapter and device (lines 62-67).

2. **P5GPU instance** -- created with explicit `format: "bgra8unorm"` and `sampleCount: 1` (lines 69-74). The windowed versions let P5GPU pick defaults.

3. **HeadlessSyphonRenderer** -- created via `createHeadlessSyphonRenderer(device, { width, height, fps, syphon })` (lines 75-83). This is a self-contained object that owns:
   - A `GPUTexture` (`renderTexture`) with `RENDER_ATTACHMENT | COPY_DST | COPY_SRC | TEXTURE_BINDING` usage flags
   - A `HeadlessSyphonServer` (CPU-pixel-upload path to Syphon, no NSView needed)
   - A double-buffered `StagingBufferPair` for GPU readback
   - An internal timing loop powered by `@avtools/core-timing` (`launch()` with `ctx.waitSec(1/fps)`)

4. **Callback-based render loop** -- `renderer.start(onFrame)` starts the internal timer. The `onFrame` callback receives `(frameNumber, renderTexture)` and must return a `GPUCommandEncoder`. Inside the callback:
   - P5GPU draws the animated text grid via `beginFrame()` / `endFrame()`
   - The returned source texture is copied to the renderer's `renderTexture` via `encoder.copyTextureToTexture()`
   - The encoder is returned (not submitted -- the renderer submits it after appending a `copyTextureToBuffer` for the staging readback)

5. **Busy-wait with hard timeout** -- the main thread sits in a `while (running)` loop polling every 50ms, with a computed hard timeout based on `MAX_FRAMES / FPS + 15s` (lines 152-163).

6. **Cleanup** -- `stopHandle.stop()`, `device.queue.onSubmittedWorkDone()`, then `renderer.destroy()` and `p5.dispose()` in a `finally` block.

---

## 2. How It Differs from the Windowed Syphon Sketches

There are two windowed variants:

- `/Users/avneeshsarwate/agentCombine/avTools/apps/deno-notebooks/examples/p5gpu_text_lfo_perf_syphon.ts` -- uses weight quantization (32 steps)
- `/Users/avneeshsarwate/agentCombine/avTools/apps/deno-notebooks/examples/p5gpu_text_lfo_perf_syphon_wrap.ts` -- uses raw continuous `Math.round(300 + lfo * 600)` weights (no quantization)

Key differences:

| Aspect | Windowed | Headless |
|--------|----------|----------|
| **Window** | `createSyphonGpuWindow()` -- creates an actual OS window with a swapchain | No window at all |
| **Syphon server** | `SyphonServer` -- hooks into the NSView's IOSurface via Metal interop (`syphon_latch_and_publish`) | `HeadlessSyphonServer` -- accepts raw `Uint8Array` pixel data via `syphon_headless_publish_frame` |
| **Frame publishing** | `win.syphon.publishFrame()` -- latches the window's current Metal drawable (zero-copy) | GPU readback to CPU staging buffer, then pixel data passed to FFI |
| **Render loop** | Synchronous `for` loop with `await setTimeout(0)` yield -- the sketch owns the loop | Callback-driven via `renderer.start(onFrame)` -- the renderer owns the timing via `@avtools/core-timing` `launch()` |
| **Presentation** | `blit()` from P5GPU texture to swapchain texture, then `win.present()` | `copyTextureToTexture` from P5GPU to the renderer's `renderTexture` |
| **Event handling** | `win.pollEvents()` with close detection | No events (no window) |
| **Frame pacing** | `await setTimeout(0)` -- runs as fast as possible (vsync from the window swapchain) | `ctx.waitSec(1/fps)` -- explicit timer-based pacing at the configured FPS |
| **Config** | Hardcoded constants | Env-var-driven (`P5_HEADLESS_WIDTH`, `P5_HEADLESS_HEIGHT`, `P5_HEADLESS_FPS`, `P5_HEADLESS_MAX_FRAMES`) |
| **P5GPU format** | Default (no explicit format) | Explicit `format: "bgra8unorm"`, `sampleCount: 1` |
| **Imports** | `createBlitPipeline`, `blit` from `window/mod.ts` | None of the window/blit infrastructure |

---

## 3. Performance Considerations Visible in the Code

**Double-buffered GPU readback (1-frame-late pipeline):**
The most important performance design is in `headless_renderer.ts` (lines 64-108) and `staging_buffers.ts`. The `StagingBufferPair` maintains two GPU buffers and ping-pongs between them:
- On each frame, it first reads back the *previous* frame's staging buffer (`getReadBuffer()` returns the buffer from the previous cycle), maps it, and publishes it to Syphon.
- Then it draws the *current* frame and copies the render texture into the *current* write buffer (`getWriteBuffer()`).
- `advance()` flips the write index.

This means the published Syphon frame is always 1 frame behind the render -- but this avoids stalling the GPU pipeline waiting for readback on the same frame. The `getReadBuffer()` returns `null` for the first frame (line 104: `if (frameCount < 1) return null`), so no publish happens on frame 0.

**Weight quantization:**
The headless sketch and the first windowed sketch (`_syphon.ts`) both use `quantizeWeight()` to snap continuous LFO values to 32 discrete weight steps (lines 36-40). The comment in the windowed file explains: "Fewer unique weights -> better glyph atlas cache hits." The wrap variant does NOT quantize, using `Math.round(300 + lfo * 600)` instead, which produces many more unique weights and stresses the atlas cache harder.

**256-byte row alignment:**
`alignedBytesPerRow()` in `staging_buffers.ts` rounds up to 256-byte boundaries, as required by WebGPU's `copyTextureToBuffer` bytesPerRow constraints.

**Buffer reuse:**
`ensureBuffer()` in the staging pair only creates a new `GPUBuffer` if the dimensions change. For a fixed-size render, the buffers are allocated once and reused every frame.

**`onSubmittedWorkDone()` before map:**
In the headless renderer (line 72), `await device.queue.onSubmittedWorkDone()` is called before `buffer.mapAsync()`. This ensures the GPU copy has actually completed before attempting the map, avoiding validation errors.

**Rolling average perf tracking:**
Both windowed and headless sketches track draw time with a rolling window of `LOG_EVERY` (20) samples and log periodically, allowing detection of performance degradation over time.

**Hard timeout safety:**
The headless sketch computes a generous timeout (`MAX_FRAMES/FPS * 1000 + 15000ms`) so it does not hang forever if the render loop stalls.

---

## 4. Render Loop Structure and Timing

**Windowed (synchronous for-loop):**
```
for frame in 0..MAX_FRAMES:
    pollEvents()              // check for window close
    p5.beginFrame()           // start P5GPU draw
    ...draw 900 characters... // CPU-side text layout + GPU atlas uploads
    texture = p5.endFrame()   // finalize P5GPU render
    swapTexture = win.ctx.getCurrentTexture()  // acquire swapchain
    blit(texture -> swapTexture)               // GPU copy to window
    device.queue.submit()
    win.syphon.publishFrame() // latch Metal drawable for Syphon (zero-copy)
    win.present()             // present to display
    await setTimeout(0)       // yield to event loop (no explicit FPS cap)
```
Frame pacing is effectively driven by the window's swapchain/vsync.

**Headless (callback-driven timer):**
```
renderer.start(onFrame) launches an async loop:

while running:
    // --- PHASE 1: Read back PREVIOUS frame (1 frame late) ---
    readBuffer = staging.getReadBuffer()   // null on first frame
    if readBuffer:
        await device.queue.onSubmittedWorkDone()
        await readBuffer.mapAsync(READ)
        bytes = readBuffer.getMappedRange()
        syphon.publishFrame(bytes, w, h, bytesPerRow)  // CPU pixels -> Syphon FFI
        readBuffer.unmap()

    // --- PHASE 2: Draw CURRENT frame ---
    encoder = onFrame(frameNumber, renderTexture)
        // inside onFrame:
        //   p5.beginFrame()
        //   ...draw 900 characters...
        //   sourceTexture = p5.endFrame()
        //   encoder.copyTextureToTexture(source -> renderTexture)
        //   return encoder

    // --- PHASE 3: Queue readback of current frame for NEXT iteration ---
    writeBuffer = staging.getWriteBuffer(device, w, h)
    encoder.copyTextureToBuffer(renderTexture -> writeBuffer)
    device.queue.submit([encoder.finish()])
    staging.advance()   // flip the double buffer

    // --- PHASE 4: Wait for next frame ---
    await ctx.waitSec(1/fps)   // @avtools/core-timing sleep
```

The key insight is the pipeline structure: drawing frame N and reading back frame N-1 happen in the same iteration, so GPU work and CPU readback overlap. The `onFrame` callback returns the encoder *before* it is finished -- the renderer appends the `copyTextureToBuffer` command and submits. This means the sketch author does not need to manage staging buffers or submission.

---

# Agent: Spout Codebase Analysis

Now I have a comprehensive understanding. Let me compile the full analysis.

---

## Comprehensive Analysis of the Spout Architecture

### 1. Project Overview

**Spout** (v2.007.017, by Lynn Jarvis) is a Windows-only real-time video frame sharing framework, conceptually analogous to **Syphon** on macOS. It enables applications to share GPU textures (or CPU pixel buffers as fallback) with zero-copy or minimal-copy semantics. The codebase is C++ under BSD-2-Clause license, lives at `github.com/leadedge/Spout2`, and builds with CMake 3.15+.

---

### 2. Directory / SDK Structure

```
Spout2/
  CMakeLists.txt                    # Top-level build
  SPOUTSDK/
    SpoutGL/                        # Core SDK (OpenGL + DX interop)
      Spout.h / Spout.cpp          # Main sender/receiver class (inherits spoutGL)
      SpoutGL.h / SpoutGL.cpp      # Base class: GL/DX interop, CPU fallback, shared memory
      SpoutDirectX.h / .cpp        # DirectX 11 device/texture management
      SpoutSenderNames.h / .cpp    # Sender registry via shared memory
      SpoutSharedMemory.h / .cpp   # Named shared memory (Windows memory-mapped files)
      SpoutFrameCount.h / .cpp     # Frame counting, sync semaphores, mutex access
      SpoutCopy.h / .cpp           # Pixel format conversion (SSE2/SSE3/SSSE3 optimized)
      SpoutGLextensions.h / .cpp   # OpenGL extension loading (NV_DX_interop, PBO, FBO)
      SpoutUtils.h / .cpp          # Registry, logging, timing, message boxes
    SpoutLibrary/
      SpoutLibrary.h               # C-compatible DLL interface (COM-like vtable)
    SpoutDirectX/
      SpoutDX/
        SpoutDX.h / .cpp           # Pure DirectX 11 sender/receiver (no OpenGL)
        SpoutDX9/                   # DirectX 9 support
        SpoutDX12/                  # DirectX 12 support
```

---

### 3. The Texture Sharing Mechanism (Core Architecture)

Spout's sharing is built on **three** layered mechanisms, with automatic fallback:

#### Layer 1: GL/DX Interop (GPU zero-copy) -- Primary Path

This is the fast path, relying on the **`WGL_NV_DX_interop`** OpenGL extension (available on NVIDIA and most AMD/Intel GPUs on Windows):

1. **Sender** creates a **DirectX 11 shared texture** with `D3D11_RESOURCE_MISC_SHARED` misc flag
2. The shared texture gets a **HANDLE** (a Windows kernel object handle that can be opened cross-process)
3. `wglDXOpenDeviceNV()` opens the DX device for GL interop
4. `wglDXRegisterObjectNV()` links the DX shared texture to an OpenGL texture ID
5. `wglDXLockObjectsNV()` / `wglDXUnlockObjectsNV()` synchronize access -- "only one GL context may hold the lock at any time"
6. The sender writes to the OpenGL texture (which is backed by the same GPU memory as the DX texture)
7. The **receiver** opens the same DX texture via `pDevice->OpenSharedResource(dxShareHandle, ...)` and either:
   - Uses GL/DX interop to read it as an OpenGL texture, or
   - Uses it directly as a DX11 texture (in the SpoutDX path)

The share handle and texture metadata (width, height, format) are communicated via **shared memory** (see below), not through the texture itself.

**Key difference from Syphon**: Syphon on macOS uses **IOSurface** (a macOS kernel-managed cross-process surface) with Metal or OpenGL backing. Spout uses **DirectX shared texture handles** (`DXGI_SHARED_RESOURCE`). Both achieve zero-copy GPU sharing, but through completely different OS/API mechanisms. Syphon is Metal-native on modern macOS; Spout is DirectX 11-native on Windows with OpenGL bridged via NV_DX_interop.

#### Layer 2: CPU Staging Texture Fallback

When GL/DX interop is unavailable (older GPUs, incompatible drivers):

1. Sender renders to an OpenGL texture
2. `WriteDX11texture()` reads the OpenGL texture via PBO into CPU memory
3. Copies CPU pixels into a **DX11 staging texture** (`D3D11_USAGE_STAGING` with `CPU_ACCESS_READ | CPU_ACCESS_WRITE`)
4. `CopyResource()` transfers from staging to the shared DX11 texture
5. Receiver reverses: shared texture -> staging texture -> `Map()`/`Unmap()` -> CPU pixels -> `glTexSubImage2D()`

This is significantly slower but still uses DX11 shared textures for cross-process transport.

#### Layer 3: Pure Memory Share (Legacy 2.006)

A legacy mode using only shared memory (no GPU textures at all). Pixels are copied to/from named shared memory maps. This is retained for backward compatibility but effectively deprecated in 2.007+.

**Auto-share logic**:
```
if (GL/DX interop works)     -> Layer 1 (GPU zero-copy)
else if (Auto mode or CPU mode) -> Layer 2 (CPU staging)
else                          -> fail
```

---

### 4. Sender Lifecycle

```
CreateSender("MyApp", width, height, format)
  -> OpenSpout()          // detect GPU capabilities, load GL extensions
  -> OpenDirectX11()      // create or attach DX11 device
  -> LoadGLextensions()   // probe NV_DX_interop, PBO, FBO, etc.
  -> GLDXready()          // test if interop actually works
  -> CreateSharedDX11Texture()  // DX11 texture with MISC_SHARED flag
  -> LinkGLDXtextures()        // wglDXOpenDeviceNV + wglDXRegisterObjectNV
  -> sendernames.CreateSender() // register name + SharedTextureInfo in shared memory

Per frame:
  SendTexture(texID, target, w, h, invert)
    -> CheckSender()       // validate or recreate if size changed
    -> frame.CheckTextureAccess()  // acquire mutex (67ms timeout)
    -> WriteGLDXtexture()  // lock interop, glCopyImageSubData or FBO blit, unlock
    -> frame.SetNewFrame()         // increment semaphore
    -> frame.AllowTextureAccess()  // release mutex

  SendImage(pixels, w, h, format)
    -> Same flow but WriteGLDXpixels() or WriteDX11pixels() instead

  SendFbo(fboID, w, h)
    -> Reads from currently bound FBO

ReleaseSender()
  -> sendernames.ReleaseSenderName()
  -> CleanupInterop()
  -> CleanupGL()
```

---

### 5. Receiver Lifecycle

```
CreateReceiver(name, width, height)
  -> OpenSpout()
  -> ReceiveSenderData()   // look up sender in shared memory registry
  -> OpenDX11shareHandle() // pDevice->OpenSharedResource(handle, ...)
  -> CreateInterop()       // if using GL/DX interop path

Per frame:
  ReceiveTexture(texID, target)
    -> ReceiveSenderData()     // check for sender changes (size, format, name)
    -> frame.CheckTextureAccess()
    -> ReadGLDXtexture()       // lock interop, copy, unlock
       OR ReadDX11texture()    // CPU staging fallback
    -> frame.GetNewFrame()     // check semaphore for new frame
    -> frame.AllowTextureAccess()

  ReceiveImage(pixels, format)
    -> Same but ReadGLDXpixels() or ReadDX11pixels()
    -> Uses double-buffered staging textures for async readback
       (2.5-3.5ms at 1080p vs 7-12ms single-buffer)
```

---

### 6. Sender Registry (Cross-Process Discovery)

Spout uses **Windows named shared memory** (memory-mapped files) for its sender directory:

- **"SpoutSenderNames"**: Fixed-size buffer holding up to `MaxSenders` entries, each 256 bytes (the sender name string)
- **Per-sender maps**: Each sender creates a shared memory map named after itself, containing `SharedTextureInfo` (280 bytes):
  ```
  SharedTextureInfo {
      uint32_t shareHandle;   // DX share handle (truncated to 32-bit)
      uint32_t width, height;
      uint32_t format;        // DXGI_FORMAT
      uint32_t usage;
      uint32_t partnerId;     // CPU/GLDX flags
      char description[256];  // host exe path
  }
  ```
- **"ActiveSenderName"**: Separate 256-byte shared memory holding the "active" (default) sender name

Discovery: A receiver calls `GetSenderNames()` which reads from "SpoutSenderNames" shared memory, then for each sender name opens its individual shared memory map to read `SharedTextureInfo`.

**Stale entry cleanup**: `CleanSenders()` removes entries whose shared memory maps are no longer accessible (application crashed without cleanup).

---

### 7. Graphics API Support

| API | Support | Notes |
|-----|---------|-------|
| DirectX 11 | Primary | Core sharing mechanism; shared textures via `DXGI_SHARED_RESOURCE` |
| OpenGL | Full | Via `WGL_NV_DX_interop` extension bridging to DX11 |
| DirectX 9 | Legacy | SpoutDX9 module; DX9 shared surfaces (format codes 21, 22) |
| DirectX 12 | Supported | SpoutDX12 module; separate build target |
| Vulkan | Not native | No Vulkan-specific code; would need VK_KHR_external_memory_win32 interop |

---

### 8. Headless / Offscreen Operation

Spout **can work offscreen/headless** with some caveats:

**SpoutDX path (DirectX-only)**: Fully headless-capable. `OpenDirectX11()` creates a DX11 device without any window. `SendTexture()` and `SendImage()` work with GPU textures or CPU pixel buffers. No window or display surface is required. The comment in the code confirms: "hwnd can be null for spoutdx.CreateDX9device."

**SpoutGL path (OpenGL)**: Requires a valid OpenGL context (via `wglGetCurrentDC()`), but that context does not need to be tied to a visible window. `CreateOpenGL(HWND hwnd = nullptr)` can create a hidden GL context. However, `SendFbo()` returns false if the window is iconic (minimized).

**SendImage()**: The most headless-friendly API. It accepts raw `unsigned char*` pixel buffers. On the DX path, it uses `UpdateSubresource()` to push CPU pixels directly to the shared GPU texture. No rendering context needed on the sender side beyond a DX11 device.

---

### 9. Thread Safety

Spout employs a multi-layered synchronization strategy:

1. **Named Mutexes** (cross-process): Created per-sender for texture access serialization. `CheckTextureAccess()` calls `WaitForSingleObject(mutex, 67ms)`. The 67ms timeout prevents deadlocks (roughly 4 frames at 60fps -- better to skip a frame than block).

2. **Keyed Mutexes** (DX11-native): When textures are created with `D3D11_RESOURCE_MISC_SHARED_KEYEDMUTEX`, Spout uses `IDXGIKeyedMutex::AcquireSync(0, 67)` / `ReleaseSync(0)` for GPU-pipeline-level synchronization. More efficient than named mutexes but not compatible with DX9.

3. **Semaphores** (frame counting): Named semaphores signal new frames. `SetNewFrame()` increments; `GetNewFrame()` reads and compares to detect new data. Non-blocking reads prevent receiver stalls.

4. **Shared memory locks**: `SpoutSharedMemory::Lock()` / `Unlock()` protect the sender registry during registration/enumeration.

5. **GL/DX interop locks**: `wglDXLockObjectsNV()` / `wglDXUnlockObjectsNV()` ensure exclusive GL access to the shared DX texture. "Only one GL context may hold the lock at any given time."

---

### 10. SendImage / SendTexture API Variants

**SendTexture(GLuint TextureID, GLuint TextureTarget, unsigned int width, unsigned int height, bool bInvert, GLuint HostFBO)**
- Sends an OpenGL texture. Routes to `WriteGLDXtexture()` (zero-copy interop) or `WriteDX11texture()` (CPU staging).

**SendImage(const unsigned char* pixels, unsigned int width, unsigned int height, GLenum glFormat, bool bInvert)**
- Sends raw CPU pixel data. Supports GL_RGBA, GL_BGRA, GL_RGB, GL_BGR. Routes to `WriteGLDXpixels()` or `WriteDX11pixels()`.

**SendFbo(GLuint FboID, unsigned int width, unsigned int height, bool bInvert)**
- Sends the texture attached to a framebuffer object. Reads from the currently bound FBO.

**SpoutDX::SendTexture(ID3D11Texture2D* pTexture)**
- Pure DX11 path. `CopyResource()` from the application's texture to the shared texture. No OpenGL involved.

**SpoutDX::SendImage(unsigned char* pData, unsigned int width, unsigned int height, unsigned int pitch)**
- Pure DX11 path. `UpdateSubresource()` to push CPU pixels directly to GPU shared texture.

---

### 11. Memory Share Mode (CPU-only fallback)

The legacy "memory share" mode (2.006 era) used shared memory maps to transfer raw pixel data without any GPU texture sharing:

- `WriteMemoryBuffer(name, data, length)` / `ReadMemoryBuffer(name, data, maxlength)` -- write/read arbitrary data to named shared memory
- First 16 bytes store the data length as a decimal string
- In modern Spout 2.007+, this is primarily used for **auxiliary data exchange** (metadata, control messages) alongside texture sharing, not as the primary frame transport
- The `SetMemoryShareMode()` / `GetMemoryShareMode()` APIs still exist for backward compatibility
- The modern CPU fallback is Layer 2 (staging textures), not pure memory share

---

### 12. Pixel Format Handling and Optimization

The `SpoutCopy` class provides extensive format conversion with SIMD optimization:

- **SSE2**: `rgba2bgra()`, `bgra2rgba()`, `memcpy_sse2()`
- **SSE3**: `rgba_to_rgb_sse3()`, `rgba_to_bgr_sse3()`
- **SSSE3**: In-place component swapping
- Runtime detection via `GetSSE()`, `GetSSE2()`, `GetSSE3()`, `GetSSSE3()`
- `CopyPixels()` auto-selects the fastest available path based on CPU capabilities and image width
- Supports pitch/stride handling for DX staging texture row alignment (multiples of 16)

---

### 13. Comparison: Spout vs Syphon

| Aspect | Spout (Windows) | Syphon (macOS) |
|--------|-----------------|----------------|
| **Sharing primitive** | DirectX 11 shared texture (`DXGI_SHARED_RESOURCE` handle) | IOSurface (kernel-managed cross-process surface) |
| **GPU API bridge** | OpenGL via `WGL_NV_DX_interop` extension | Metal texture backed by IOSurface; legacy OpenGL via CGLTexImageIOSurface2D |
| **Discovery** | Named shared memory maps ("SpoutSenderNames") | Distributed notifications + NSConnection (Obj-C distributed objects) |
| **Sync mechanism** | Named mutexes + keyed mutexes + semaphores | IOSurface inherent synchronization + Metal fences |
| **CPU fallback** | DX11 staging textures with CPU map/unmap | No built-in CPU fallback (IOSurface always GPU-backed) |
| **Headless** | Yes -- DX11 device without window; SendImage from CPU pixels | Possible with headless Metal device + offscreen texture (as in your `HeadlessGPUCanvasContext`) |
| **Frame signaling** | Semaphore-based frame counter (cross-process) | Syphon server publishes new frame notifications |
| **Texture format** | DXGI_FORMAT (default B8G8R8A8_UNORM); DX9 legacy formats | MTLPixelFormat or IOSurface pixel format |
| **Multi-GPU** | Adapter enumeration + `OpenSharedResource` across adapters | IOSurface is GPU-agnostic (kernel object) |
| **Platform** | Windows only | macOS only |
| **Build system** | CMake; MSVC static runtime; optional ARM (sse2neon) | Xcode / CMake; Objective-C++ |
| **DX version support** | DX9, DX11, DX12 | N/A |
| **Pure memory path** | Legacy shared memory (WriteMemoryBuffer), mostly deprecated | None |
| **SIMD optimization** | SSE2/SSE3/SSSE3 pixel conversion | Not in Syphon itself (relies on GPU) |

**Architectural similarity**: Both follow the same pattern: a sender registers itself in a discoverable directory, creates a GPU-backed shared surface, and receivers open the same surface by handle/reference. The key difference is the OS primitive: Windows uses DX shared texture handles passed via shared memory; macOS uses IOSurface handles passed via Mach ports / distributed objects.

**Key architectural difference**: Spout has a more complex fallback chain (GL/DX interop -> CPU staging -> pure memory share) because the `WGL_NV_DX_interop` extension is not universally available. Syphon's IOSurface is a first-class OS primitive that always works when the GPU is present, so no fallback is needed.

---

# Agent: Spout Windows Research

Now I have comprehensive information across all five areas. Let me compile my findings.

---

Here is a thorough analysis of Spout across all five dimensions you asked about.

---

## 1. Window Occlusion: Does Spout Have the Same Problem as Syphon?

**Short answer: No, Windows does NOT have the same "infinite block" problem that macOS has with CAMetalLayer drawables. The Windows problem is much more manageable.**

### How DXGI Handles Occlusion

On Windows, when a window is occluded (behind another window, on a different virtual desktop, or minimized), `IDXGISwapChain::Present()` does **not block indefinitely**. Instead, it returns the status code `DXGI_STATUS_OCCLUDED`. This is fundamentally different from macOS where `CAMetalLayer.nextDrawable()` / `getCurrentTexture()` blocks forever waiting for a drawable that will never be recycled.

Key behaviors:
- **Non-flip model swap chains**: `Present()` returns `DXGI_STATUS_OCCLUDED` and the window simply does not update. Old content remains displayed. The call returns immediately with the status code.
- **Flip model swap chains** (the modern default on Windows 10/11): The documentation claims you "will not receive `DXGI_STATUS_OCCLUDED`" but a [recent blog post from January 2026](https://blog.yuo.be/2026/01/25/dxgi-occlusion-statuses-broken-and-a-pain/) documents that you *do* still get it in certain scenarios (UAC prompts, Ctrl+Alt+Del screens), but the window updates regardless. Critically, it does NOT block.
- **Minimized windows**: When a window receives `WM_SIZE` with `SIZE_MINIMIZED`, the [DXGI Best Practices documentation](https://learn.microsoft.com/en-us/windows/win32/direct3darticles/dxgi-best-practices) recommends the app "yield CPU time to other processes." The standard pattern is to detect minimization and skip rendering, but if you *do* call Present on a minimized window, it returns `DXGI_STATUS_OCCLUDED` rather than blocking.

### The DWM (Desktop Window Manager) Difference

The Windows DWM composes all windows on the GPU, including minimized ones (it renders thumbnails for the taskbar). Unlike macOS where the window server stops recycling CAMetalLayer drawables for occluded windows, DWM does not starve applications of GPU resources. The DWM uses flip model compositing where all back buffers are shared with DWM, so there is no "drawable starvation" problem.

### What This Means for Spout

Since Spout operates by sharing DirectX 11 textures via shared handles (not via swap chain presentation), the occlusion question is largely **irrelevant to Spout itself**. Spout's shared texture mechanism (`D3D11_RESOURCE_MISC_SHARED`) is completely independent of window visibility. Even if the *sender application's* window is occluded, the shared texture handle remains valid and accessible to receivers.

The only concern would be if you are rendering your content to a swap chain back buffer and then sharing that. In that case, you would want to render to an offscreen texture instead (which is the pattern you are already using with "headless Syphon" on macOS).

---

## 2. Spout Architecture for Headless/Offscreen Use

**Spout can absolutely work without any visible window.** This is one of the biggest advantages over the Syphon-on-macOS situation.

### Spout's Sharing Mechanisms

Spout uses three sharing methods (from [DeepWiki analysis](https://deepwiki.com/leadedge/Spout2) and [texture sharing workflow](https://deepwiki.com/leadedge/Spout2/2.1-texture-sharing-workflow)):

1. **GPU Texture Sharing (primary)**: Creates a DirectX 11 shared texture with `D3D11_RESOURCE_MISC_SHARED` flag. The texture gets a share handle (a 32-bit identifier) registered in a shared memory sender registry. Receivers open the handle via `OpenDX11shareHandle()`. Uses NVIDIA `wglDXOpenDeviceNV` / `wglDXRegisterObjectNV` extensions for OpenGL interop. Achieves ~0.45ms latency at 4K@60fps. **No window required.**

2. **CPU Fallback Mode**: When GPU interop is unavailable, falls back to DirectX staging textures. Uses dual staging textures that alternate each frame for async readback (Frame N: write to staging[0], read from staging[1]). Achieves ~5-7ms latency at 4K. **No window required.**

3. **Memory Share Mode**: Legacy fallback using system RAM. Pixel data transferred through CPU-accessible staging textures. **No window required.**

### SendImage Without a Window

`SpoutDX::SendImage()` takes raw pixel data (`const unsigned char* pixels`, width, height, format) and internally creates/updates a shared DirectX texture. Since `D3D11CreateDevice()` can be called without any HWND (you only need an HWND for `D3D11CreateDeviceAndSwapChain()`), SendImage can work entirely headlessly.

The [MinimalOffscreenD3D](https://github.com/carasuca/MinimalOffscreenD3D) project demonstrates creating a D3D11 device with an offscreen render target buffer and no window at all -- just `D3D11CreateDevice()` plus render-to-texture.

### Proven Headless Implementations

Several projects prove this works:
- **[cef-spout](https://github.com/fg-uulm/cef-spout)**: Chromium Embedded Framework with offscreen rendering, output sent via Spout. No visible window.
- **[electron-spout](https://github.com/reitowo/electron-spout)**: Electron's offscreen rendering shared to Spout.
- **[Spout2 Issue #18](https://github.com/leadedge/Spout2/issues/18)**: Confirmed that DirectX11 Spout receivers work on offscreen shared OpenGL contexts created with `wglShareLists` without a related HWND.

### DirectX Shared Textures: No Window Required

The shared texture mechanism uses `IDXGIResource::GetSharedHandle()` which is a GPU/kernel-level resource handle. It does not reference any window or swap chain. The `SharedTextureInfo` structure stores only: width, height, shareHandle, format, and a partner ID.

---

## 3. Spout + Rust FFI Considerations

### Existing Rust Crate

There is **one existing crate**: [spout_texture_share](https://lib.rs/crates/spout_texture_share) by Edward Taylor (edeetee).
- Version 0.1.0, released December 5, 2022
- Uses `autocxx` and `cxx` crates for C++ FFI bindings
- **Unmaintained**: the author states "I have a mac now so aren't using it. Feel free to take over or make a pull request."
- Large crate size (~16MB) because it bundles the Spout C++ source
- MIT/Apache dual licensed

This crate is not production-ready and would need significant work.

### SpoutLibrary: The C-Compatible DLL

The best path for Rust FFI is **SpoutLibrary**, which Spout provides specifically for non-MSVC compilers. From the [SpoutLibrary header](https://github.com/leadedge/Spout2/blob/master/SPOUTSDK/SpoutLibrary/SpoutLibrary.h) and [documentation](https://spoutlibrary-site.netlify.app/):

- It exposes a COM-style virtual table interface through a `SPOUTLIBRARY` struct
- There is exactly ONE `extern "C"` entry point: `GetSpout()` which returns a `SPOUTHANDLE` (pointer to the vtable struct)
- All subsequent calls go through virtual method pointers on that struct
- Available as both a DLL (`SpoutLibrary.dll`) and a static lib (`SpoutLibrary_static.lib`)

The virtual method table includes functions like:
- `SetSenderName()`, `SetSenderFormat()`, `ReleaseSender()`
- `SendTexture()`, `SendImage()`, `SendFbo()`
- `ReceiveTexture()`, `ReceiveImage()`
- `IsInitialized()`, `IsUpdated()`, `IsConnected()`
- `GetSenderCount()`, `GetSenderName()`, `GetSenderInfo()`

### Rust FFI Strategy

Because SpoutLibrary uses a COM-like vtable pattern rather than flat C functions, the recommended approach would be:

1. **Option A**: Write a thin C wrapper that calls through the vtable and exposes flat `extern "C"` functions. Then use `bindgen` in Rust to generate bindings to the flat C API. This is the cleanest approach.

2. **Option B**: Use `bindgen` directly on the SpoutLibrary.h header, but you would need to manually reconstruct the vtable layout in Rust, which is error-prone.

3. **Option C**: Use the SpoutDX class directly (C++ API) with `autocxx`/`cxx` like the existing crate does, but this brings in C++ name mangling complexity and a heavy build dependency.

**Recommended**: Option A. Write a small C wrapper (`spout_c_api.h` / `spout_c_api.cpp`) that loads SpoutLibrary.dll, calls `GetSpout()`, and exposes each method as a flat C function:

```c
// spout_c_api.h
extern "C" {
    void* spout_create();
    bool spout_set_sender_name(void* handle, const char* name);
    bool spout_send_image(void* handle, const unsigned char* pixels,
                          unsigned int width, unsigned int height);
    void spout_release(void* handle);
}
```

Then in Rust, use `bindgen` on this header and link against the wrapper.

---

## 4. Spout + WebGPU/Vulkan/DirectX Interop

### Spout's Current Architecture

Spout traditionally uses **DirectX 11 shared textures** as its universal exchange format. All paths -- OpenGL, DX9, DX11, DX12 -- ultimately share through DX11 shared textures.

### DirectX 12 Support

Spout has [official DX12 support](https://spout.discourse.group/t/directx-12-support/216) via the `SpoutDX12` class in the [beta/master branch](https://github.com/leadedge/Spout2/tree/beta/SPOUTSDK/SpoutDirectX). It uses the **D3D11On12** compatibility layer:
- Creates a D3D11 device wrapped around the D3D12 device
- DX11 shared textures are still the exchange format under the hood
- This means DX12 apps can participate in the Spout ecosystem without the receiver needing to know

### Vulkan Interop

There is an [open issue (#59)](https://github.com/leadedge/Spout2/issues/59) about porting Spout to `VK_KHR_external_memory`. The current status:
- **Possible today via DX11 interop**: A Vulkan app can import a DX11 shared texture handle using `VK_KHR_external_memory_win32` with `VK_EXTERNAL_MEMORY_HANDLE_TYPE_D3D11_TEXTURE_BIT`
- **Native Vulkan path**: Not yet implemented in Spout itself, but the Spout maintainer acknowledges it is technically feasible
- The [DirectX-Vulkan interop approach documented by Evergine](https://evergine.com/directx-vulkan-interop/) shows how to share textures between DX11 and Vulkan using `VK_KHR_external_memory_win32`

### wgpu (WebGPU) Interop

This is the most relevant path for your Deno/WebGPU use case:

- **wgpu PR #6161** (MERGED, October 2024): [Adds `texture_from_d3d11_shared_handle`](https://github.com/gfx-rs/wgpu/pull/6161) to the Vulkan backend. This allows creating a wgpu/Vulkan texture from a D3D11 shared handle -- exactly what Spout produces. Uses `VK_KHR_external_memory_win32`.

- **wgpu Issue #2320** (OPEN): [Texture memory import API](https://github.com/gfx-rs/wgpu/issues/2320) -- a broader proposal for importing external textures across all backends. On Windows, this would use `HANDLE` objects for cross-process sharing.

- **wgpu on Windows defaults to DX12** (or Vulkan as fallback). Since Spout's DX12 support uses D3D11On12 under the hood, the shared texture handles are still DX11 handles, which means the wgpu Vulkan backend's new `texture_from_d3d11_shared_handle` could theoretically import them.

### CPU Readback Path (The Practical Approach)

The same approach you use for headless Syphon on macOS would work perfectly on Windows:

1. Render to an offscreen WebGPU texture (via wgpu/Deno)
2. Read back to CPU (`mapAsync` on a buffer)
3. Call `SpoutDX::SendImage()` with the raw pixel data

This CPU readback path:
- **Completely avoids** the DX11/DX12/Vulkan interop complexity
- Works with any graphics API on the sender side
- Uses Spout's dual-staging-texture async readback for decent performance
- The overhead is the GPU-to-CPU readback on your side (~5-7ms at 4K based on Spout's own CPU path benchmarks)
- For 1080p at 60fps, this should be comfortably within budget

---

## 5. Windows-Specific Windowing Concerns

### Creating a DirectX Device Without a Window: Yes, Fully Supported

[`D3D11CreateDevice()`](https://learn.microsoft.com/en-us/windows/win32/api/d3d11/nf-d3d11-d3d11createdevice) creates a device and immediate context with **no HWND parameter at all**. Only `D3D11CreateDeviceAndSwapChain()` requires a window (because the swap chain needs a presentation target).

For D3D12, `D3D12CreateDevice()` similarly requires no window. You only need a window for creating a swap chain via `IDXGIFactory::CreateSwapChain()`.

The [MinimalOffscreenD3D](https://github.com/carasuca/MinimalOffscreenD3D) project demonstrates:
1. Create D3D11 device (no window)
2. Create an offscreen render target texture
3. Render to it
4. Copy texture out via staging texture
5. Encode to PNG via WIC

### WARP (Windows Advanced Rasterization Platform)

[WARP](https://en.wikipedia.org/wiki/Windows_Advanced_Rasterization_Platform) is Microsoft's software rasterizer:
- Available on Windows 7+ for D3D10/11, updated on Windows 10 for D3D12 (feature level 12_1), updated on Windows 11 for feature level 12_2 (DX12 Ultimate including raytracing)
- Useful for headless environments without GPU (containers, CI, servers)
- Performance is insufficient for real-time rendering but works for single-frame capture
- Selected by passing `D3D_DRIVER_TYPE_WARP` to `D3D11CreateDevice()`
- You almost certainly do NOT want this for Spout real-time texture sharing; it is for fallback scenarios

### Does Windows Have the macOS "Occluded Window Blocks Drawable" Problem?

**No.** Here is the critical comparison:

| Aspect | macOS (Syphon) | Windows (Spout) |
|--------|---------------|-----------------|
| Occluded window drawable | `nextDrawable()` blocks **indefinitely** | `Present()` returns `DXGI_STATUS_OCCLUDED` immediately |
| Minimized window | Same blocking behavior | App gets `WM_SIZE`/`SIZE_MINIMIZED`, can skip rendering or call Present (which returns immediately with status) |
| Virtual desktop / different Space | Blocks (window server stops recycling drawables) | Not documented as blocking; DWM continues compositing for taskbar thumbnails |
| Solution | Must use headless/offscreen rendering (your `HeadlessGPUCanvasContext` approach) | Can use offscreen rendering, but even windowed rendering does not block |
| Shared texture validity | IOSurface remains valid regardless | DX11 shared handle remains valid regardless |

The fundamental architectural difference: on macOS, the window server controls drawable recycling for `CAMetalLayer`, and it *stops* recycling when the window is not visible. On Windows, DXGI swap chains are application-controlled resources. The DWM shares back buffers via the flip model but does not starve the application -- it simply tells the application the window is occluded and lets the application decide what to do.

---

## Summary and Recommendations

For your cross-platform Deno/WebGPU texture sharing system:

1. **The headless approach you built for Syphon on macOS is the right architecture on Windows too**, but for different reasons. On macOS it is *required* to avoid blocking. On Windows it is *preferred* for cleanliness and simplicity, but not strictly required.

2. **The CPU readback path** (render offscreen -> readback -> `SendImage()`) is the most practical approach for Spout integration. It avoids all the DX11/Vulkan interop complexity and works reliably.

3. **For Rust FFI**: Write a thin C wrapper around SpoutLibrary's COM-style vtable, then use `bindgen`. The existing `spout_texture_share` crate is abandoned and uses complex autocxx bindings.

4. **No occlusion blocking concerns on Windows**. The macOS problem with `CAMetalLayer` drawable starvation simply does not exist on Windows. DXGI returns status codes instead of blocking.

5. **If you later want zero-copy GPU path**: wgpu has merged support for importing DX11 shared textures into Vulkan (PR #6161), which could enable direct GPU-to-GPU Spout texture sharing without CPU readback. But this would require working outside the standard WebGPU API.

Sources:
- [Spout2 GitHub Repository](https://github.com/leadedge/Spout2)
- [Spout2 DeepWiki Overview](https://deepwiki.com/leadedge/Spout2)
- [Spout2 Texture Sharing Workflow](https://deepwiki.com/leadedge/Spout2/2.1-texture-sharing-workflow)
- [DXGI Occlusion Statuses: Broken and a Pain (2026)](https://blog.yuo.be/2026/01/25/dxgi-occlusion-statuses-broken-and-a-pain/)
- [IDXGISwapChain::Present Documentation](https://learn.microsoft.com/en-us/windows/win32/api/dxgi/nf-dxgi-idxgiswapchain-present)
- [DXGI Overview - Microsoft](https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/d3d10-graphics-programming-guide-dxgi)
- [DXGI Best Practices](https://learn.microsoft.com/en-us/windows/win32/direct3darticles/dxgi-best-practices)
- [DXGI Flip Model](https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/dxgi-flip-model)
- [Spout DX12 Support Announcement](https://spout.discourse.group/t/directx-12-support/216)
- [Spout2 Vulkan External Memory Issue #59](https://github.com/leadedge/Spout2/issues/59)
- [SpoutLibrary.h Header](https://github.com/leadedge/Spout2/blob/master/SPOUTSDK/SpoutLibrary/SpoutLibrary.h)
- [SpoutLibrary Documentation](https://spoutlibrary-site.netlify.app/)
- [spout_texture_share Rust Crate](https://lib.rs/crates/spout_texture_share)
- [wgpu PR #6161: Vulkan texture from D3D11 shared handle](https://github.com/gfx-rs/wgpu/pull/6161)
- [wgpu Issue #2320: Texture Memory Import API](https://github.com/gfx-rs/wgpu/issues/2320)
- [D3D11CreateDevice Documentation](https://learn.microsoft.com/en-us/windows/win32/api/d3d11/nf-d3d11-d3d11createdevice)
- [MinimalOffscreenD3D](https://github.com/carasuca/MinimalOffscreenD3D)
- [WARP - Wikipedia](https://en.wikipedia.org/wiki/Windows_Advanced_Rasterization_Platform)
- [cef-spout (Headless Chromium + Spout)](https://github.com/fg-uulm/cef-spout)
- [electron-spout (Offscreen Electron + Spout)](https://github.com/reitowo/electron-spout)
- [DirectX-Vulkan Interop (Evergine)](https://evergine.com/directx-vulkan-interop/)
- [Spout2 DX11 Offscreen Context Issue #18](https://github.com/leadedge/Spout2/issues/18)

---


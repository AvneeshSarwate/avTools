Got it. Here’s a concrete “how to” for **intercepting the swapchain drawable** on macOS so you can **publish the exact presented `MTLTexture` to Syphon** with **no CPU readback** and no ScreenCaptureKit.

This is the core fact you’re exploiting:

* `Deno.UnsafeWindowSurface` (cocoa) ultimately presents into an **`NSView*`** you provide. ([Deno][1])
* On macOS, the usual presentation path is **`CAMetalLayer` → `nextDrawable()` → drawable.texture (`MTLTexture`)**. `CAMetalLayer` maintains a pool of drawables. ([Apple Developer][2])
* If you control the view/layer, you can observe every drawable handed out.

---

## 0) Sanity check: which pointer does Deno want on macOS?

Deno’s docs show that for `"cocoa"` the **`displayHandle` is `NSView*`** (and `winHandle` is unused/“-”). ([Deno][1])
There’s also a Deno issue thread specifically about doc/behavior mismatches around which field needs the `NSView*`. ([GitHub][3])

So: make sure you’re passing the `NSView*` where Deno expects it in *your* Deno version.

---

## 1) Build a view that *forces* a hookable CAMetalLayer

### Goal

Make the `NSView*` you hand to Deno **layer-backed**, and ensure the backing layer is **your `CAMetalLayer` subclass** (not one wgpu swaps in later).

### Recommended pattern (robust)

Create a custom `NSView` subclass and override **`-makeBackingLayer`** to return your `InterceptingMetalLayer` (a `CAMetalLayer` subclass). This is more reliable than “set view.layer once” because if something toggles layer-backing or reconstructs layers, your override keeps winning.

Also consider intercepting/guarding `-setLayer:` (or reasserting in `viewDidMoveToWindow`) because some stacks will replace your layer after surface creation.

### Layer properties you’ll typically want to manage

These matter because you’re *going to publish this texture*:

* **`pixelFormat`**: match what wgpu configures (usually BGRA8).
* **`drawableSize`**: must track the view’s backing pixel size.
* **`framebufferOnly`**: default is often `true` (faster). But if any downstream step needs to *read/sample* the drawable texture, it must be `false`. Apple’s definition: `isFramebufferOnly` means “texture can only be used as a render target.” ([Apple Developer][4])
* **Drawable pool behavior**: `nextDrawable()` will wait and can return `nil` if all drawables are in use (Apple docs mention up to ~1 second wait). ([Apple Developer][5])
  There are knobs like `allowsNextDrawableTimeout` and `maximumDrawableCount` (pool size). ([Apple Developer][6])
  (These are your escape hatches for “I’m holding a drawable for Syphon too long.”)

---

## 2) Subclass CAMetalLayer and intercept `nextDrawable()`

### Minimal interception

In your `InterceptingMetalLayer`:

* Override `nextDrawable()`
* Call `super.nextDrawable()`
* If drawable is non-null:

  * increment a monotonically increasing `frame_id`
  * stash a reference to the drawable / texture for later

**Do not do any heavy work in `nextDrawable()`**. Keep it to “record and return”.

### The single biggest edge case: drawable lifetime vs pool exhaustion

If you retain the drawable (or anything that keeps it alive) for too long, you can starve the pool and `nextDrawable()` will block / return nil. Apple explicitly describes the drawable pool model for CAMetalLayer and the waiting behavior. ([Apple Developer][2])

**Practical consequence:** you must treat “holding drawables” like holding locks.

**Common mitigation:** allow **triple buffering** and never retain more than one extra drawable past present. Use `maximumDrawableCount` if available to give yourself headroom. ([Apple Developer][6])

---

## 3) Make Deno/WebGPU present normally, then call into Rust to publish

### Deno side

You render as usual into the surface texture. In Deno BYOW you also explicitly call `surface.present()` and `surface.resize()` when needed. ([Deno][1])

Your “publish moment” should be *after the GPU work that writes that frame is complete*. A simple (correct, but can add latency) strategy is:

1. submit WebGPU commands
2. `await device.queue.onSubmittedWorkDone()`
3. call `ffi_publish(frame_token_or_latest)`

### The “which frame am I publishing?” problem (and the best fix)

`nextDrawable()` happens when the swapchain acquires a drawable — **before** you render into it.

If you just “publish the latest seen drawable” after `onSubmittedWorkDone()`, you can get mismatches when:

* multiple frames are in flight
* `nextDrawable()` got called again already (triple buffering)
* resizing triggers extra acquisition

**Fix:** create a **frame token** that you explicitly latch from JS.

A simple scheme:

* In `nextDrawable()` you assign `frame_id` and stash `(frame_id → drawable)` in a tiny ring (2–3 entries).
* Expose a Rust FFI call: `syphon_latch_current_frame_id()` that returns the **most recently acquired `frame_id`**.
* In JS: call `latch_current_frame_id()` immediately after you call `getCurrentTexture()` (i.e. right after the acquire point), store the returned `frame_id`.
* Later (after GPU completion), call `publish(frame_id)`.

This is the main thing that makes the approach deterministic.

---

## 4) Publish to Syphon without holding the drawable hostage

There are two ways to do the publish step:

### A) Publish the drawable’s texture directly

If Syphon copies the texture “immediately enough” for your use, you can hand Syphon the drawable’s `MTLTexture` and then release the drawable right after the call.

This is the lowest overhead, but depends on Syphon’s internal behavior. (It’s a real framework and generally handles this, but you’ll be validating it anyway.)

### B) Safer: GPU-blit into *your own persistent texture*, then publish that

This is the “I refuse to ever stall the drawable pool” version, and it’s usually what people land on for robustness:

* From the intercepted drawable texture, create/use a persistent `MTLTexture` you own (same device, same pixel format/size).
* Create your own `MTLCommandQueue` from `drawable.texture.device`
* Encode a **blit copy** from drawable → persistent
* Commit, optionally add a completion handler
* Publish the persistent texture to Syphon
* Release the drawable ASAP

This adds **one GPU copy** (which you already said is acceptable), and makes drawable lifetime a non-issue.

---

## 5) Pixel-exact linear + alpha: what to configure

### Surface format choice (linear vs sRGB)

On the wgpu side, the formats that are guaranteed are `Bgra8Unorm` and `Bgra8UnormSrgb`. ([WGPU][7])

* If you want your published bytes to represent **linear values**, prefer **`Bgra8Unorm`** for the surface (or at least for the texture you ultimately publish).
* If you want the window to look “normal” on screen, **`Bgra8UnormSrgb`** is the usual choice, but then the stored values are sRGB-encoded.

(You can also decouple: present sRGB to screen, publish linear from an intermediate blit texture — but that would require publishing an offscreen WebGPU texture, which you *can’t* get without the runtime-op route. So interception typically implies “publish what you present”.)

### Alpha

You’ll get whatever alpha you render into that drawable texture. The compositor may treat the window as opaque, but the texture memory still contains alpha values.

Be explicit about whether your pipeline is **premultiplied** vs **straight** alpha, because Syphon clients will interpret what you give them. (If you need straight alpha but your output is premultiplied, you may need a small unpremultiply pass before publish — ideally on-GPU.)

---

## 6) Resizing / HiDPI / minimized / occluded: all the ugly-but-real cases

### Resize and scale-factor changes

You must keep **three sizes** aligned:

* winit window logical size
* NSView backing scale factor (Retina)
* CAMetalLayer `drawableSize` (pixels)

On the Deno side, call `UnsafeWindowSurface.resize(width, height)` when size changes. ([Deno][1])
On the layer side, update `drawableSize` to `width * scale`, `height * scale`.

Also: you’ll need to reallocate your persistent publish texture when size changes.

### When `nextDrawable()` returns nil

It can happen when drawables are exhausted; Apple docs describe the pool and the blocking/timeout behavior. ([Apple Developer][5])
Treat `nil` as “skip frame”, and make sure your JS side doesn’t deadlock waiting for a publish token that never arrived.

### “I stopped presenting and everything froze”

If for some reason you stop calling `present` consistently, you can wedge the drawable lifecycle and never get fresh drawables back. In BYOW land, make sure your “render frame” contract always ends in `present()` for the frames you acquired. ([Deno][1])

---

## 7) Threading constraints you should assume

* AppKit objects (NSView/NSWindow) are safest when mutated on the **main thread**.
* `nextDrawable()` may be called from whatever thread the renderer runs on; make your interception storage **lock-free or minimal-lock**, and never call into AppKit from inside `nextDrawable()`.

---

## 8) A minimal validation path (to prove feasibility fast)

1. Implement the layer/view override, and intercept `nextDrawable()`.
2. In your Rust FFI, expose `debug_latest_drawable_ptr()` and log whenever it changes.
3. In Deno, render a frame loop and confirm you see a new drawable each frame.
4. Add the “frame_id latch” and confirm the publish call always hits the expected frame_id under resize / high FPS.
5. Add Syphon publish (direct first, then blit-to-persistent if you see drawable starvation).

---

### The one-sentence summary of the hardest part

**Correlating “this WebGPU frame” ↔ “this drawable” while not holding drawables long enough to starve the CAMetalLayer pool** is the whole game. The token-latch + short drawable lifetime (or blit-to-persistent) is how you win it.

If you want, tell me which of these you prefer for initial validation:

* “direct publish the drawable texture” (simpler)
* “always blit to a persistent texture first” (more robust)

…and I’ll outline the cleanest minimal API surface between Deno ↔ your Rust FFI for that choice.

[1]: https://docs.deno.com/api/deno/~/Deno.UnsafeWindowSurface "Deno.UnsafeWindowSurface - Deno documentation"
[2]: https://developer.apple.com/documentation/quartzcore/cametallayer?utm_source=chatgpt.com "CAMetalLayer | Apple Developer Documentation"
[3]: https://github.com/denoland/deno/issues/30551?utm_source=chatgpt.com "WebGPU BYOW: documentation inconsistency: NSView should be window handle"
[4]: https://developer.apple.com/documentation/metal/mtltexture/isframebufferonly?language=objc&utm_source=chatgpt.com "framebufferOnly | Apple Developer Documentation"
[5]: https://developer.apple.com/documentation/quartzcore/cametallayer/nextdrawable%28%29?utm_source=chatgpt.com "nextDrawable() | Apple Developer Documentation"
[6]: https://developer.apple.com/documentation/quartzcore/cametallayer/allowsnextdrawabletimeout?utm_source=chatgpt.com "allowsNextDrawableTimeout"
[7]: https://wgpu.rs/doc/wgpu/type.SurfaceConfiguration.html?utm_source=chatgpt.com "SurfaceConfiguration in wgpu - Rust"

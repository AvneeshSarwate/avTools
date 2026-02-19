
This is a copy of a conversation between ChatGPT & Anonymous.

Report conversation
You said:
are there any good libraries for syphon (the macos GPU shared memory framework) with rust? i am using deno and webgpu to do creative coding, and want to be able to integrate with syphon 

ChatGPT said:
If you mean Syphon (the macOS texture-sharing framework) (not “syphon” the networking/metrics crate on crates.io), the short version is: there isn’t a widely-used, polished Rust crate that wraps Syphon.framework. People who do Syphon from Rust usually end up doing one of the “FFI / bindings” routes.

Here are the best practical options today, especially given you’re in Deno + WebGPU land.

What exists (and what doesn’t)
1) Official Syphon SDK (Objective-C / Metal / OpenGL)
Syphon itself is distributed as Syphon.framework and is designed for zero-copy GPU surface sharing via IOSurface, with OpenGL + Metal backends and interoperability between them. 

Syphon’s Metal server API includes methods that publish a region of an MTLTexture and copy the texture so you can safely modify it after the call returns (important for how you structure your render loop). 

2) Rust: no “go-to” Syphon crate
The crate named syphon on crates.io is unrelated (it’s a metrics processor/proxy). 

And the “Rust + wgpu → Syphon” question comes up with basically “no bindings exist” sentiment in the wild. 

3) A surprisingly useful bridge: Node bindings
There’s a project node-syphon that exposes Syphon to JS (OpenGL + Metal), including sending frames as Uint8Array, and even some IOSurface-handle workflows (notably Electron-related). 

Caveat: it’s GPL-3.0 licensed. 

And crucially for you: Deno 2 supports Node-API native addons if you use a local node_modules/ and pass --allow-ffi. 

Best ways to integrate Syphon with Deno + WebGPU
Path A — Easiest (but not zero-copy): GPU readback → publish pixels
How it works: WebGPU renders → copy texture to buffer → map/read to CPU → publish those bytes to a Syphon server (via Node bindings or your own dylib).

Pros: simplest; stays “mostly Deno”.
Cons: readback is expensive; 1080p60 can hurt.

How you’d wire it:

Use Deno’s npm support + Node-API addon (like node-syphon) 

Run with:

--node-modules-dir=auto (or config "nodeModulesDir": "auto")

--allow-ffi (required for Node-API addons / native FFI) 

Publish Uint8Array frames (node-syphon supports this pattern) 

If you try this: watch out for WebGPU’s bytesPerRow padding when copying textures to buffers—you’ll likely need to de-pad rows into a tight RGBA buffer before publishing.

Path B — Still Deno-driven, but more “Rust-y”: write a tiny Rust dylib + Deno FFI
Instead of relying on Node bindings, you can:

write a Rust cdylib that links Syphon.framework

expose a small C ABI (create_server, publish_rgba, drop_server)

call it from Deno using Deno.dlopen

Deno’s FFI (Deno.dlopen) is designed for calling dynamic libraries (C/C++/Rust), and it’s gated by --allow-ffi. 

This is basically Path A (still involves readback unless you do more work), but it gives you full control over:

deployment (where Syphon.framework lives)

licensing (vs GPL concerns)

performance tricks (triple-buffering CPU frames, etc.)

Path C — The “real” Syphon experience (zero-copy-ish): publish an MTLTexture / IOSurface
This is what you want for high-res/high-fps creative coding:

render/copy into an IOSurface-backed MTLTexture

publish that texture via Syphon’s Metal APIs 

optionally use Metal shared textures where appropriate (Apple provides APIs like makeSharedTexture) 

The catch: WebGPU (as a standard API) does not expose native Metal texture handles. So from pure Deno WebGPU, you typically can’t grab an id<MTLTexture> or IOSurface handle directly.

So to do this well, you usually:

move rendering into a native host (Rust wgpu/Metal), or

embed the Deno runtime inside a Rust app and let Rust own the GPU + Syphon side (Deno runs your creative-coding logic, Rust runs the renderer/publisher).

(For context, Deno’s WebGPU implementation is based on wgpu historically.) 

If you want to build Rust bindings, these are the pieces people use
Since Syphon is Objective-C:

objc2 is the modern Rust interop path for Apple frameworks. 

For Metal types, there’s objc2-metal. 

Then you write a thin set of Objective-C class/method declarations for the Syphon classes you need (e.g. the Metal server/client types), and link Syphon.framework.

This is work, but it tends to be cleaner long-term than older objc/cocoa glue, and it lines up with where the Rust-on-Apple ecosystem is headed. 

My practical recommendation (given Deno + WebGPU)
Try Path A first (readback → publish) to validate the creative workflow and toolchain quickly.

If GPL is OK and you want speed-to-first-frame, experiment with node-syphon. 

If you need permissive licensing / more control, move to Path B (your own Rust dylib + Deno.dlopen). 

If you need 1080p60+ without pain, plan on Path C (native-owned Metal texture / IOSurface). That likely means a Rust host that either:

embeds Deno for scripting, or

communicates with your Deno process over a fast IPC channel while Rust handles GPU + Syphon.

If you tell me your target resolution/fps and whether you need publish-only or also Syphon client (receive), I can outline a concrete architecture (and what you’d implement in Rust vs Deno) without hand-waving.




Sources

You said:
i want rendering to stay in deno/webgpu land, because i am using a library that can work between both deno and a browser - is there any way to keep this but also have zero readback syphon publish? i'm ok with a gpu copy if necessary (assuming that's much less constly than a readback?)

ChatGPT said:

You said:
don't worry about syphon in the browser, i just mean, it is a hard requirement to keep core rendering with the deno webgpu api 

ChatGPT said:
If you keep all rendering inside Deno’s standard WebGPU API, then no: there’s currently no supported way to publish a Syphon stream without a CPU readback, because Syphon ultimately needs a native GPU object (an MTLTexture / IOSurface) and WebGPU doesn’t expose (or accept) those handles.

That “missing piece” is a known gap in WebGPU: there’s no standard import/export of platform-shared textures (IOSurface on macOS, shared HANDLE on Windows, etc.), so people end up round-tripping through CPU memory. 

Even though some implementations internally use IOSurfaces on macOS (e.g., for canvas/surface textures), the API still doesn’t let you grab the IOSurfaceRef/MTLTexture out of it. 

Why “GPU copy is fine” still doesn’t solve it
A GPU→GPU blit/copy is indeed much cheaper than a GPU→CPU readback if you can keep the resource on-GPU. The blocker is: you need a bridge that turns your WebGPU GPUTexture into something Syphon can publish—and WebGPU doesn’t provide that bridge today. 

The closest thing that keeps Deno/WebGPU rendering and avoids readback: publish a capture of your WebGPU window
If your Deno app presents to a window (e.g. via Deno.UnsafeWindowSurface), you can keep your rendering exactly as-is and do a zero-readback capture path:

Render normally in Deno/WebGPU to a window surface (Deno.UnsafeWindowSurface). 

A tiny native helper (Rust/Obj-C/Swift) uses ScreenCaptureKit to capture that window. ScreenCaptureKit delivers frames as CMSampleBuffer. 

Those frames wrap a CVPixelBuffer backed by an IOSurface (GPU-backed). 

Create an MTLTexture from the IOSurface and publish via Syphon’s Metal server.

This avoids the WebGPU texture-handle problem entirely, because you’re grabbing the compositor’s output as an IOSurface. In practice it’s usually “GPU path” (copy/compose in the window server), not a CPU readback.

Tradeoffs to expect:

You’ll likely need Screen Recording permission (because you’re capturing a window).

Latency is typically at least a frame or two (you’re capturing post-composite).

You may get color-space conversion and you usually won’t get “true alpha” in the way Syphon creative-coding folks expect (depends on how you capture + pixel format).

But it scales way better than a WebGPU readback loop at 1080p/4K.

If you like Rust: there are Rust bindings/projects around ScreenCaptureKit that explicitly call out IOSurface / zero-copy GPU-backed access patterns. 

If you mean true Syphon-style sharing from your render target (not a window capture)
That requires some nonstandard/native hook to get an IOSurface/MTLTexture handle out of WebGPU (or to import one into WebGPU). Right now that means custom runtime work:

patch/extend Deno’s WebGPU to add an “export IOSurface/Metal texture handle” op, or

run your same “browser-compatible” WebGPU code inside a host that does expose native handles (nonstandard), similar to how some native/WebGPU embedding stacks discuss handle sharing. 

That’s feasible engineering-wise, but it’s not something you can do with just the public Deno WebGPU API today.

If you’re forced back to readback as a fallback
Deno’s std WebGPU docs even include guidance/examples for copying a texture to a buffer (with padding), which is the path you’d optimize (triple-buffer, async mapping, keep formats friendly like BGRA8 where possible). 

Bottom line
Direct “Syphon publish from Deno WebGPU texture with zero readback”: not possible with today’s standard APIs. 

Keep Deno/WebGPU rendering + avoid readback: do a ScreenCaptureKit window-capture → IOSurface → Syphon pipeline. 

If you want, I can sketch a concrete architecture for the helper process (how it discovers your window, captures at a target FPS, and publishes via Syphon Metal) that minimizes latency and avoids extra copies.




Sources

You said:
I don’t mind writing custom rust to move things around after I have my final frame

ChatGPT said:

You said:
No screen capture of a window

ChatGPT said:

You said:
I am using winit for windowing, so can’t there be some similar parallel deno rust extension I pass the texture to

ChatGPT said:
Yep — if you’re willing to write Rust, you can get to a zero-readback Syphon publish while keeping your rendering authored in Deno’s WebGPU API — but there’s a big caveat:

You can’t do it from “stock” deno via Deno.dlopen() / FFI, because Deno doesn’t expose any way to hand a GPUTexture’s underlying native handle to an external dylib.

What does work is building a custom Deno runtime (or embedding Deno) with a Rust op that can “reach behind” WebGPU and grab the native Metal texture, then pass it to Syphon.

Why this is viable:

Deno’s WebGPU implementation lives in a Rust “op crate” (deno_webgpu). 

Under the hood it’s backed by wgpu/wgpu_core, which has “raw HAL” access (Metal/Vulkan/etc) and can expose backend objects in wgpu_core builds. 

Syphon’s Metal server API takes an MTLTexture and copies the texture so it can be safely modified after the call returns (i.e., it’s a GPU-side copy, not a CPU readback). 

The shape of the solution you’re imagining (“parallel Rust extension”)
There are two practical variants.

Variant 1 (simplest): Publish an existing Deno GPUTexture
JS stays exactly WebGPU. You render your final frame into a normal GPUTexture. Then you call a custom op like:

// after you submit your render work
await device.queue.onSubmittedWorkDone(); // simplest correctness sync
DenoSyphon.publishTexture(outputTexture, width, height, /* optional */ flipped);
Rust op (inside custom runtime) does:

Receives the GPUTexture JS object (just like other WebGPU ops do).

Extracts the internal texture ID from the JS wrapper (Deno already does this for WebGPU calls).

Uses wgpu_core to get the underlying Metal texture (id<MTLTexture>) via HAL access (see as_hal on Device in wgpu_core). 

Calls Syphon publishFrameTexture… (or equivalent) to publish. Syphon will copy the texture. 

Cost profile: one GPU-side copy + whatever sync you choose. No CPU readback.

Important detail: you’ll almost certainly want the JS side to control sync initially (e.g., queue.onSubmittedWorkDone()), because otherwise you risk Syphon copying a texture that’s still being rendered into. That sync can cost you some latency; later you can optimize.

Variant 2 (best performance): Create a Syphon-ready texture in Rust, expose it as a GPUTexture to JS
This avoids even the extra blit/copy you might otherwise do, because your JS code renders directly into a texture whose underlying storage is suitable for Syphon (often IOSurface-backed).

This is the “dream” version, and it’s possible only because wgpu_core supports creating textures from native (HAL) textures (create_texture_from_hal), but it’s unsafe and you must match descriptors exactly. 

Flow:

Rust op creates an IOSurface + MTLTexture (your Syphon backing).

Rust wraps it into a wgpu_core texture using create_texture_from_hal. 

Rust returns a JS GPUTexture that points at that wrapped texture.

JS renders into it normally.

Rust op publishes that same underlying MTLTexture to Syphon.

Cost profile: basically “Syphon’s internal copy only” (and possibly you can tune around that). No readback, and potentially no extra blit.

What you cannot do (and why)
You can’t keep stock deno and just pass the texture to a dylib. FFI can’t receive a GPUTexture in any meaningful way because the native handle lives inside Deno’s Rust deno_webgpu resource graph, not in JS memory you can pointer-pass.

So the “parallel extension” has to be an op in the runtime, not an external library called from JS.

If you’re okay building a custom runtime, you do it by embedding deno_core/deno_runtime and registering your extension/ops. 

That’s the same general mechanism Deno uses internally.

Constraints you’ll hit in practice
These are solvable, but worth designing around:

Backend must be Metal. On macOS that’s typical, but your op should hard-reject if the backend isn’t Metal (or if Deno is using a “webgpu/custom backend” mode). wgpu_core HAL access returns None if the backend doesn’t match. 

Texture format & usage: Syphon consumers tend to expect common 8-bit formats (often BGRA). You’ll want to standardize your final output texture (e.g., BGRA8Unorm, non-MSAA, 2D). If your library renders to a different format, do a final GPU blit into the publish texture.

Synchronization: starting point:

JS: await queue.onSubmittedWorkDone() then publish.

Later: you can reduce stalls with double/triple buffering + publishing the previous frame while rendering the next.

Threading: keep Syphon publishing on a predictable thread (often main thread is easiest on macOS). Your op can marshal work if needed.

A realistic “minimal build” plan
If you want the shortest path to “it works”:

Fork/build a tiny custom runtime that includes WebGPU (via deno_webgpu) + your syphon op. 

Implement Variant 1 first (publish an existing GPUTexture).

Once it’s stable, move to Variant 2 if you want to eliminate your own final blit and/or control IOSurface details.

If you tell me which Deno windowing path you’re on (e.g., Deno.UnsafeWindowSurface vs something else) and what your final texture format is (bgra8unorm? rgba16float?), I can propose the most straightforward pipeline (Variant 1 vs 2), including where the one unavoidable copy should happen and how to structure buffering so you don’t stall the GPU every frame. Also: are you only publishing (server), or do you also need Syphon client ingest?




Sources

You said:
Hmm, this feels a bit off, or at least that you’re missing something. I created an FFI lib with deno and winit - if I am able to pass a surface to winit with the deno unsafesurface api, why can’t I do something similar for a different ffi lib? Winit is using native apple windowing, so wouldn’t that be bridging the gap between WebGPU texture access and Apple native api, or am I missing something 

ChatGPT said:
You’re not crazy — the thing you’re “missing” is that a window handle and a GPU texture live on totally different sides of the abstraction boundary.

Why UnsafeWindowSurface works (and why that doesn’t generalize)
Deno.UnsafeWindowSurface is a very specific escape hatch: you give Deno raw OS window/display handles (on macOS, an NSView*) and the Deno runtime creates a presentable WebGPU surface from them. 

That works because:

A window handle (NSView*, HWND, etc.) is a stable OS object whose meaning is well-defined to the OS windowing system (this is exactly what “raw-window-handle” style interop is about). 

Deno’s runtime is the one that owns the WebGPU implementation, so it can take that window handle and wire it into its internal wgpu surface.

But a WebGPU GPUTexture is not an OS handle. It’s an opaque, API-level object. JS doesn’t get (and can’t portably get) the underlying id<MTLTexture> / IOSurfaceRef.

So even if you have an FFI library that created the window via winit and you pass the NSView* into UnsafeWindowSurface, you still have this situation:

Your Rust dylib can talk to Cocoa (windowing) ✅

Deno WebGPU can render to a GPUTexture ✅

But there is no API that turns that GPUTexture into a native MTLTexture pointer you can pass to your dylib ❌

Why WebGPU makes this hard on purpose
WebGPU currently has no standard import/export path for platform shared GPU textures (like IOSurface on macOS). That gap is exactly why people end up CPU round-tripping today. 

Even if Deno’s backend on macOS internally uses Metal objects, WebGPU intentionally doesn’t expose them, both for portability and because “here’s a raw driver object” is a huge footgun (lifetime, synchronization, device loss, security/sandboxing, etc.).

“But winit is native, shouldn’t that bridge it?”
It bridges windowing, not resource ownership.

winit gives you a native window/view handle. Deno uses that to create a surface. But the swapchain / drawable textures and any offscreen textures you create are still owned/managed inside Deno’s WebGPU stack. You can’t “reach in” from a separate dylib unless the runtime explicitly provides a hook.

What would make your idea work
To do “the same thing as UnsafeWindowSurface, but for textures”, you need a privileged hook inside the Deno WebGPU runtime, not generic FFI.

Concretely: a custom Deno extension/op that takes a JS GPUTexture, looks up the internal texture resource, and (on Metal) extracts the underlying MTLTexture via wgpu_core’s HAL access. The wgpu API literally has an unsafe escape hatch for this (Texture::as_hal), but it’s available only in the right build context (wgpu_core). 

This is the same general technique people use in native Rust stacks to interop with Metal. 

Then that op calls Syphon’s Metal server to publish. (Syphon will do a GPU copy internally.)

Key point
That op must live inside the same process and the same WebGPU instance/device that created the texture. A separate dylib invoked via Deno.dlopen() does not have access to Deno’s internal resource IDs / device state, and JS can’t hand it a meaningful native texture handle.

So what are your options (given your constraints)?
Given “rendering stays in Deno WebGPU” and “no screen capture”, your zero-readback options are basically:

Custom Deno runtime / extension op (recommended)

JS renders to a normal GPUTexture

JS calls publish(texture) (an op)

op uses as_hal to get MTLTexture and hands it to Syphon

Even better: create an IOSurface-backed Metal texture in Rust, wrap it as a WebGPU texture, render into it from JS
This is the “render directly into the Syphon-friendly texture” approach — but it still requires runtime integration because WebGPU has no standard “import this IOSurface/MTLTexture as a GPUTexture”.

Either way, the missing piece is not winit — it’s a Deno WebGPU extension point for textures, analogous to UnsafeWindowSurface but for GPU resources.

If you want, I can outline a very concrete design for the extension API (what the JS call looks like, what the Rust op does, and the minimal synchronization strategy so Syphon never copies an in-flight texture) — keeping it as close as possible to “drop-in after final frame.”




Sources

You said:
Ok so tell me more about the Apple screen/window record api then - I guess if syphon is platform specific anyway and the screen record API is performant, I am ok with that approach 

ChatGPT said:
Cool — the “Apple screen/window record API” you want is ScreenCaptureKit. It’s designed specifically for high-performance capture of a display, an app, or a single window, and it delivers frames as CMSampleBuffer objects (so you can stay on-GPU via IOSurface/Metal instead of ever doing a WebGPU readback). 

Below is the mental model + the exact pipeline you’d use to go Deno/WebGPU → window → ScreenCaptureKit → Metal texture → Syphon.

What ScreenCaptureKit actually gives you
The building blocks
ScreenCaptureKit is centered around:

SCShareableContent: enumerate what can be captured (displays, apps, windows). 

SCContentFilter: define what you capture (e.g., “this one window”). 

SCStreamConfiguration: define how you capture (resolution, frame rate, pixel format, etc.). 

SCStream: produces frames (video sample buffers; audio optional). 

ScreenCaptureKit was introduced in macOS 12.3. 

Privacy/permissions
The first time you run a capture, macOS prompts for Screen Recording permission, and in many cases you need to restart the app after granting it. 

Users manage it in System Settings → Privacy & Security → Screen & System Audio Recording. 

The “window capture” path (what you want)
Selecting your winit window
ScreenCaptureKit exposes windows as SCWindow objects with a stable windowID property. 

So your helper does roughly:

SCShareableContent.getShareableContent...

Find the SCWindow that corresponds to your app’s window (match by windowID, app, title, etc.).

Build a filter that captures only that window.

Apple explicitly calls out that single-window capture is a first-class use case, and discusses expected behavior when the window is resized, occluded, moved off-screen, or minimized (important for creative coding / performance assumptions). 

Practical note: if the window is minimized, some apps stop updating their window contents, so “capture keeps animating even when minimized” is not something you can rely on universally. That’s not ScreenCaptureKit being slow; it’s the source not producing new pixels.

Configuring performance (fps + resolution)
The biggest knobs you’ll use:

Frame rate: set minimumFrameInterval (e.g. 1/60 for 60 fps). 

Resolution: set config width/height; also be mindful of Retina scaling (you may need to request capture at the window’s backing pixel size, not logical points). Apple’s sample and community notes show this is a common “why is it blurry/not-retina?” gotcha. 

Pixel format / color space: ScreenCaptureKit lets you choose these (WWDC explicitly calls this out), and you typically want a straightforward 8-bit format like BGRA for interoperability. 

Getting frames onto the GPU (no CPU copies)
ScreenCaptureKit delivers video frames as CMSampleBuffer. Inside that buffer is usually a CVPixelBuffer backed by an IOSurface.

To turn that into a Metal texture efficiently, the canonical route is:

Create a CVMetalTextureCache

For each frame, call CVMetalTextureCacheCreateTextureFromImage

That gives you a CVMetalTexture with a live id<MTLTexture> behind it 

That’s the key “no readback” bridge: IOSurface/CVPixelBuffer → MTLTexture stays in the GPU pipeline.

Publishing to Syphon (GPU copy, not readback)
Once you have an id<MTLTexture>, you publish via Syphon’s Metal server API. The Syphon Metal server methods are designed around taking a Metal texture and publishing frames in real time. 

Syphon may internally copy for safety/async reasons (that’s fine — it’s still GPU-side and usually dramatically cheaper than mapping a WebGPU buffer to CPU).

How this fits your Deno/WebGPU setup
Architecture that works well
Process A (your app): Deno + WebGPU renders normally into your winit window (no changes to your creative coding).

Process B (helper): native (Rust/Swift/ObjC) uses ScreenCaptureKit to capture only that window, converts frames to MTLTexture, and publishes to Syphon.

This avoids all the “how do I extract a native texture handle from WebGPU” stuff, because you never touch WebGPU textures at all — you capture the compositor output for your window through an API built for exactly that.

Why this can still be “performant”
ScreenCaptureKit is explicitly positioned by Apple as a high-performance capture framework, capable of native resolution and frame rate with performance in mind. 

And the IOSurface → Metal texture path avoids CPU frame copies. 

Rust angle (since you said you’re ok writing custom Rust)
You have two realistic options:

Use a Rust crate that binds ScreenCaptureKit (fastest path). The screencapturekit crate explicitly targets macOS 12.3+ and “high performance / low overhead.” 

Roll your own via objc2/manual bindings (more work, more control).

Either way, your “hot loop” is:

receive CMSampleBuffer

get CVPixelBuffer

CVMetalTextureCacheCreateTextureFromImage

SyphonMetalServer.publish…(mtlTexture)

Two practical questions that affect the exact setup
You don’t need to answer now, but these change implementation details a lot:

Do you need alpha in the Syphon stream, or is opaque fine? (window capture often ends up effectively opaque/post-composited)

Is it okay if the capture is “what’s on screen” for that window (including scaling/color management), or do you need pixel-exact linear output?

If you tell me those, I can recommend the right SCStreamConfiguration defaults (fps, resolution/backing scale, pixel format) and the simplest way to locate your winit window reliably via SCShareableContent.windows + windowID.





Sources

You said:
First, tell me more about permissions - in my set up I have a deno kernel with rust FFI and WebGPU to allow for livecoding graphics - will I need to see a permission and restart every time? Or is permission scoped to the built dylib or something so that it only needs to happen once? 

ChatGPT said:
On macOS, ScreenCaptureKit permissions are not scoped to a dylib. They’re scoped to the process (the “app”) that’s doing the capture, as tracked by macOS’s privacy system (TCC). So in your setup, the permission will belong to whatever executable actually calls ScreenCaptureKit — e.g. your deno process (or sometimes the parent app that launched it).

What you should expect in practice
1) You’ll usually see the prompt only once
The first time ScreenCaptureKit starts capture, macOS prompts for Screen Recording permission. Apple’s own docs for ScreenCaptureKit sample code explicitly say: after granting permission you need to restart the app to enable capture. 

After that, it should stay granted until you revoke/reset it.

2) Yes, you generally must restart — but not “every time”
The “restart” requirement is really “permission changes only apply after the capturing process quits and relaunches.” That’s why users commonly have to quit/reopen after enabling Screen Recording. 

So for your livecoding loop:

You won’t restart on every run/frame

You may have to restart once right after the user grants permission (or if they toggle it off/on)

3) The dylib isn’t what macOS grants permission to
Permissions are tracked for the “client” (bundle ID or executable path / code identity). A dylib loaded into a process doesn’t get its own TCC entry — it inherits whatever the host process has. This is why dev setups can feel weird: the permission may appear tied to the host app rather than your helper binary. 

4) In dev, the permission might attach to Terminal / VS Code / your IDE
This one bites people a lot: if you run a plain executable from Terminal/VS Code, macOS may show the parent app in the Screen Recording list instead of the child executable. Apple dev forums have reports exactly like this. 

The Rust screencapturekit crate docs also call out that during development you may need to grant permission to Terminal/IDE. 

So if your “Deno kernel” is launched by:

Terminal → you may end up granting Terminal

VS Code → you may end up granting VS Code

JupyterLab/Desktop wrapper → you may end up granting that wrapper

5) Why some people get re-prompted “all the time”
Two common causes:

You keep running different identities (different paths/copies/build outputs) so TCC treats it as a different client.

You have multiple copies of the “same” app/binary floating around and macOS is granting one while you’re running another (very common with dev builds). (This is widely reported behavior in practice; you’ll see advice like “delete the duplicate, remove/re-add permission, then restart.”) 

Best practice for your architecture
If you want this to be stable and “prompt once”:

Make a tiny helper .app (or bundle your whole livecoding tool as an app) that hosts the ScreenCaptureKit capture + Syphon publish.

Give it a stable bundle ID/signing identity.

Have your Deno side talk to it over IPC (socket/UDS/etc).

That way:

The permission is clearly granted to that helper app

It shows up cleanly in System Settings

You avoid the “Terminal/IDE owns the permission” weirdness 

One more option (if you’re okay with user interaction each session)
On macOS 14+, there’s a system content-sharing picker (SCContentSharingPicker) model where the user explicitly picks what to share; reports from browser teams indicate it can work without the broad Screen Recording permission in some cases — but it means the user is in the loop each time. 

If you tell me how your Deno kernel is launched (Terminal? VS Code? a bundled app?) and what macOS version you’re targeting, I can tell you exactly which “thing” will appear in the Screen Recording permission list and how to make it stable for livecoding.





Sources

You said:
I want alpha and pixel exact linear output in my screen capture if possible (basically, replicating syphon right) 

ChatGPT said:
If you want Syphon-like “real RGBA, linear, pixel-exact”, ScreenCaptureKit can get you close in performance (no CPU readback), but it doesn’t naturally give you Syphon-style alpha or a “raw render target” the way Syphon does.

Why ScreenCaptureKit won’t “replicate Syphon right” (especially for alpha)
Syphon shares your app’s GPU texture (pre-composite), and Syphon explicitly supports alpha. 

ScreenCaptureKit is a screen/window capture API: it captures what the system is presenting/producing for sharing. In multi-window cases it even talks in terms of composing windows over a background color (default black, configurable), rather than emitting transparency. 

So, in practice:

The captured frames are usually fully opaque (alpha = 1 everywhere) even if the pixel format is BGRA.

Any “transparency” you might see tends to be things like window shadows/rounded corners behavior — not “the alpha your WebGPU pipeline wrote.”

Pixel-exact + linear: what you can and can’t control
ScreenCaptureKit does let you request:

Exact output dimensions (and avoid scaling),

Pixel format (BGRA/YUV, etc),

Color space / color matrix (and it can do conversion in hardware). 

But “pixel-exact linear” is hard to guarantee because you’re going through a capture/composition path that can apply:

color management / conversion (by design), 

scaling if you don’t match backing pixel size (Retina),

possibly HDR/SDR policy depending on configuration/OS.

So you can ask for “linear-ish” output by choosing a suitable output colorspace, but it still won’t be the same as grabbing your render target texture directly.

The good news: you can keep it GPU-only and publish to Syphon efficiently
ScreenCaptureKit’s frames come as CMSampleBuffer backed by an IOSurface (GPU memory–backed), which is exactly what you want for avoiding readback. 

From there, the standard high-perf bridge is:

Extract CVPixelBuffer from the CMSampleBuffer

Use CVMetalTextureCacheCreateTextureFromImage to create a live-bound Metal texture (MTLTexture) without CPU copies 

Publish that MTLTexture to Syphon; Syphon’s Metal server API copies the texture so you can safely modify it after the call returns. 

This part is solid and fast.

If you truly need alpha: two workable approaches
Option A (best “Syphon-like” result): Don’t use capture for alpha
If “real alpha” is non-negotiable, ScreenCaptureKit is the wrong source. The only reliable way is still the earlier idea: publish the WebGPU output texture (or an IOSurface-backed texture) via a Deno runtime op / custom embedding (so you’re sharing the real render target). ScreenCaptureKit can’t promise your alpha survives because it’s not capturing “your texture,” it’s capturing a composed image. 

Option B (hacky but practical): reconstruct alpha from two captures
If you can tolerate a trick and your receiver can reconstruct:

Render the same scene twice:

once over black

once over white

Capture both (either two windows, or alternating frames), then reconstruct straight alpha per pixel (in linear space):

Let Cb = rgb * a (render over black)

Let Cw = rgb * a + (1 - a) (render over white)

Then:

a = 1 - (Cw - Cb)

rgb = Cb / max(a, ε)

This can get you very convincing alpha, but:

it halves effective FPS if you alternate frames,

you must do the math in linear (convert from sRGB first if needed),

it’s still “post-capture,” so it won’t be truly pixel-identical to your render target.

Concrete “minimize distortion” capture settings
To get as close as possible to pixel-exact:

Use desktop-independent window capture and match the backing pixel size via pointPixelScale (Chromium does width/height = size * pointPixelScale to avoid scaling blur). 

Set capture resolution to “best”/native where available. 

Choose a sane pixel format like 32BGRA for simplicity. 

Pin output colorSpaceName (e.g., sRGB) so you control conversions as much as the API allows. 

Keep queueDepth low enough to avoid latency (Apple explicitly warns larger surface pools can increase latency if your app holds frames too long). 

Bottom line
Performance: ScreenCaptureKit → IOSurface → Metal texture → Syphon is a great GPU-only pipeline. 

Alpha + linear pixel-exact: ScreenCaptureKit generally won’t give you Syphon-style “true RGBA” because it’s not exporting your render target. 

If alpha is mandatory, either publish the real GPU texture (runtime op route) or use the two-captures alpha reconstruction trick.

If you tell me whether you can accept two windows (one black bg, one white bg) vs alternating frames, I’ll outline the cleanest architecture for the helper + reconstruction (and how to keep it low-latency).





Sources

You said:
How expensive is CPU read back? Is there any way to make it more efficient? I really just want the actual texture data to send over syphon (or spout on windows) - is there no hack about getting a gpu to gpu copy of the data in some other way? 

ChatGPT said:
CPU readback is expensive for two separate reasons:

Bandwidth (how many bytes you’re pulling over to CPU-visible memory)

Synchronization (the painful part): you often end up forcing the GPU to finish work so the CPU can see the result.

How expensive are we talking?
Just raw bytes (RGBA8):

1080p (1920×1080) = 1920×1080×4 = 8,294,400 bytes ≈ 7.9 MiB/frame
At 60 fps: ~475 MiB/s of readback traffic.

4K (3840×2160) = 33,177,600 bytes ≈ 31.6 MiB/frame
At 60 fps: ~1.85 GiB/s.

That can be “possible” on high-bandwidth systems (especially unified-memory Macs), but the sync/latency is usually what kills smoothness: if you await mapAsync() and then immediately read every frame, you’re effectively saying “CPU, wait until GPU is done.”

mapAsync() explicitly only resolves when the buffer is safe for CPU access (i.e., after the GPU is finished with it). 

Making WebGPU readback as efficient as it can be
You can’t make readback “free”, but you can make it much less disruptive:

1) Pipeline it (don’t block the frame)
Instead of reading this frame’s pixels immediately, do:

Frame N: submit copy into staging buffer N

Frame N+2: map/read staging buffer N (when it’s ready)

This turns a stall into added latency (1–3 frames), which is usually fine for Syphon/Spout output.

2) Use a ring of staging buffers (2–4 buffers)
Create GPUBufferUsage.MAP_READ | COPY_DST buffers once, reuse forever. This is the standard “staging buffer” flow: copy into a CPU-mappable buffer, then mapAsync() and read. 

3) Keep format cheap
Use 8-bit formats for the final publish texture if at all possible (e.g., BGRA/RGBA 8-bit). Float formats double/4× your bandwidth.

4) Avoid extra CPU copies
You must deal with row padding: bytesPerRow must be a multiple of 256 for copyTextureToBuffer. 

That means your mapped buffer is usually strided. If your Syphon/Spout uploader can accept stride—great. If not, you’ll do a CPU “depad” copy, which adds overhead.

5) Copy a smaller texture (if you can)
If you can publish at 1280×720 or do a GPU downscale into the publish texture first, you cut bandwidth dramatically.

“Is there some hack to do GPU→GPU instead of readback?”
For Syphon (macOS) and Spout (Windows), the ideal path is exactly GPU→GPU sharing: Syphon wants a Metal/OpenGL texture; Spout wants a shared D3D texture/handle.

The problem is: WebGPU (and Deno’s WebGPU API) doesn’t expose platform texture handles (IOSurface/MTLTexture on macOS, shared DXGI/D3D handles on Windows), so an external Syphon/Spout publisher can’t “take” your WebGPU GPUTexture directly. This missing import/export capability is the reason people end up round-tripping through CPU memory. 

So with stock Deno WebGPU today:

GPU→GPU share to Syphon/Spout: not available

GPU copy into a mappable buffer + CPU read: available (but expensive)

What does enable true GPU→GPU sharing?
You need one of these:

Custom Deno runtime / native op that reaches into the WebGPU implementation and extracts the underlying Metal/D3D texture (nonstandard, but doable if you control the runtime).

Window/screen capture path (ScreenCaptureKit / Desktop Duplication) which is often GPU-backed — but it doesn’t give “true alpha like Syphon” reliably.

Also note: Syphon’s Metal publish call copies the texture internally (GPU-side) so you can safely reuse/modify after the call returns — which is exactly the kind of “GPU copy is okay” model you were hoping for. 

But you still need the MTLTexture handle, which WebGPU doesn’t give you.

What I’d do in your shoes
If you need this working soon: do pipelined readback with 3 staging buffers, and accept a couple frames of latency.

If you need “real Syphon/Spout-grade” (4K60, alpha, low-latency): invest in the custom runtime op route (so you can hand Syphon/Spout a real native texture).

If you tell me your target resolution + fps + format (RGBA8 vs float) and whether you can tolerate 2–3 frames of latency, I’ll sketch the exact staging-buffer ring pattern in Deno/WebGPU (including padding/stride handling) that minimizes stalls.





Sources

You said:
I still don’t understand why I can’t create some kind of “fake window” library that works with unsafewindowhandle and then use that - the window must eventually be passed the data right? 

ChatGPT said:
Your intuition is pointing at the right seam (the window handle), but the thing you’re expecting (“the window must eventually be passed the pixels”) is not how GPU presentation works on macOS.

What UnsafeWindowSurface actually buys you
Deno.UnsafeWindowSurface is explicitly: “Creates a presentable WebGPU surface from given window and display handles.” On macOS the handle is an NSView*. 

That’s a presentation endpoint. It’s not a bidirectional bridge that lets you pull textures back out.

Why the window is not “passed the data”
On Metal, presenting is built around CAMetalLayer drawables:

A CAMetalLayer maintains an internal pool of drawables/textures. 

Each frame, the renderer calls nextDrawable() to get a CAMetalDrawable, and that drawable has a texture (an MTLTexture) that you render into. 

You don’t “send pixels to the window.” You submit GPU commands that render into a GPU texture owned by the layer, then schedule a present. The pixels never exist as a CPU buffer unless you explicitly read them back.

So the OS/window system doesn’t receive a blob of texture data that you could intercept. It receives a presented drawable (conceptually: “here’s the GPU image to display”), and that object stays inside the graphics stack.

Why a “fake window” doesn’t solve it
You can create an NSView* that isn’t onscreen (or a tiny/hidden one) and hand it to UnsafeWindowSurface. Deno/wgpu will still create a surface and render/present into a layer-backed drawable.

But you still don’t get the key missing piece: a way to obtain the underlying MTLTexture from the WebGPU surface. WebGPU (and Deno’s API) intentionally keeps GPUTexture opaque; it doesn’t expose the native MTLTexture / IOSurface handle.

So a “fake window” changes where WebGPU presents, but not who owns the drawable/texture or whether you can access it.

The closest “hack” that matches what you’re imagining
There is a hacky approach that uses the window seam:

In your Rust/winit-created NSView, install your own CAMetalLayer (or even a subclass) before Deno creates the surface.

Let wgpu use that layer for presentation.

Intercept drawable acquisition by overriding/forwarding nextDrawable() and record the returned CAMetalDrawable.texture so your native code can publish it to Syphon.

This works because the present path is “get drawable → render → present”, and nextDrawable() is the choke point. Apple’s docs explicitly describe the drawable pool and that nextDrawable() pulls from it. 

But: this is brittle and easy to break:

nextDrawable() participates in throttling and can block/timeout when drawables are exhausted; you can’t safely call it from two places. 

wgpu may replace/configure the view’s layer depending on how the surface is created and updated.

The drawable texture is transient (from a pool). If you want to publish safely, you often end up doing a GPU blit into your own persistent texture anyway.

If you do manage to get an id<MTLTexture>, Syphon’s Metal server API is happy: it explicitly says the texture is copied and can be safely modified once the call returns. 

So yes: the window seam can be used—but only if you’re effectively injecting yourself into the Metal drawable acquisition path, not by “pretending the window is a texture.”

If you want “the real thing” (Syphon/Spout-grade) reliably
The robust versions are:

Custom Deno runtime/op that can access the native texture handle (cleaner, less hacky), or

CPU readback with pipelining (works everywhere, but expensive), or

Screen/window capture (GPU-ish, but not “true alpha/linear render target”).

If you want, I can outline the CAMetalLayer interception approach in more concrete steps (what to set on the NSView/layer, where to grab the MTLTexture, and how to avoid drawable pool deadlocks).




Sources

You said:
I want the interception approach - none of the others meet performance and fidelity requirements. It doesn’t matter that it is tricky to get right, I just need to validate that it is technically possible, and I will handle the corner cases to make it work right

ChatGPT said:
Yes — intercepting the swapchain drawable via the CAMetalLayer / nextDrawable() path is technically possible, and it’s the closest thing to “Syphon-grade fidelity/perf” you can do without CPU readback or screen capture permissions.

The key observation is:

Deno’s UnsafeWindowSurface on macOS takes an NSView* handle. 

A Metal-presented view is typically backed by a CAMetalLayer (“render into a view”). 

CAMetalLayer hands out the presentable GPU images through nextDrawable(), from an internal pool. 

So if you can ensure the layer used for presentation is your layer (or you can hook it), you can observe the exact MTLTexture that WebGPU renders into for presentation — and then publish that texture to Syphon (GPU→GPU). Syphon’s Metal server explicitly supports publishing frames by passing an existing Metal texture. 

That’s the “proof of possibility”.

What the interception approach looks like
1) Force the surface to use your CAMetalLayer (or a hookable one)
You create the NSView yourself (you’re already doing this with winit/FFI), and you make it layer-backed with a custom CAMetalLayer subclass:

Either set view.wantsLayer = YES and view.layer = YourInterceptingMetalLayer.

Or override the view’s layer creation path (so if something toggles wantsLayer, it still instantiates your subclass).

This is standard AppKit practice: layer-backed NSView + CAMetalLayer. 

wgpu on macOS has historically been very “CAMetalLayer + NSView” oriented (you can see issues where missing/incorrect NSView/layer setup breaks it). 

2) Override nextDrawable() and capture the drawable/texture
In your CAMetalLayer subclass:

Override -nextDrawable

Call super.nextDrawable()

If it returns a drawable, grab:

the id<CAMetalDrawable> (keep a strong reference briefly)

and/or drawable.texture (id<MTLTexture>)

Store it somewhere thread-safe (latest_drawable, latest_texture, plus a monotonically increasing frame_id).

Why this works: nextDrawable() is literally the API point where the layer gives you “the texture you render/present this frame”. 

Important footgun you’ll handle: nextDrawable() can block up to ~1 second and return nil if the drawable pool is exhausted; Apple exposes knobs around this behavior (e.g. allowsNextDrawableTimeout). 

(You said you’ll handle corner cases — just flagging the one that surprises people most.)

3) Don’t publish inside nextDrawable() — publish when JS says the frame is ready
When nextDrawable() is called, the texture is not rendered yet. It’s just acquired.

So the clean coordination pattern is:

JS/WebGPU renders into the surface texture as normal.

At “end of frame”, JS waits for GPU completion (await queue.onSubmittedWorkDone()), then calls an FFI function like publish_latest_drawable().

That FFI function:

Reads your stored latest_drawable / latest_texture

Publishes it via Syphon’s Metal server (which takes an existing MTLTexture). 

This avoids needing access to wgpu’s internal Metal command buffer while still guaranteeing the pixels are finished before you publish.

4) Publishing to Syphon (GPU→GPU)
Syphon’s Metal API is specifically designed for this: publish frames by passing an existing Metal texture. 

The header also references an API shape involving publishFrameTexture:onCommandBuffer: (useful if you do end up with a Metal command buffer you can sequence on later). 

About your “alpha + pixel-exact linear” requirement
Alpha
If your surface texture format includes alpha (BGRA8 does), and your render pass writes alpha, then the acquired drawable’s MTLTexture contains alpha data — even if the window compositor ignores it for display.

“Linear”
This mostly comes down to what format your surface is configured with.

In wgpu land, the surface formats that are guaranteed are Bgra8Unorm and Bgra8UnormSrgb. 

And *UnormSrgb formats explicitly apply an sRGB transfer function (storage is sRGB encoded, shader math is linear). 

So if you truly want your Syphon output to be “linear”, you generally want the surface to be Bgra8Unorm (not sRGB), and then if you still care about the on-screen window looking correct you do your own output transform for display.

(That part is just color management reality; your interception will faithfully publish whatever the backbuffer actually contains.)

Why this meets your constraints
No CPU readback.

No screen/window capture permissions (you’re not using ScreenCaptureKit).

Rendering stays 100% in Deno/WebGPU; you’re only intercepting the presentation drawable at the Metal layer boundary.

The thing you publish is exactly “the final frame” that would be presented, i.e. Syphon-style fidelity.

If you want, I can sketch the minimal “moving parts” you’ll need (view/layer setup, how to expose publish_latest_drawable() to Deno, and the one-frame-in-flight discipline that avoids drawable pool deadlocks) — but the headline you asked for is: yes, this is technically possible, and it lines up exactly with how CAMetalLayer presentation is designed to work.




Sources

You said:
Yes give me a rundown how how to do this along with noting all of the tricky parts and edge cases to handle along the way 

ChatGPT said:
Got it. Here’s a concrete “how to” for intercepting the swapchain drawable on macOS so you can publish the exact presented MTLTexture to Syphon with no CPU readback and no ScreenCaptureKit.

This is the core fact you’re exploiting:

Deno.UnsafeWindowSurface (cocoa) ultimately presents into an NSView* you provide. 

On macOS, the usual presentation path is CAMetalLayer → nextDrawable() → drawable.texture (MTLTexture). CAMetalLayer maintains a pool of drawables. 

If you control the view/layer, you can observe every drawable handed out.

0) Sanity check: which pointer does Deno want on macOS?
Deno’s docs show that for "cocoa" the displayHandle is NSView* (and winHandle is unused/“-”). 

There’s also a Deno issue thread specifically about doc/behavior mismatches around which field needs the NSView*. 

So: make sure you’re passing the NSView* where Deno expects it in your Deno version.

1) Build a view that forces a hookable CAMetalLayer
Goal
Make the NSView* you hand to Deno layer-backed, and ensure the backing layer is your CAMetalLayer subclass (not one wgpu swaps in later).

Recommended pattern (robust)
Create a custom NSView subclass and override -makeBackingLayer to return your InterceptingMetalLayer (a CAMetalLayer subclass). This is more reliable than “set view.layer once” because if something toggles layer-backing or reconstructs layers, your override keeps winning.

Also consider intercepting/guarding -setLayer: (or reasserting in viewDidMoveToWindow) because some stacks will replace your layer after surface creation.

Layer properties you’ll typically want to manage
These matter because you’re going to publish this texture:

pixelFormat: match what wgpu configures (usually BGRA8).

drawableSize: must track the view’s backing pixel size.

framebufferOnly: default is often true (faster). But if any downstream step needs to read/sample the drawable texture, it must be false. Apple’s definition: isFramebufferOnly means “texture can only be used as a render target.” 

Drawable pool behavior: nextDrawable() will wait and can return nil if all drawables are in use (Apple docs mention up to ~1 second wait). 

There are knobs like allowsNextDrawableTimeout and maximumDrawableCount (pool size). 

(These are your escape hatches for “I’m holding a drawable for Syphon too long.”)

2) Subclass CAMetalLayer and intercept nextDrawable()
Minimal interception
In your InterceptingMetalLayer:

Override nextDrawable()

Call super.nextDrawable()

If drawable is non-null:

increment a monotonically increasing frame_id

stash a reference to the drawable / texture for later

Do not do any heavy work in nextDrawable(). Keep it to “record and return”.

The single biggest edge case: drawable lifetime vs pool exhaustion
If you retain the drawable (or anything that keeps it alive) for too long, you can starve the pool and nextDrawable() will block / return nil. Apple explicitly describes the drawable pool model for CAMetalLayer and the waiting behavior. 

Practical consequence: you must treat “holding drawables” like holding locks.

Common mitigation: allow triple buffering and never retain more than one extra drawable past present. Use maximumDrawableCount if available to give yourself headroom. 

3) Make Deno/WebGPU present normally, then call into Rust to publish
Deno side
You render as usual into the surface texture. In Deno BYOW you also explicitly call surface.present() and surface.resize() when needed. 

Your “publish moment” should be after the GPU work that writes that frame is complete. A simple (correct, but can add latency) strategy is:

submit WebGPU commands

await device.queue.onSubmittedWorkDone()

call ffi_publish(frame_token_or_latest)

The “which frame am I publishing?” problem (and the best fix)
nextDrawable() happens when the swapchain acquires a drawable — before you render into it.

If you just “publish the latest seen drawable” after onSubmittedWorkDone(), you can get mismatches when:

multiple frames are in flight

nextDrawable() got called again already (triple buffering)

resizing triggers extra acquisition

Fix: create a frame token that you explicitly latch from JS.

A simple scheme:

In nextDrawable() you assign frame_id and stash (frame_id → drawable) in a tiny ring (2–3 entries).

Expose a Rust FFI call: syphon_latch_current_frame_id() that returns the most recently acquired frame_id.

In JS: call latch_current_frame_id() immediately after you call getCurrentTexture() (i.e. right after the acquire point), store the returned frame_id.

Later (after GPU completion), call publish(frame_id).

This is the main thing that makes the approach deterministic.

4) Publish to Syphon without holding the drawable hostage
There are two ways to do the publish step:

A) Publish the drawable’s texture directly
If Syphon copies the texture “immediately enough” for your use, you can hand Syphon the drawable’s MTLTexture and then release the drawable right after the call.

This is the lowest overhead, but depends on Syphon’s internal behavior. (It’s a real framework and generally handles this, but you’ll be validating it anyway.)

B) Safer: GPU-blit into your own persistent texture, then publish that
This is the “I refuse to ever stall the drawable pool” version, and it’s usually what people land on for robustness:

From the intercepted drawable texture, create/use a persistent MTLTexture you own (same device, same pixel format/size).

Create your own MTLCommandQueue from drawable.texture.device

Encode a blit copy from drawable → persistent

Commit, optionally add a completion handler

Publish the persistent texture to Syphon

Release the drawable ASAP

This adds one GPU copy (which you already said is acceptable), and makes drawable lifetime a non-issue.

5) Pixel-exact linear + alpha: what to configure
Surface format choice (linear vs sRGB)
On the wgpu side, the formats that are guaranteed are Bgra8Unorm and Bgra8UnormSrgb. 

If you want your published bytes to represent linear values, prefer Bgra8Unorm for the surface (or at least for the texture you ultimately publish).

If you want the window to look “normal” on screen, Bgra8UnormSrgb is the usual choice, but then the stored values are sRGB-encoded.

(You can also decouple: present sRGB to screen, publish linear from an intermediate blit texture — but that would require publishing an offscreen WebGPU texture, which you can’t get without the runtime-op route. So interception typically implies “publish what you present”.)

Alpha
You’ll get whatever alpha you render into that drawable texture. The compositor may treat the window as opaque, but the texture memory still contains alpha values.

Be explicit about whether your pipeline is premultiplied vs straight alpha, because Syphon clients will interpret what you give them. (If you need straight alpha but your output is premultiplied, you may need a small unpremultiply pass before publish — ideally on-GPU.)

6) Resizing / HiDPI / minimized / occluded: all the ugly-but-real cases
Resize and scale-factor changes
You must keep three sizes aligned:

winit window logical size

NSView backing scale factor (Retina)

CAMetalLayer drawableSize (pixels)

On the Deno side, call UnsafeWindowSurface.resize(width, height) when size changes. 

On the layer side, update drawableSize to width * scale, height * scale.

Also: you’ll need to reallocate your persistent publish texture when size changes.

When nextDrawable() returns nil
It can happen when drawables are exhausted; Apple docs describe the pool and the blocking/timeout behavior. 

Treat nil as “skip frame”, and make sure your JS side doesn’t deadlock waiting for a publish token that never arrived.

“I stopped presenting and everything froze”
If for some reason you stop calling present consistently, you can wedge the drawable lifecycle and never get fresh drawables back. In BYOW land, make sure your “render frame” contract always ends in present() for the frames you acquired. 

7) Threading constraints you should assume
AppKit objects (NSView/NSWindow) are safest when mutated on the main thread.

nextDrawable() may be called from whatever thread the renderer runs on; make your interception storage lock-free or minimal-lock, and never call into AppKit from inside nextDrawable().

8) A minimal validation path (to prove feasibility fast)
Implement the layer/view override, and intercept nextDrawable().

In your Rust FFI, expose debug_latest_drawable_ptr() and log whenever it changes.

In Deno, render a frame loop and confirm you see a new drawable each frame.

Add the “frame_id latch” and confirm the publish call always hits the expected frame_id under resize / high FPS.

Add Syphon publish (direct first, then blit-to-persistent if you see drawable starvation).

The one-sentence summary of the hardest part
Correlating “this WebGPU frame” ↔ “this drawable” while not holding drawables long enough to starve the CAMetalLayer pool is the whole game. The token-latch + short drawable lifetime (or blit-to-persistent) is how you win it.

If you want, tell me which of these you prefer for initial validation:

“direct publish the drawable texture” (simpler)

“always blit to a persistent texture first” (more robust)

…and I’ll outline the cleanest minimal API surface between Deno ↔ your Rust FFI for that choice.




Sources

You said:
What is the general idea with drawables? I’m new to macOS and desktop app dev more generally 

ChatGPT said:
On macOS/Metal, a drawable is basically “the GPU image you’re allowed to draw into this frame that can be shown in a window.”

Think of it like the modern Metal version of the old OpenGL “back buffer,” except it’s handed to you as an object.

The mental model
A window doesn’t accept pixel data
In modern GPU pipelines you don’t “send pixels to the window.” Instead:

The window system owns a layer that can display GPU images.

That layer gives you a texture to render into.

You tell the system “present this texture when the GPU is done.”

So the “data path” is GPU-to-GPU the whole way unless you explicitly read back.

What a CAMetalDrawable is
A CAMetalDrawable is an object that contains (at minimum):

an MTLTexture (the actual GPU memory you render into)

bookkeeping for presentation timing / swapchain behavior

On AppKit, that drawable typically comes from a CAMetalLayer attached to your NSView.

Why there’s a pool of drawables
CAMetalLayer manages a small pool of these presentable textures (often 2–3). This is the “swapchain.”

Why a pool exists:

While the GPU is still rendering or the compositor is still using one texture, you need another texture to render the next frame into.

More textures ⇒ smoother, fewer stalls (but potentially more latency).

If you ask for a drawable and all of them are “in use,” nextDrawable() may block for a bit or return nil. That’s why “holding onto drawables” is dangerous: you can starve the pool.

The usual frame loop (Metal-native)
Here’s the classic lifecycle:

Acquire
drawable = metalLayer.nextDrawable()

Render
Encode commands that render into drawable.texture

Present
Tell the command buffer to present that drawable when rendering finishes

Commit
Submit the command buffer

Release
Let the drawable go out of scope so the layer can reuse it later

Tiny timeline diagram
CPU:  acquire D0  encode cmds  present D0  commit  (repeat)
GPU:        render into D0  -----> done -> compositor uses D0
Layer pool: D0 busy while GPU/compositor uses it; you render into D1/D2 meanwhile
How this maps to WebGPU (and why it matters for your intercept plan)
In WebGPU/wgpu land:

surface.getCurrentTexture() ≈ “acquire a drawable’s texture”

rendering into that texture ≈ “render into the drawable”

surface.present() ≈ “present this drawable and release it back to the pool”

So your interception idea works because there is a real Metal drawable underneath, and there’s a clear “acquire point” (nextDrawable) where that drawable appears.

The key “gotchas” beginners hit with drawables
1) Drawables are ephemeral
They’re not “the backbuffer forever.” Each frame you get a drawable, and later it gets recycled. Don’t store the texture and assume it stays valid indefinitely.

2) Holding a drawable can stall/freeze rendering
If you keep a strong reference to a drawable (or anything that prevents it from being released), you can exhaust the pool. Then nextDrawable() blocks/returns nil → frame loop stutters or stops.

3) Resizing changes everything
When the window resizes (or Retina scale changes), the layer’s drawableSize changes and the textures you get change size. Any “publish texture” you allocate needs to track that.

4) “Framebuffer-only” restrictions
Often the drawable texture is created with restrictions optimized for display (commonly called “framebuffer only”). That can limit how you’re allowed to use it (e.g., sampling from it). A straight “publish this texture” path may or may not be compatible depending on how Syphon consumes it, so a common robust pattern is: blit/copy drawable → your own texture → publish your own texture (still GPU-only).

5) Synchronization: “acquire” happens before rendering
When you intercept nextDrawable(), you’re seeing the drawable before WebGPU has rendered into it. That’s why you usually publish later, after the GPU work is complete (or you copy into your own texture as part of a command buffer).

Quick analogy
If you’ve done double-buffering in games:

“back buffer” = drawable texture

“swap buffers” = present

“double/triple buffering” = drawable pool size

“tearing / vsync” = compositor and present timing

If you want, I can also describe the three ways people safely use drawables when they need to “tap the final frame” (direct publish, blit-to-owned texture, or command-buffer-scheduled handoff) and how each affects latency and pool starvation risk.


You said:
Is this same general strategy viable for windows and the spout texture sharing library?

ChatGPT said:
Yes — the same “tap the thing that’s being presented” strategy is viable on Windows for Spout, but the “hook point” and the interop details differ.

On macOS you hook CAMetalLayer.nextDrawable() → you see the MTLTexture that will be presented.

On Windows the closest equivalent is the DXGI swapchain back buffers:

A swapchain owns a small ring of back buffers (“presentable textures”).

You can access the current back buffer with IDXGISwapChain::GetBuffer. 

With modern flip-model swapchains you often need IDXGISwapChain3::GetCurrentBackBufferIndex() to know which buffer is “current” at that moment. 

So conceptually it’s the same: intercept the acquire/present path, grab the back buffer texture, publish it.

The big practical difference: WebGPU/wgpu is usually D3D12; Spout sharing is D3D11
Spout texture sharing is fundamentally based on DirectX 11 shared textures (shared handles + keyed mutex sync). 

Meanwhile, on Windows, wgpu (and therefore Deno WebGPU) typically uses DirectX 12 as the backend (it’s been a long-term direction for wgpu on Windows). 

So your intercepted back buffer will commonly be an ID3D12Resource, but Spout wants (or shares as) an ID3D11Texture2D.

Good news: Spout explicitly supports a D3D12 workflow by using D3D11On12 — i.e. wrap a D3D12 device/queue with a D3D11 device and copy to/from a D3D11 shared texture. 

That means your Windows pipeline typically becomes:

Intercept swapchain / acquire current backbuffer

Get backbuffer as ID3D12Resource (or D3D11 texture if the app is D3D11)

Use D3D11On12 to copy into a Spout sender shared texture (D3D11)

Spout receiver opens the shared texture handle + syncs with a keyed mutex

What “interception” looks like on Windows
Unlike macOS (where you can subclass a layer), Windows usually means hooking:

How you obtain the swapchain pointer
If you don’t own swapchain creation (wgpu does), you typically hook something like:

DXGI swapchain creation (e.g. CreateSwapChainForHwnd), so when wgpu creates the swapchain you capture the returned IDXGISwapChain*, and/or

later, hook the swapchain vtable method Present.

Once you have IDXGISwapChain* you can:

Determine current back buffer index (flip model) using IDXGISwapChain3::GetCurrentBackBufferIndex(). 

Call IDXGISwapChain::GetBuffer(index, …) to get the back buffer. 

“Drawable pool” equivalent
Same idea as macOS drawables: don’t hold references to back buffers longer than necessary, or you’ll stall presentation / increase latency. Flip model rotates buffers; indices and “current” move. 

Spout-specific gotchas you’ll want to plan for
1) Synchronization: keyed mutex
Spout2 expects shared texture access to be synchronized (commonly via DXGI keyed mutex). 

This matters if you’re copying into a shared sender texture that another process reads.

2) Same GPU / adapter requirement
Shared textures generally need sender & receiver to be on the same adapter; trying to open on another GPU can fail. 

In practice, Spout users also note “texture sharing only works within a single GPU” and cross-GPU copying is slow/painful. 

3) Format expectations
Spout’s default/common format is BGRA8 (DXGI_FORMAT_B8G8R8A8_UNORM), but other formats can work depending on toolchain. 

If you care about “linear vs sRGB,” you’ll need to ensure the backbuffer / copy target format matches your intent (Spout itself will happily move bytes; the interpretation is on you/receivers).

4) Flip model indexing & timing
With flip-model swapchains, “buffer 0” isn’t always “the one you just rendered to.” Using GetCurrentBackBufferIndex() is the standard way to avoid subtle off-by-one frame issues. 

Bottom line
Is the strategy viable? Yes: on Windows the “drawable” you intercept is the DXGI swapchain backbuffer (via GetBuffer + current index). 

Can it feed Spout efficiently? Yes, but you’ll almost certainly do one GPU copy into a D3D11 shared Spout texture, typically via D3D11On12 if your renderer is D3D12 (which wgpu commonly is). 

Main engineering pain: getting hold of the swapchain/device/queue cleanly (hooking), and then nailing sync/adapter/format edge cases.

If you tell me whether you’re okay with “copy-to-owned-texture then publish” on Windows the same way we discussed for macOS (it’s usually the most robust), I can sketch the exact per-frame choreography (where to copy relative to Present, what to store, and how to avoid deadlocks/tearing across both platforms).




Sources

You said:
I would ideally like to publish a single rust package that users can install so that they can use the same basic code cross platform across Mac and windows similar to how touchdesigner has the single spout/syphon TOP. What would library setup look like for this? Is this even possible? Or is it better to just split them into separate packages because the spout/syphon end user apis are similar enough anyway? 

ChatGPT said:
Yes — you can ship a “single Rust package” that feels like TouchDesigner’s unified TOP at the API level, but internally you almost always want separate platform backends (Syphon vs Spout) with a small cross-platform façade on top.

The big reason: the publishing APIs are conceptually similar, but the way you obtain the GPU texture to publish is wildly different per OS (and often app/framework-specific).

What I’d ship (best of both worlds)
1) A top-level crate users depend on: frameshare (or whatever name)
This is what your users cargo add. It exposes a single, stable API:

Sender::new(name)

Sender::publish(frame) (or publish_latest() for your interception setup)

Optional receiver API if you want it later

Under the hood, it conditionally compiles the right backend.

Why this works well: users write the same Rust/Deno wrapper code, and Cargo picks Syphon on macOS / Spout on Windows at build time.

2) Two backend crates (kept private or public, your choice)
frameshare-syphon (macOS): wraps Syphon.framework’s Metal server API (Syphon’s own header literally describes publishing as “passing in an existing Metal texture”). 

frameshare-spout (Windows): wraps Spout’s SDK (Spout2 supports DirectX 9/11/12 + OpenGL textures and ships an SDK). 

You can keep them as modules inside one repo/crate, but separate crates (even inside one workspace) tends to make:

linking/build scripts saner

dependencies smaller per platform

release/CI easier

3) Optional “tap/intercept” crates (because this part is the messy one)
This is where your drawable/swapchain interception logic lives:

frameshare-tap-macos-cametal:

owns the NSView / custom CAMetalLayer

overrides nextDrawable()

hands the drawable’s MTLTexture to the Syphon backend

frameshare-tap-windows-dxgi:

gets access to the DXGI swapchain backbuffer (often via hook/interop)

copies to a Spout sender texture

Make these feature-gated because not every user wants invasive hooking or winit/wgpu assumptions.

“Is it even possible” to have one crate?
Yes. Rust makes this straightforward with cfg(target_os = "macos") / cfg(windows) + feature flags.

A very common pattern is a facade crate that does something like:

pub type Sender = syphon::Sender on macOS

pub type Sender = spout::Sender on Windows

…and keeps the method surface identical.

But should you split into separate packages anyway?
Split the implementation (backends) for sanity; don’t force users to think about it.

From the user’s perspective, it still feels like “one package” if you provide a single facade crate. That’s exactly how lots of cross-platform Rust ecosystems are structured.

What the public API should look like
To really deliver “same code cross-platform,” make your publish() input abstract:

On macOS: publish expects a Metal texture handle (id<MTLTexture>) because Syphon publishes from an existing Metal texture. 

On Windows: publish expects a D3D11/D3D12 handle or an internal copy path into the Spout sender (Spout2 supports DX9/11/12). 

Optional fallback: publish_rgba_bytes() for “it works everywhere but slower”.

So your crate can offer:

publish_native() (fast path)

publish_rgba() (portable fallback)

Then your tap/intercept modules produce the native frame for you.

Reality check: your “intercept the presented drawable” trick is not equally clean on Windows
On macOS, intercepting drawables via CAMetalLayer.nextDrawable() is something you can do inside your own NSView setup.

On Windows, the equivalent “drawable” is the swapchain backbuffer, but wgpu/Deno will usually create and own the swapchain internally. Getting that backbuffer typically requires either:

a hook/intercept at DXGI swapchain creation / Present, or

integrating deeper into the renderer stack than “here’s an HWND”.

So: feasible, but the Windows “tap” layer is usually more invasive than the macOS one.

That’s another reason to make the “tap” layer a separate optional feature/crate.

Licensing / redistribution notes (good news)
If you’re aiming for “install one package and it works”:

Spout2 is BSD-2-Clause. 

Syphon is published as “Simplified BSD” per the Syphon site. 

So bundling/wrapping is generally compatible with shipping a permissive Rust crate (still: include notices).

Also: don’t get tricked by the syphon crate on crates.io — it’s unrelated (metrics proxy), not Syphon.framework. 

Recommendation
Do one user-facing crate (frameshare) so people write one code path.

Do separate backend crates (or internal modules) for Syphon vs Spout.

Keep interception/tapping as optional add-ons because they’re app-architecture-specific and carry the most edge cases.

If you tell me which direction you want your users to integrate:

“I give you a window handle and you tap whatever WebGPU presents” (high magic), or

“I give you a native texture handle and you publish it” (lower magic, more controllable),

…I can suggest an API shape that stays stable while still letting you evolve the internals without breaking users.




Sources

You said:
You say the windows version is more invasive, but in what sense? This is all for a parallel pipeline to the actual visible window which would just be handled with winit - what would this disrupt? 

ChatGPT said:
“More invasive” on Windows doesn’t mean “it will mess with winit.” It means: there’s no clean, supported “subclass this one object and observe drawables” seam like CAMetalLayer on macOS, so to tap the presented texture you usually have to hook or patch lower-level DXGI/D3D plumbing that wgpu/Deno owns.

Why macOS is comparatively “clean”
On macOS you can do your trick because:

Deno’s surface is created from an NSView* (UnsafeWindowSurface). 

Presentation goes through a CAMetalLayer attached to that view, and that layer hands out presentable textures through nextDrawable() (a normal overridable Obj-C method). 

So you can “win” by owning the view and supplying a layer you control. That’s invasive architecturally, but it uses normal platform extension points.

Why Windows is “more invasive”
On Windows, the equivalent “drawable pool” is the DXGI swapchain back buffers:

You get them via IDXGISwapChain::GetBuffer(...). 

With modern flip-model swapchains you often need IDXGISwapChain3::GetCurrentBackBufferIndex() to know which buffer is current. 

The set/order of buffers is stable until ResizeBuffers/ResizeTarget, which you must also handle. 

But you can’t “subclass” a swapchain the way you can subclass a CAMetalLayer. A swapchain is a COM object created by DXGI inside wgpu/Deno. So if you don’t control swapchain creation, you’re left with two practical ways to intercept:

Patch / integrate with wgpu (cleanest technically, but you’re now maintaining a fork / custom runtime)
This is analogous to writing a Deno runtime op: you modify the renderer stack to hand you the backbuffer resource and sync/fences “properly.”

Hook DXGI at runtime (most common “no fork” approach, but intrusive)
You detour something like swapchain creation or Present, capture the IDXGISwapChain*, then call GetBuffer/copy each frame. This is “invasive” because it’s effectively process-wide API hooking: it can affect any swapchain in the process, and it’s sensitive to driver/runtime updates.

“But I’m doing this in a parallel pipeline… what would it disrupt?”
Even if your intent is parallel, the pixels you want are produced by the swapchain that’s actually being presented. If you tap the presented backbuffer, you’re necessarily inserting yourself into the same timing-critical path as the visible window.

The main ways it can disrupt the visible output are:

Present timing / stutter: if your tap does extra GPU work or introduces GPU/CPU synchronization at the wrong time, Present cadence suffers (dropped frames / jitter).

Resource lifetime / “drawable starvation” equivalent: if you accidentally hold references or block around buffer access, you can prevent reuse and stall presentation (same conceptual failure mode as holding CAMetalDrawable too long).

State & synchronization correctness: on D3D12 you must coordinate resource states and fences correctly; if you copy the backbuffer at the wrong point without proper barriers/fence ordering, you’ll get tearing, old frames, or undefined contents.

API interop overhead: Spout sharing is fundamentally D3D11 shared textures with synchronization (keyed mutex patterns are common), so if your renderer is D3D12 you often bridge via D3D11-on-12, which adds complexity and potential stalls if you force flushes. 

The extra Windows-specific wrinkle: Spout wants D3D11-style sharing
Most Spout sender/receiver ecosystems revolve around a shared D3D11 texture + keyed mutex sync. 

If Deno/wgpu is on D3D12, your “tap” usually becomes:

grab ID3D12Resource backbuffer (DXGI)

GPU-copy into a D3D11 shared texture (often via D3D11On12) 

signal keyed mutex appropriately 

Totally doable, but it’s more moving parts than “publish this MTLTexture.”

Bottom line
macOS interception can be done by controlling the NSView/CAMetalLayer boundary (a supported “customize this object” seam).

Windows interception usually means either integrating into wgpu or hooking DXGI/Present, because the swapchain is not designed to be user-subclassed and Deno doesn’t expose it. That’s what I mean by “more invasive.”

If you want, I can outline the least disruptive Windows variant (where you hook just enough to obtain the swapchain/backbuffer, then do an async GPU copy to a Spout sender texture without stalling Present) and list the exact edge cases (flip model index, resize, device loss, fullscreen, HDR colorspace).



Sources

Get smarter responses, upload files and images, and more.

Log in

Sign up for free


Attach

Search

Study

Create image

Voice

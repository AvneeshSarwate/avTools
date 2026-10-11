# avTools: Dawn, Syphon, and TouchDesigner port plan

Prepared 2026-10-11. Implementation handoff for a coding agent.

## Objective

Build a reusable native WebGPU integration for avTools in three stages:

1. Run the existing `P5GPU` renderer, including Rust-backed text, on upstream Dawn bindings in ordinary Node.js; add native window presentation.
2. Publish offscreen GPU textures to multiple Syphon channels without CPU readback, independently of preview windows.
3. Reuse the renderer and Dawn bindings inside a TouchDesigner custom C++ operator with embedded JavaScript, `setup()` / `draw()`, CHOP controls, TOP inputs, and TOP output.

Deliver each stage independently. Do not start with a simultaneous rewrite of the runtime, renderer, window system, and editor.

## User requirements and boundaries

- Users must not need a custom Node executable or separately installed custom runtime. The Node target uses standard supported Node.js and prebuilt native addons delivered through an npm package.
- A TouchDesigner plugin may bundle the JavaScript engine and native libraries it embeds. This is a plugin dependency, not a user-managed runtime executable.
- Reuse established GPU implementations and upstream WebGPU JavaScript bindings. Do not introduce `kmamal/gpu`, Electrobun's WebGPU adapter, or a new handwritten full WebGPU binding as a dependency.
- A pinned upstream Dawn checkout with a small maintained patch series is acceptable. Keep the patch surface explicit and reviewable.
- Preserve the existing Rust text engine and renderer behavior. Adapt host interfaces rather than rewriting shaping, layout, or glyph rasterization.
- Build first for macOS Apple Silicon, given the existing Metal/Syphon integration. Record the actual machine, OS, Node version, and GPU used. Other targets need their own binaries and validation; do not claim support from compilation alone.
- Stage 2 requires no CPU readback in normal Syphon publication. Stage 3 must report CPU transfers honestly where the TouchDesigner API requires them.
- Keep the working Deno implementation available as a behavioral reference until replacement paths meet their acceptance checks.

## Evidence and uncertainties

The preceding investigation inspected source and documentation; it did not compile these integrations or benchmark them. Recheck the current checkout and pin dependency revisions before implementing.

| Finding from source inspection | Implementation consequence |
| --- | --- |
| `P5GPU` accepts a `GPUDevice`, owns an offscreen `outputTexture`, and exposes `beginFrame()` / `endFrame()` | Reuse it in both hosts without requiring a window |
| `endFrame()` submits commands and returns its texture | Output bridges must respect that submission and its completion ordering |
| `loadFont()` uses `Deno.readFile`; the text wrapper uses Deno FFI | Inject asset loading and replace the native-call adapter |
| `P5GPU.image()` is currently unimplemented | TOP image drawing needs a renderer feature, not just a TD bridge |
| `loadPixels()` explicitly performs readback | Keep this opt-in; do not use it as the Syphon transport |
| The Rust text engine exports C ABI functions and returns layout data and glyph masks | Reuse it from C++ and Node; it does not depend on Deno or a GPU backend |
| Dawn's Node binding wraps native textures, but its normal public exports lack the needed surface interop | Extend the addon to manage surfaces and wrap acquired textures |
| Dawn has a recent standalone V8 CTS runner and a lightweight `napi_v8` layer | Investigate reuse for embedding; it is not a proven TD embedding SDK |
| Existing headless Syphon reads GPU pixels to CPU and uploads them into another Metal texture | Replace the publication boundary with native texture publication |
| Inspected TD TOP headers expose CPU-buffer and CUDA-array modes, not direct Metal/Vulkan texture exchange | A single custom TOP on macOS must initially use CPU transfer, unless newer matching SDK headers prove another supported route |

## Repository entry points

Inspect repository instructions and these files before editing. Paths are relative to `AvneeshSarwate/avTools`; locate renamed files rather than assuming this list remains exact.

- `docs/livecode/`
- `packages/livecode-engine/`
- `apps/deno-notebooks/tools/p5gpu.ts`
- `apps/deno-notebooks/tools/p5gpu_text/ffi.ts`
- `apps/deno-notebooks/tools/p5gpu_text/atlas.ts`
- `apps/deno-notebooks/native/text_engine/Cargo.toml` and `src/lib.rs`
- `apps/deno-notebooks/window/window.ts` and `window/ffi.ts`
- `apps/deno-notebooks/native/deno_window/src/lib.rs`
- `apps/deno-notebooks/syphon/syphon.ts`
- `apps/deno-notebooks/syphon/headless_renderer.ts`
- `apps/deno-notebooks/syphon/headless_syphon.ts`
- `apps/deno-notebooks/syphon/staging_buffers.ts`
- `apps/deno-notebooks/native/syphon_bridge/src/lib.rs`
- `apps/deno-notebooks/headless_syphon_plan.md`
- Existing p5gpu, text, and Syphon examples and integration tests.

Use existing repository conventions for package layout. The names below describe boundaries, not mandatory new directory names.

## Shared architecture

Keep four responsibilities separate:

1. **Renderer:** portable `P5GPU`, glyph atlas, and sketch lifecycle logic.
2. **Native GPU integration:** pinned Dawn, upstream bindings, resource interop, and platform-specific extensions.
3. **Host services:** font/asset loading, Rust text calls, logging, timing, and input snapshots.
4. **Output adapters:** native window presentation, Syphon publication, and TouchDesigner transfers.

Build two host products from shared source:

| Product | JavaScript host | Native output |
| --- | --- | --- |
| Node package | Ordinary Node + `.node` addon | Window surfaces and Syphon |
| TD plugin | Embedded V8 + Dawn binding compatibility layer | TD CPU/CUDA bridge; optional Syphon component |

`dawn.node` is a shared-library addon, not the Node executable. Do not propose rebuilding Node to implement presentation. The embedded TD target reuses source/static libraries; it does not simply load the Node addon into bare V8.

TypeScript declarations for standard WebGPU come from upstream `@webgpu/types` and the Dawn `webgpu` package. Match versions to the pinned implementation. Maintain only the additional declarations for the custom host, surface, Syphon, and TD APIs. Typings do not guarantee that a particular runtime implements every browser integration API.

## Stage 1 — Dawn on standard Node, text, and native windows

### 1.1 Establish the upstream baseline

- Read local `AGENTS.md` and relevant livecode documentation. Record the avTools starting commit and existing working launch commands.
- Select and pin a supported Node release, Dawn revision, WebGPU typings version, and build toolchain. Avoid floating native dependencies.
- Run a minimal offscreen triangle/render-and-readback fixture against the official `webgpu` package first. This separates GPU/driver/environment problems from custom-addon problems.
- Build upstream `dawn.node` from source without changes and run the same fixture. Then introduce a reproducible patch application step.
- Keep shader compiler/backend modifications out of the patch unless a demonstrated bug requires them.
- Record the build commands, target architectures, linked dependencies, and license notices. Treat official Node bindings' WIP status as a reason for focused validation, not a promise of compatibility.

**Acceptance:** a standard Node process creates a hardware GPU device, renders an offscreen fixture, and validates a small readback. Both the packaged baseline and source build have recorded outcomes. Readback here is a test instrument.

### 1.2 Extract host-dependent services and run P5GPU

- Supply asset/font bytes through an injected loader rather than `Deno.readFile` inside the portable renderer.
- Preserve the TypeScript-facing text-engine operations: font loading, layout, glyph rasterization, and disposal.
- Replace the Deno FFI implementation with a narrow native wrapper calling the existing Rust C ABI. It may live in the same addon or a separate addon; no GPU handles need to cross this text interface.
- Keep the Rust library as a `cdylib`, or add a `staticlib` build if linking it into the addon simplifies packaging. Preserve C ABI ownership rules.
- Preserve 64-bit glyph keys as `bigint` through the bridge. Do not convert them through JavaScript `number`.
- Give each text-engine instance a single execution owner. Do not concurrently call mutable engine state from several sketch threads.
- Keep the existing atlas upload and caching behavior. Glyph rasterization is CPU work followed by GPU uploads; it is not a frame readback.
- Bundle the renderer's JavaScript dependencies, including `earcut`, appropriately for each host. Avoid a broad runtime compatibility shim.
- Run representative geometry, curves/stencil, blending, persistence across frames, and text scenes against Dawn.
- Verify validation errors, shader diagnostics, and device-loss reporting rather than hiding failures to make the first demo run.

**Acceptance:** the same representative sketch renders through Deno and Node/Dawn with equivalent intended appearance. Text shaping, variable-font settings, metrics, atlas growth, and disposal work through the retained Rust engine. No Deno calls remain in the Node execution path. Document any rendering differences rather than masking them.

### 1.3 Add native surface presentation

- Retain the Rust/winit window implementation initially. Rename its host-specific packaging only where useful; do not rewrite the window library for naming consistency.
- Establish which thread owns the native event loop and window APIs. Preserve macOS main-thread requirements when arranging Node event pumping.
- Add the smallest practical surface extension inside the Dawn addon: create surface, query capabilities, configure/unconfigure, acquire frame texture, present, and dispose.
- Access the existing native device through a narrow internal accessor. Wrap surface textures through the upstream `GPUTexture` binding. Avoid exposing arbitrary raw pointers as the normal sketch API.
- Keep a single coherent Dawn implementation/procedure table for participating resources. Do not load two independently linked GPU bindings and assume their objects interoperate.
- On macOS, resolve and retain the active `CAMetalLayer` from the native view. The current window library already installs one. Do not confuse an `NSView` pointer with a layer pointer.
- Check adapter/surface compatibility and actual format/usage capabilities. Select supported formats and convert/copy the renderer output as needed; do not blindly use the first format.
- Render `P5GPU` to its existing offscreen texture and blit/draw that texture into the acquired surface texture. This keeps previews independent of Stage 2 publication.
- Cache the acquired frame texture until present/discard; repeated access during one frame must not accidentally acquire several frames.
- Handle zero-size/minimized windows, physical-pixel dimensions, scale changes, resize, timeout, outdated/lost surfaces, close, and device loss explicitly.
- Use deliberate ownership: release acquired resources and unconfigure/destroy the surface before destroying its window. Audit borrowed versus owned native references.
- If extending the official packaging scripts to Linux later, verify X11/Wayland build flags; the inspected default packaging disabled them.

**Acceptance:** a Node-driven P5GPU sketch presents in the existing native window. Resize, Retina scale changes, minimize/restore, multiple windows, and repeated close/recreate work without crashes or steadily increasing native/GPU memory. An unavailable preview frame does not block unrelated engine work indefinitely.

### 1.4 Package and connect the existing host

- Produce a prebuilt npm-installable native package for the initial target. Missing-platform errors must be actionable; normal installation must not silently require a compiler.
- Run an install-and-launch check using ordinary Node on a clean target machine or equivalent clean environment, without Rust/C++ toolchains installed.
- Integrate the proven package into a minimal avTools Node host, preserving the portable engine's lifecycle and injected capabilities.
- Inventory remaining Deno-specific filesystem, process, WebSocket, MIDI, and import behavior in the full host. Port what is required for the selected end-to-end sketch; report remaining scope explicitly.
- Preserve the existing editor transport where practical. Replace Deno LSP with a pinned TypeScript language-server process and replace shadow `deno check` with the appropriate TypeScript check. Include host declarations in the shadow project. Do not implement an LSP or refactor the editor in this port.
- Keep MIDI outside the graphics addon unless sharing it solves a concrete packaging need. Native callbacks must copy ephemeral data and marshal to the JavaScript owner thread.

**Stage 1 exit:** standard Node can run an avTools sketch with text and optional native preview using the new package. Native binaries and patches are reproducibly built, installable, and documented. State separately whether the complete livecode host/editor migration is finished; a graphics fixture is not evidence of that.

## Stage 2 — GPU-only, headless Syphon channels

### 2.1 Prove one native-texture publication path

- Use an offscreen texture on Dawn's Metal backend. Syphon output must not acquire a window drawable or depend on any surface being visible.
- Add an addon operation conceptually equivalent to `channel.publishTexture(texture)`. Keep backend-specific handles inside the native implementation.
- Reuse the Rust Syphon bridge where useful, but add a texture-based entry point rather than passing pixel bytes to `syphon_headless_publish_frame`.
- Initialize the Syphon server using the Metal device backing the selected Dawn device. Do not independently choose the system-default device and assume it matches.
- Inspect the pinned Dawn Metal interop API. The investigated public header exposes device access and scheduling support; native texture access was found in internal `TextureMTL`. Isolate any internal access behind a small, version-tested adapter.
- Prefer a supported shared-resource route if the pinned version provides a suitable one. Otherwise document the exact internal accessor and why it is needed. Do not assume any ordinary WebGPU texture is externally shareable.
- Validate texture dimensions, format, sample count, usage, device identity, and liveness. Resolve multisampled rendering into a single-sample texture before publication.

### 2.2 Implement synchronization and ownership

- Define the ordering contract: rendering completes before Syphon reads; Syphon's read completes before the texture is overwritten or destroyed.
- Choose an actual native synchronization mechanism supported by the pinned backend: appropriately ordered command buffers/queues or explicit GPU synchronization. A returned JavaScript `queue.submit()` does not establish safe cross-API access by itself.
- Audit Dawn's scheduling requirements, including the comments in `MetalBackend.h`. A scheduling wait is not automatically equivalent to GPU completion.
- Retain source resources while publication work is outstanding. Use a bounded frame/resource pool if needed and define behavior when the pool is full.
- Do not make full GPU completion waits on the JavaScript thread the unexamined steady-state design. A conservative blocking proof may precede the final path, but measure and report it.
- Handle channel resize/reconfigure and shutdown while frames are in flight.
- Preserve name, flip, image-region, and client-state behavior. Skip unnecessary publication when no clients are connected where appropriate.
- Reuse the direct offscreen route instead of relying on the existing `nextDrawable` / `presentDrawable:` interception. Keep the old path only as a reference/fallback.

### 2.3 Integrate multiple channels and optional previews

- Replace the headless renderer's staging-buffer publication with texture publication. Keep CPU transport explicitly selectable for debugging only; never silently activate it while claiming GPU-only output.
- Support independent channel textures, sizes, and names on one device.
- Ensure closing, minimizing, hiding, or moving a preview to another desktop does not stop channel production. Avoid scheduling a blocking preview acquisition before mandatory publication work.
- If continuing to support the old window-interception path, ensure the surface uses the final Syphon-installed layer and audit `framebufferOnly` configuration. Do not mix those constraints into the new headless path unnecessarily.

### Stage 2 acceptance

- One channel, then at least three independent channels, publish recognizable frames into a real Syphon receiver such as TouchDesigner.
- Inspect/instrument the normal publication path: no `copyTextureToBuffer`, `mapAsync`, CPU pixel extraction, or `replaceRegion:...withBytes:` for frame transport.
- GPU copies performed by Syphon are allowed. Describe the result as **no CPU readback**, not unqualified zero-copy.
- Validate color, alpha, orientation, resizing, variable frame rate, no-client/reconnect behavior, and rapid create/destroy with frames in flight.
- Use frame identifiers or an equivalent fixture to detect stale, torn, or out-of-order images.
- Compare the old and new paths on the same machine at a representative resolution/channel count. Record CPU frame time, throughput, publication latency, memory behavior, and synchronization costs; do not invent a performance target from an unmeasured estimate.
- A sustained run continues with all previews hidden or closed and does not accumulate memory or outstanding frames.

**Stage 2 exit:** avTools publishes multiple offscreen Syphon channels with no CPU frame readback using standard Node and the prebuilt native package.

## Stage 3 — TouchDesigner custom operator

### 3.1 Verify SDK and output constraints first

- Record the exact TouchDesigner build, OS, and architecture. Read headers from that installation before the final build. The official GitHub sample headers are useful for inspection but can lag the installed SDK.
- Begin with a CPlusPlus TOP loading a minimal native plugin; register/install it as a Custom Operator once the basic host works.
- Verify the supported execution modes in the matching SDK. The inspected interface provided `CPUMem` and `CUDA`; old OpenGL examples and proposed Vulkan interfaces in forum posts are not evidence of supported APIs.
- Use CPU output as the initial portable implementation. On macOS this is a known output-boundary cost, not a failure to render on the GPU.
- Keep the TD transfer layer replaceable. A CPU implementation, Windows CUDA implementation, and Syphon component are distinct deliverables.

### 3.2 Embed JavaScript and upstream WebGPU bindings

- Build a small embedding fixture before loading it into TD: V8, Dawn's `napi_v8` layer, upstream WebGPU bindings, required polyfills, and a bounded event pump.
- Follow the upstream standalone CTS runner for initialization, but do not copy its process-level shutdown, `process.exit`, or blocking event-loop behavior into a TD plugin.
- Bundle/transpile the portable renderer to JavaScript. Bare V8 does not supply TypeScript compilation, package resolution, Deno APIs, or a full Node environment. For TypeScript Sketch DATs, add an explicit transpilation service; establish JavaScript sketches first.
- Expose the retained Rust text engine through the embedded host adapter. Link/load the existing C ABI; do not require a Rust rewrite or presume a Node addon loads directly into V8.
- Share process-wide runtime infrastructure deliberately; keep sketch state isolated per operator. Record the isolate/context strategy and thread ownership.
- Pump GPU promises, V8 microtasks, and required scheduled callbacks without blocking TD indefinitely. Support asynchronous initialization before entering the ready state.
- Handle JS exceptions as operator errors. Apply a defined execution budget for runaway scripts and recover/reset the affected sketch. Do not permit a sketch to exit the TD process.
- Audit plugin unload/reload: dispose callbacks, persistent handles, GPU resources, Rust state, and worker tasks before unloading their code. Do not shut down a shared V8 platform while other operator instances use it.
- Validate platform packaging and symbol isolation when loading V8/Dawn into a host that may have other native runtime dependencies.

**Embedding gate:** two independent instances run a simple Dawn-backed sketch with text, resolve initialization promises, report script errors, and repeatedly reset/dispose without crashing. The plain-V8 path must work in a fixture before TD integration. If the recent upstream compatibility layer is insufficient, document the precise blocker; embedding `libnode` is a possible fallback but should be an explicit architecture decision, not a silent replacement.

### 3.3 Implement sketch and input lifecycle

Proposed operator controls:

- Sketch DAT or source-file parameter.
- CHOP-reference parameter for controls.
- One or more wired TOP inputs; optional TOP-reference parameters as needed.
- Width, height, reset, and source-reload controls.
- Error/status reporting through the operator and Info DAT/CHOP.

Define a small typed sketch API. The following is illustrative, not an existing API:

```ts
export function setup(p, host) {
  // Initialize persistent sketch state and load resources.
}

export function draw(p, frame) {
  const amount = frame.chop("Controls", "amount");
  p.background(0);
  p.circle(320, 240, 20 + amount * 100);
  // Once implemented: p.image(frame.top(0), 0, 0);
}
```

- Run `setup()` after device/resource initialization, and again only under the documented reset/reload policy.
- Have TD cooking drive `beginFrame()`, `draw()`, and `endFrame()`. Use TD time/frame information rather than a separate animation timer. Define pause, repeated cook, backward seek, and frame-count semantics.
- Start with synchronous `draw()` for deterministic input lifetimes. Support async asset preparation through initialization. Any later async draw mode needs explicit scheduling and latency semantics.
- Retrieve TOP wires using `getInputTOP`; retrieve CHOP controls using `getParCHOP` and source DAT using `getParDAT`. A custom TOP does not acquire mixed CHOP/TOP wire inputs automatically.
- Expose CHOP names, sample rate, sample counts, and samples. Snapshot into owned data where JS may retain it; never retain temporary TD pointers after their validity interval.
- On source edits, compile a candidate before replacing the active sketch. Preserve the last good sketch on compile errors. Document whether a successful reload resets state.
- On draw errors, keep a defined last-good output or diagnostic frame and report the stack. Do not repeatedly recreate the GPU device to hide errors.

### 3.4 Implement TOP input and output

**Portable CPU path:**

- Input: use TD's supported texture download API, retain the download result for its required lifetime, and upload into a reusable Dawn texture.
- Add actual textured-image support to `P5GPU.image()`, respecting transforms, tint/alpha, filtering, UV orientation, clipping, and draw ordering as required by existing renderer conventions.
- Output: render offscreen, read back into reusable staging buffers, handle row padding, and copy into a TD-owned `TOP_Buffer`; return it with `uploadBuffer` using the matching texture descriptor and first-pixel orientation.
- Perform the final transfer at the native boundary where practical; do not unnecessarily materialize a full frame as JS pixel objects.
- Make buffering semantics explicit: same-cook output may wait for GPU completion; pipelined output adds latency. Do not silently add a frame of latency to a feedback network.
- Preserve format, alpha convention, and color-space behavior. Test ordinary RGBA8 first; add float/HDR formats only with validated support.
- Report upload/download cost separately from JS execution and GPU rendering.

**Optional Windows/NVIDIA GPU path:**

- Use TD's CUDA execution mode and supplied arrays.
- Establish shareable resources and synchronization between the selected Dawn backend and CUDA on the same physical GPU. This is not a cast from `GPUTexture` to `cudaArray`.
- Transfer to/from TD arrays on the required thread and within `beginCUDAOperations()` / `endCUDAOperations()` boundaries. Honor input-array lifetimes and CUDA stream ordering.
- Validate the exact backend's external-memory/fence support before committing to a sharing design. GPU-to-GPU copies are acceptable; CPU frame transport must be absent to call this GPU-only.

**Optional macOS GPU-only component:**

- Reuse Stage 2 to publish the embedded renderer's texture and receive it through TD's built-in Syphon In TOP inside a packaged component.
- This can keep the renderer in TD's process, but it is a component-level transport, not direct output through the C++ TOP API.
- Ensure TD cooks the producer before the intended receiver consumption. Validate latency, feedback behavior, channel naming, and multiple component instances.
- GPU-only TOP input would need a corresponding supported transport/import path; Stage 2 publication alone does not solve input import.
- Do not promise direct macOS GPU output from a single custom TOP unless the matching TD SDK exposes a verified supported API.

### Stage 3 acceptance

- A packaged plugin runs a Sketch DAT with `setup()` and cook-driven `draw()` without requiring Node or Deno installation.
- CHOP control changes visibly affect a sketch; multi-sample CHOP data is exposed correctly.
- A TOP input can be drawn/composited by the sketch and the result consumed downstream as a TOP.
- Rust-backed text, resizing, two independent operators, hot reload, reset, invalid source, draw exceptions, and plugin teardown work.
- A runaway sketch has a tested recovery path; long initialization does not indefinitely block the UI.
- Document the selected output transport and measured latency/cost. CPU mode, CUDA mode, and the Syphon component must never be conflated in support claims.
- Reproduce installation and loading on a target system with no development toolchain.

**Stage 3 exit:** a usable TD sketch operator with declared input/output semantics and known platform limitations. GPU-only transport is a separate validated capability, not a prerequisite for the first working operator.

## Suggested implementation increments

| Increment | Deliverable |
| --- | --- |
| 1 | Pinned upstream Dawn source build and offscreen Node fixture |
| 2 | Portable P5GPU host services and Rust text bridge |
| 3 | Native window surface extension and lifecycle handling |
| 4 | Prebuilt package and minimal livecode host integration |
| 5 | One offscreen native-texture Syphon channel with correct synchronization |
| 6 | Multiple channels, preview independence, and comparative measurements |
| 7 | Standalone embedded V8/Dawn/P5GPU fixture |
| 8 | TD plugin lifecycle, Sketch DAT, CHOP controls, and CPU TOP output |
| 9 | TOP input drawing, reload/error behavior, and packaged plugin |
| 10 | Platform-specific GPU transport, if required and supported |

For each increment, record changed interfaces, exact versions/build commands, checks actually run, results, and remaining limitations. Prefer a few behavioral integration fixtures over tests that merely duplicate implementation details. Stop broadening tests once the increment's concrete risks are covered.

Do not report simulated or software-only GPU results as hardware validation. If the coding environment lacks macOS/Syphon or TouchDesigner, finish the buildable code and automated checks it can support, then provide exact target-machine validation steps and mark that gate pending.

## Reference sources

Repository-specific sources:

- [avTools](https://github.com/AvneeshSarwate/avTools)
- [P5GPU renderer](https://github.com/AvneeshSarwate/avTools/blob/main/apps/deno-notebooks/tools/p5gpu.ts)
- [Rust text engine](https://github.com/AvneeshSarwate/avTools/tree/main/apps/deno-notebooks/native/text_engine)
- [Native window implementation](https://github.com/AvneeshSarwate/avTools/blob/main/apps/deno-notebooks/native/deno_window/src/lib.rs)
- [Syphon bridge](https://github.com/AvneeshSarwate/avTools/blob/main/apps/deno-notebooks/native/syphon_bridge/src/lib.rs)
- [Headless Syphon renderer](https://github.com/AvneeshSarwate/avTools/blob/main/apps/deno-notebooks/syphon/headless_renderer.ts)

Upstream implementation and API sources:

- [Official Dawn Node package/build](https://github.com/dawn-gpu/node-webgpu)
- [Dawn Node bindings and build instructions](https://dawn.googlesource.com/dawn/+/refs/heads/main/src/dawn/node/README.md)
- [Dawn GPU texture wrapper](https://github.com/google/dawn/blob/main/src/dawn/node/binding/GPUTexture.h)
- [Dawn standalone V8 runner](https://github.com/google/dawn/blob/main/src/dawn/node/standalone/main.cpp)
- [Dawn V8 Node-API compatibility layer](https://github.com/google/dawn/tree/main/src/dawn/node/napi_v8)
- [Dawn standalone event loop](https://github.com/google/dawn/blob/main/src/dawn/node/standalone/EventLoop.h)
- [Dawn Metal interop header](https://github.com/google/dawn/blob/main/include/dawn/native/MetalBackend.h)
- [Dawn internal Metal texture interface](https://github.com/google/dawn/blob/main/src/dawn/native/metal/TextureMTL.h)
- [WebGPU TypeScript declarations](https://github.com/gpuweb/types)
- [Syphon Metal server API](https://github.com/Syphon/Syphon-Framework/blob/main/SyphonMetalServer.h)
- [Official TD custom-operator samples](https://github.com/TouchDesigner/CustomOperatorSamples)
- [TD TOP header](https://github.com/TouchDesigner/CustomOperatorSamples/blob/main/TOP/BasicFilterTOP/TOP_CPlusPlusBase.h)
- [TD common header](https://github.com/TouchDesigner/CustomOperatorSamples/blob/main/TOP/BasicFilterTOP/CPlusPlus_Common.h)
- [Writing a C++ TOP](https://derivative.ca/UserGuide/Write_a_CPlusPlus_TOP)
- [Writing a C++ plugin](https://derivative.ca/UserGuide/Write_a_CPlusPlus_Plugin)
- [TD staff discussion of macOS GPU interop limits](https://forum.derivative.ca/t/gpu-acceleration-for-custom-operators-on-macos-metal-touchdesigner-2025/749595)
- [NVIDIA CUDA graphics/external-resource interop](https://docs.nvidia.com/cuda/cuda-programming-guide/04-special-topics/graphics-interop.html)
- [TD Syphon/Spout input](https://derivative.ca/UserGuide/Syphon_Spout_In_TOP)

Links point to live upstream pages. Pin source revisions in the implementation manifest; revalidate API and SDK assumptions at each stage instead of treating this plan as an ABI specification.

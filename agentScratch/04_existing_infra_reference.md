# Existing Infrastructure Reference

---

## P5GPU Current State (apps/deno-notebooks/tools/p5gpu.ts)

### Architecture: CPU Tessellation → GPU Rendering

All geometry is tessellated to triangles on CPU, appended to a flat vertex array,
then uploaded to GPU as a single vertex buffer per frame.

### Vertex Format (6 floats, 24 bytes)
```
position: vec2f  (2 floats) -- pixel-space, pre-transformed by matrix
color:    vec4f  (4 floats) -- RGBA [0..1]
```

### Batch System
- `DrawBatch = { startVertex, vertexCount, blendMode }`
- Consecutive draw calls with same blend mode share a batch
- One draw call per batch per frame

### Shader (WGSL)
```wgsl
// Uniform: canvas size (vec2f)
// Vertex: pixel coords → NDC, passthrough color
// Fragment: return color directly (no textures)
```

### What Exists
- Full 2D geometry: rect, ellipse, arc, line, point, triangle, quad
- Complex shapes via beginShape/endShape + earcut triangulation
- Bezier/Catmull-Rom curves
- Stroke rendering: caps (ROUND, SQUARE, PROJECT), joins (ROUND, MITER, BEVEL)
- Transform stack: translate, rotate, scale, shearX/Y, push/pop
- Color system: RGB, HSB, HSL, string parsing, lerpColor
- Blend modes: BLEND, ADD, MULTIPLY, SCREEN, REPLACE
- MSAA: optional 4x (graceful fallback)
- Pixel ops: loadPixels, updatePixels, get, set

### What's Missing for Text
- No texture binding infrastructure
- No UV coordinates in vertex format
- No texture sampler in shader
- `image()` method exists but throws "not implemented"
- No text state (font, size, align, etc.)
- No text measurement functions

---

## Native FFI Modules (apps/deno-notebooks/native/)

### Existing Modules
1. **fastsleep** -- high-precision sleep (spin_sleep)
2. **deno_window** -- native windowing (winit), multi-window, event polling
3. **midi_bridge** -- MIDI I/O with coalescing
4. **syphon_bridge** -- macOS Syphon server/client (Metal interception)

### Common FFI Patterns
- All use `crate-type = ["cdylib"]`
- Release: `panic = "abort"`, `lto = true`, `codegen-units = 1`
- TypeScript bindings in separate `ffi.ts` files
- Opaque pointers for persistent state (create/destroy lifecycle)
- JSON serialization for complex data crossing FFI boundary
- Binary protocols for high-frequency data (MIDI packets)

### No text FFI module exists yet
- Previous text rendering used `@gfx/canvas` (external Skia FFI package)
- Or `@gfx/canvas-wasm` (WASM backend)
- These are npm/deno packages, not custom native modules

---

## Usage Patterns

P5GPU is used in two contexts:
1. **p5_webgpu_syphon.ts** -- real-time rendering to Syphon window (960x640, 4x MSAA)
2. **p5_comparison_tests.ts** -- headless rendering for pixel comparison tests

Both follow `beginFrame()` → draw calls → `endFrame()` cycle.
`endFrame()` returns a `GPUTexture` that can be presented or read back.

---

## Key Files

| Path | Purpose |
|------|---------|
| `tools/p5gpu.ts` | Main P5GPU class (1755 lines) |
| `tools/p5_test_sketches.ts` | DrawingAPI interface + test sketches |
| `tools/p5_webgpu_syphon.ts` | Syphon integration example |
| `tools/p5_comparison_tests.ts` | Headless comparison tests |
| `window/ffi.ts` | Window FFI bindings |
| `window/window.ts` | GpuWindow creation |
| `native/*/` | Rust FFI modules |

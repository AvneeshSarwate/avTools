# P5GPU: Custom WebGPU 2D Renderer with p5.js-Compatible API

## Goal

Build a standalone WebGPU-based 2D renderer (`P5GPU`) that implements p5.js's non-text drawing API. Test sketches run on both this renderer and the Skia-backed p5 shim (`p5_deno_shim.ts`), producing PNGs that are pixel-compared to verify correctness.

## Architecture Overview

```
User sketch code (shared between backends)
        │
   ┌────┴────┐
   │         │
   ▼         ▼
 P5GPU     p5 + @gfx/canvas (Skia)
   │         │
   ▼         ▼
 WebGPU    Canvas 2D → Skia FFI
   │         │
   ▼         ▼
 .output/p5gpu/    .output/p5-reference/
        │
        ▼
  compare_renders.ts (pixel diff, RMSE)
```

### Design Principles

1. **Standalone class** — no dependency on p5.js. `P5GPU` mirrors p5's API signature exactly so the same sketch function works on both backends.
2. **CPU tessellation → GPU render** — each draw call tessellates shapes to triangles on the CPU. At frame end, all triangles are uploaded in one vertex buffer and drawn in a single render pass.
3. **Immediate-mode command recording** — drawing calls append to per-frame vertex arrays. `endFrame()` flushes everything to the GPU.
4. **Painter's algorithm** — draw order is submission order. No depth buffer. Alpha blending is standard source-over.

### Rendering Pipeline

```
API call (rect, circle, etc.)
  → Read current state (fill color, stroke, transform matrix)
  → Tessellate shape → append to _fillVerts[] and/or _strokeVerts[]
  → (repeat for all draw calls in frame)
  → endFrame():
      1. Upload _fillVerts to GPU vertex buffer
      2. Upload _strokeVerts to GPU vertex buffer
      3. Clear render target to background color
      4. Render fill pass (all fill triangles, one draw call)
      5. Render stroke pass (all stroke triangles, one draw call)
      6. Return output texture
```

### Vertex Format

```wgsl
struct Vertex {
  @location(0) position: vec2f,   // pixel-space (pre-transformed by CPU matrix)
  @location(1) color: vec4f,      // RGBA [0..1]
}
```

Per-vertex color allows batching all draw calls into a single draw call per pass (fill/stroke), since each shape can have a different color.

### Shaders

```wgsl
// Vertex shader: pixel coords → clip space
@group(0) @binding(0) var<uniform> canvas_size: vec2f;

@vertex
fn vs(v: Vertex) -> @builtin(position) vec4f {
  let ndc = vec2f(
    v.position.x / canvas_size.x * 2.0 - 1.0,
     -(v.position.y / canvas_size.y * 2.0 - 1.0)   // flip Y
  );
  return vec4f(ndc, 0.0, 1.0);
}

// Fragment shader: pass through vertex color
@fragment
fn fs(@location(0) color: vec4f) -> @location(0) vec4f {
  return color;
}
```

---

## Complete API Surface

### Constructor & Frame Management

| Method | Description |
|---|---|
| `constructor(device, opts: { width, height, format? })` | Create renderer with output texture |
| `beginFrame()` | Clear vertex lists, prepare for new frame |
| `endFrame(): GPUTexture` | Upload vertices, render, return output texture |
| `dispose()` | Destroy GPU resources |

### 2D Shape Primitives

| Method | Signature | Notes |
|---|---|---|
| `rect` | `(x, y, w, h?, tl?, tr?, br?, bl?)` | Optional per-corner radii |
| `square` | `(x, y, s, tl?, tr?, br?, bl?)` | Alias for rect with w=h=s |
| `ellipse` | `(x, y, w, h?)` | h defaults to w |
| `circle` | `(x, y, d)` | Alias for ellipse with w=h=d |
| `arc` | `(x, y, w, h, start, stop, mode?)` | mode: OPEN, CHORD, PIE |
| `line` | `(x1, y1, x2, y2)` | Stroke only (no fill) |
| `point` | `(x, y)` | Rendered as small circle with strokeWeight diameter |
| `quad` | `(x1, y1, x2, y2, x3, y3, x4, y4)` | Arbitrary quadrilateral |
| `triangle` | `(x1, y1, x2, y2, x3, y3)` | Three vertices |

### Vertex-Based Shapes

| Method | Signature | Notes |
|---|---|---|
| `beginShape` | `(kind?)` | POINTS, LINES, TRIANGLES, TRIANGLE_FAN, TRIANGLE_STRIP, QUADS, QUAD_STRIP, or none (polygon) |
| `endShape` | `(mode?)` | CLOSE to connect last vertex to first |
| `vertex` | `(x, y)` | Add vertex to current shape |
| `curveVertex` | `(x, y)` | Catmull-Rom spline control point |
| `bezierVertex` | `(x2, y2, x3, y3, x4, y4)` | Cubic bezier segment (from last vertex) |
| `quadraticVertex` | `(cx, cy, x3, y3)` | Quadratic bezier segment |
| `beginContour` | `()` | Start a hole in the current shape |
| `endContour` | `()` | End hole definition |

### Curves (Standalone)

| Method | Signature | Notes |
|---|---|---|
| `bezier` | `(x1, y1, x2, y2, x3, y3, x4, y4)` | Draw cubic bezier |
| `curve` | `(x1, y1, x2, y2, x3, y3, x4, y4)` | Draw Catmull-Rom spline (visible segment: p2→p3) |
| `curveTightness` | `(amount)` | Default 0. Affects Catmull-Rom interpolation |

### Fill & Stroke

| Method | Signature | Notes |
|---|---|---|
| `fill` | `(v1, v2?, v3?, a?)` | Set fill color. Overloads: (gray), (gray, alpha), (r, g, b), (r, g, b, a), (colorString) |
| `noFill` | `()` | Disable fill |
| `stroke` | `(v1, v2?, v3?, a?)` | Set stroke color (same overloads as fill) |
| `noStroke` | `()` | Disable stroke |
| `strokeWeight` | `(weight)` | Line/outline thickness in pixels |
| `strokeCap` | `(cap)` | ROUND, SQUARE, PROJECT |
| `strokeJoin` | `(join)` | MITER, BEVEL, ROUND |

### Transform

| Method | Signature | Notes |
|---|---|---|
| `translate` | `(x, y)` | Shift origin |
| `rotate` | `(angle)` | Rotate (radians) |
| `scale` | `(s, y?)` | Uniform or non-uniform scale |
| `shearX` | `(angle)` | Horizontal shear |
| `shearY` | `(angle)` | Vertical shear |
| `applyMatrix` | `(a, b, c, d, e, f)` | Apply 3×3 affine transform |
| `resetMatrix` | `()` | Identity transform |
| `push` | `()` | Save full state (transform + style) |
| `pop` | `()` | Restore saved state |

### Color & Rendering

| Method | Signature | Notes |
|---|---|---|
| `background` | `(v1, v2?, v3?, a?)` | Clear canvas to color |
| `clear` | `()` | Clear to transparent |
| `colorMode` | `(mode, max1?, max2?, max3?, maxA?)` | RGB, HSB, HSL |
| `blendMode` | `(mode)` | BLEND, ADD, MULTIPLY, SCREEN, etc. |
| `erase` | `(strengthFill?, strengthStroke?)` | Enter erase mode |
| `noErase` | `()` | Exit erase mode |
| `lerpColor` | `(c1, c2, amt)` | Interpolate colors |

### Shape Modes

| Method | Signature | Notes |
|---|---|---|
| `rectMode` | `(mode)` | CORNER (default), CORNERS, CENTER, RADIUS |
| `ellipseMode` | `(mode)` | CENTER (default), RADIUS, CORNER, CORNERS |

### Pixel Operations

| Method | Signature | Notes |
|---|---|---|
| `loadPixels` | `()` | Read texture back to `this.pixels[]` |
| `updatePixels` | `()` | Upload `this.pixels[]` to texture |
| `get` | `(x, y)` / `(x, y, w, h)` | Read pixel color or subregion |
| `set` | `(x, y, c)` | Set pixel |
| `pixels` | `Uint8ClampedArray` | Flat RGBA array, length = w*h*4 |

### Constants

```typescript
// Shape modes
CORNER, CORNERS, CENTER, RADIUS
// Stroke
ROUND, SQUARE, PROJECT, MITER, BEVEL
// Shape closing
CLOSE
// beginShape kinds
POINTS, LINES, TRIANGLES, TRIANGLE_FAN, TRIANGLE_STRIP, QUADS, QUAD_STRIP
// Arc modes
OPEN, CHORD, PIE
// Color modes
RGB, HSB, HSL
// Blend modes
BLEND, ADD, DARKEST, LIGHTEST, DIFFERENCE, EXCLUSION, MULTIPLY, SCREEN, REPLACE, REMOVE, OVERLAY, HARD_LIGHT, SOFT_LIGHT, DODGE, BURN
// Math
PI, TWO_PI, HALF_PI, QUARTER_PI, TAU
```

---

## Internal State Machine

```typescript
interface DrawState {
  // Transform
  matrix: Float32Array;          // 3×3 affine (6 values: a,b,c,d,tx,ty)

  // Fill
  fillEnabled: boolean;
  fillColor: [number, number, number, number];  // RGBA [0..1]

  // Stroke
  strokeEnabled: boolean;
  strokeColor: [number, number, number, number];
  strokeWeight: number;
  strokeCap: number;             // ROUND | SQUARE | PROJECT
  strokeJoin: number;            // MITER | BEVEL | ROUND

  // Modes
  rectMode: number;              // CORNER | CORNERS | CENTER | RADIUS
  ellipseMode: number;
  colorMode: number;             // RGB | HSB | HSL
  colorMaxes: [number, number, number, number];  // max per channel

  // Blend
  blendMode: number;

  // Curve
  curveTightness: number;
}
```

`push()` clones the entire state onto a stack. `pop()` restores it.

---

## Tessellation Details

### Simple Shapes

| Shape | Fill Tessellation | Stroke Tessellation |
|---|---|---|
| **rect** (no rounding) | 2 triangles (4 corners) | 4 thick-line segments, joined |
| **rect** (rounded) | Center rect + 4 corner arcs (fan triangulated) | Polyline with arcs at corners |
| **triangle** | 1 triangle (3 verts) | 3 thick-line segments, joined |
| **quad** | 2 triangles (split on diagonal) | 4 thick-line segments, joined |
| **ellipse/circle** | Fan from center, N segments (N=max(24, circumference/4)) | Same polyline, thick-line expanded |
| **arc** | Fan from center through angle range; CHORD adds closing triangle; PIE adds two radial triangles | Outline polyline per mode |
| **line** | None (stroke only) | 1 thick-line segment with caps |
| **point** | Filled circle with diameter=strokeWeight | None |

### Thick-Line Expansion (Stroke Rendering)

Each line segment is expanded into a quad (2 triangles) offset ±strokeWeight/2 along the perpendicular. For polylines:

**Joins:**
- **MITER**: Extend lines to intersection point (with miter limit = 2×strokeWeight). Fall back to BEVEL if exceeded.
- **BEVEL**: Flat triangle connecting outer edges at the join.
- **ROUND**: Arc of triangles filling the gap at the join.

**Caps (line endpoints):**
- **ROUND**: Semicircle (fan of triangles).
- **SQUARE/PROJECT**: Extend line by strokeWeight/2 past endpoint.
- **BUTT**: No extension (flush with endpoint). This is p5's default when strokeCap is not set explicitly — but p5's actual default is ROUND.

### Vertex Shapes (beginShape/endShape)

For a default polygon (no `kind` argument):
1. Collect all `vertex()` points into a polyline.
2. **Fill**: Triangulate with earcut (handles concave polygons, holes via `beginContour`/`endContour`).
3. **Stroke**: Thick-line expand the polyline (closed if `CLOSE` mode).

For specific `kind` values:
- `POINTS`: Each vertex → filled circle (like `point()`).
- `LINES`: Pairs of vertices → thick lines.
- `TRIANGLES`: Triplets of vertices → filled triangles + outlined triangles.
- `TRIANGLE_FAN`: First vertex is hub; each subsequent pair forms a triangle.
- `TRIANGLE_STRIP`: Sliding window of 3 vertices.
- `QUADS`: Groups of 4 → 2 triangles each.
- `QUAD_STRIP`: Sliding window of 4, pairs form quads.

### Curve Vertices

`curveVertex()` accumulates control points. When 4+ points exist, Catmull-Rom segments are evaluated:

```
For each window of 4 consecutive control points [p0, p1, p2, p3]:
  The visible curve is from p1 to p2.
  Evaluate at N subdivision steps (default 20).
  Generate polyline points.
```

The `curveTightness` parameter (default 0) adjusts the tangent scaling. The Catmull-Rom matrix with tightness `s`:

```
t = (1 - s) / 2
M = [ -t,  2-t,  t-2,   t ]
    [ 2t, t-3,  3-2t,  -t ]
    [ -t,  0,    t,     0 ]
    [  0,  1,    0,     0 ]
```

`bezierVertex()` appends a cubic Bezier from the last vertex through two control points to an endpoint. Subdivided into N line segments (default 20).

`quadraticVertex()` same but for quadratic Bezier (one control point).

After all curve/bezier vertices are converted to polyline points, the polygon is triangulated (earcut for fill, thick-line for stroke).

---

## Color System

### Color Parsing

p5's `fill()` and `stroke()` accept multiple overload patterns:

```
fill(gray)                    → (gray, gray, gray, maxA)
fill(gray, alpha)             → (gray, gray, gray, alpha)
fill(r, g, b)                 → (r, g, b, maxA)
fill(r, g, b, a)              → (r, g, b, a)
fill('#rrggbb')               → parse hex
fill('#rrggbbaa')             → parse hex with alpha
fill('rgb(r, g, b)')          → parse CSS
fill([r, g, b, a])            → array
```

Values are normalized by `colorMaxes` (default [255, 255, 255, 255] for RGB mode).

### Color Mode Conversion

- **RGB**: Direct `(r/maxR, g/maxG, b/maxB, a/maxA)`.
- **HSB**: Convert HSB → RGB.
- **HSL**: Convert HSL → RGB.

The internal representation is always `[r, g, b, a]` in [0..1] range.

---

## GPU Resource Management

### Per-Renderer (created once)

| Resource | Description |
|---|---|
| `outputTexture` | `rgba8unorm`, RENDER_ATTACHMENT \| COPY_SRC \| TEXTURE_BINDING |
| `fillPipeline` | Render pipeline for fill triangles (alpha blend) |
| `strokePipeline` | Same pipeline (or shared), for stroke triangles |
| `canvasSizeBuffer` | Uniform buffer with `[width, height]` |
| `shaderModule` | Compiled WGSL |
| `bindGroup` | Group 0: canvasSizeBuffer |

### Per-Frame (dynamic)

| Resource | Description |
|---|---|
| `fillVertexBuffer` | Uploaded from `_fillVerts` Float32Array. Recreated if size grows. |
| `strokeVertexBuffer` | Same for stroke vertices. |

Buffer management strategy:
- Track max buffer size seen so far.
- Only recreate if current frame's data exceeds it (grow-only).
- Use `device.queue.writeBuffer()` for upload (avoids mappedAtCreation overhead each frame).

### Blend Modes

Each blend mode maps to a `GPUBlendState`:

| p5 Mode | RGB Operation | Alpha Operation |
|---|---|---|
| BLEND | src×srcA + dst×(1-srcA) | src×1 + dst×(1-srcA) |
| ADD | src×srcA + dst×1 | src×1 + dst×1 |
| MULTIPLY | src×dst + dst×(1-srcA) | (standard) |
| SCREEN | src×1 + dst×(1-src) | (standard) |
| REPLACE | src×1 + dst×0 | src×1 + dst×0 |

For modes not expressible as single blend equations (DIFFERENCE, OVERLAY, etc.):
- Use a multi-pass approach: render to intermediate texture, then composite with a custom shader.
- **V1**: Implement BLEND, ADD, MULTIPLY, SCREEN, REPLACE only. Others marked as TODO.

---

## Implementation Phases

### Phase 1: Core Infrastructure + Simple Filled Shapes

**Files:**
- `tools/p5gpu.ts` — main P5GPU class

**Scope:**
- P5GPU class with constructor, beginFrame/endFrame
- DrawState with push/pop
- 3×3 affine transform matrix (translate, rotate, scale, shearX, shearY, applyMatrix, resetMatrix)
- Color parsing for RGB mode (fill/stroke with all overloads)
- Fill tessellation for: `rect` (no rounding), `triangle`, `quad`, `ellipse`, `circle`
- `background()`, `clear()`
- `rectMode()`, `ellipseMode()`
- Vertex shader + fragment shader
- GPU pipeline, vertex buffer upload, render pass
- Output texture readback (for comparison testing)

**Test cases:**
- Filled rectangles at various positions/sizes
- Filled circles and ellipses
- Filled triangles and quads
- Background colors
- `rectMode(CENTER)`, `ellipseMode(CORNER)` variations
- Nested push/pop with transforms
- Overlapping translucent shapes (alpha blending)

**Deliverable:** Can render basic filled shapes, output to PNG, compare vs Skia.

---

### Phase 2: Stroke Rendering

**Scope:**
- `strokeWeight()`, `strokeCap()`, `strokeJoin()`
- `stroke()` / `noStroke()`
- Thick-line expansion algorithm (perpendicular offset)
- Miter joins (with miter limit fallback to bevel)
- Bevel joins
- Round joins (arc tessellation)
- Round caps, square/project caps
- Shape outlines for all Phase 1 shapes
- `line()` — standalone thick line with caps
- `point()` — small filled circle

**Test cases:**
- Lines with varying strokeWeight (1, 2, 5, 10, 20)
- Stroke caps comparison (ROUND, SQUARE, PROJECT)
- Stroke joins comparison on polylines (MITER, BEVEL, ROUND)
- Rectangles with both fill and stroke
- Circles with thick stroke
- Points at various sizes

**Deliverable:** All simple shapes render with correct fill + stroke.

---

### Phase 3: Arcs, Rounded Rects, Curves

**Scope:**
- `arc()` with modes: OPEN, CHORD, PIE
- `rect()` with rounded corners (tl, tr, br, bl parameters)
- `square()` with rounded corners
- `bezier()` — standalone cubic bezier (linearize → polyline → fill/stroke)
- `curve()` — standalone Catmull-Rom spline
- `curveTightness()`
- Bezier subdivision helper
- Catmull-Rom evaluation with tightness parameter

**Test cases:**
- Arcs at 0→PI, 0→TWO_PI, PI→TWO_PI, etc. in all three modes
- Rects with uniform and per-corner radii
- Cubic beziers with varying curvature
- Catmull-Rom curves with tightness -5, 0, 1
- Combined: rounded rect with stroke, arc with fill and stroke

**Deliverable:** All curved shapes working.

---

### Phase 4: Vertex Shapes (beginShape / endShape)

**Scope:**
- `beginShape()` / `endShape()` for default polygon mode
- `vertex()`
- `beginContour()` / `endContour()` — holes via earcut
- `curveVertex()` — accumulate then linearize via Catmull-Rom
- `bezierVertex()` — cubic bezier from last vertex
- `quadraticVertex()` — quadratic bezier from last vertex
- `endShape(CLOSE)` — close the polygon
- `beginShape(POINTS)`, `beginShape(LINES)`, `beginShape(TRIANGLES)`, `beginShape(TRIANGLE_FAN)`, `beginShape(TRIANGLE_STRIP)`, `beginShape(QUADS)`, `beginShape(QUAD_STRIP)`

**Earcut integration:**
- Flatten vertex list to `[x0, y0, x1, y1, ...]`
- Holes array: `[startIndex1, startIndex2, ...]` for each contour
- `earcut(flatCoords, holesArray, 2)` → index array
- Use indices to emit triangles

**Test cases:**
- Convex polygon (pentagon, hexagon)
- Concave polygon (star, L-shape)
- Polygon with hole (square with circular cutout, approximated)
- Star shape with curveVertex (smooth star)
- Bezier-based shape (organic blob)
- All beginShape kinds: POINTS → dots, LINES → segments, TRIANGLES → triplets, etc.
- Mixed vertex/curveVertex/bezierVertex in one shape

**Deliverable:** Full vertex-based shape system.

---

### Phase 5: Color Modes, Blend Modes, Pixel Operations

**Scope:**
- `colorMode(HSB)`, `colorMode(HSL)` with custom ranges
- HSB→RGB, HSL→RGB conversion
- `lerpColor()`
- `blendMode()` — BLEND, ADD, MULTIPLY, SCREEN, REPLACE
- `erase()` / `noErase()`
- `loadPixels()` — GPU texture readback to `pixels[]` array
- `updatePixels()` — upload `pixels[]` to GPU texture
- `get(x, y)` — single pixel read (via loadPixels or targeted readback)
- `set(x, y, c)` — single pixel write
- `image(img, x, y, w, h)` — draw pixel data as textured quad (requires texture creation from image data)

**Test cases:**
- HSB color wheel (hue sweep)
- HSL saturation/lightness gradients
- lerpColor between multiple color pairs
- Blend mode comparison: overlapping colored rectangles with each mode
- loadPixels → modify → updatePixels round-trip
- Pixel manipulation: invert colors, threshold filter

**Deliverable:** Full color and pixel system.

---

### Phase 6: Comparison Testing Framework

**Files:**
- `libraryIntegrationTetsts/p5_comparison_tests.ts` — test runner
- `libraryIntegrationTetsts/p5_test_sketches.ts` — shared test sketch definitions
- `libraryIntegrationTetsts/compare_renders.ts` — pixel diff utility

**Test sketch definition format:**
```typescript
interface TestSketch {
  name: string;
  width: number;
  height: number;
  draw: (api: DrawingAPI) => void;
}

// Example:
const basicShapes: TestSketch = {
  name: "basic-shapes",
  width: 400, height: 400,
  draw(p) {
    p.background(220);
    p.fill(255, 0, 0);
    p.rect(50, 50, 100, 80);
    p.fill(0, 0, 255);
    p.ellipse(300, 200, 120, 80);
  },
};
```

**Comparison pipeline:**
1. For each test sketch:
   a. Render with p5 + Skia → `.output/p5-reference/{name}.png`
   b. Render with P5GPU → `.output/p5gpu/{name}.png`
2. For each pair of PNGs:
   a. Load both as RGBA pixel arrays
   b. Compute per-pixel absolute difference
   c. Save diff image → `.output/p5-diff/{name}.png`
   d. Compute RMSE (Root Mean Square Error)
   e. Compute max pixel error
   f. Report pass/fail (RMSE < threshold, e.g., 5.0 on 0-255 scale)

**Comparison metrics:**
- **RMSE**: `sqrt(mean((refPixel - testPixel)²))` across all channels
- **Max error**: Largest single-channel difference
- **Diff pixels**: Count of pixels where any channel differs by > threshold
- **Visual diff**: Output image highlighting differences

**Expected acceptable error sources:**
- Anti-aliasing differences (Skia vs WebGPU MSAA)
- Sub-pixel positioning rounding
- Floating-point arithmetic differences
- These should all be small (RMSE < 5, max error < 20 for most tests)

---

## File Structure

```
apps/deno-notebooks/
  tools/
    p5gpu.ts                              # Main P5GPU renderer class
    p5gpu/
      state.ts                            # DrawState, state stack
      tessellate.ts                       # Shape → triangle tessellation
      stroke.ts                           # Thick-line expansion, caps, joins
      curves.ts                           # Bezier, Catmull-Rom utilities
      color.ts                            # Color parsing, HSB/HSL conversion
      shaders.ts                          # WGSL shader source
      earcut_triangulate.ts               # Earcut wrapper for polygon fill
    p5_deno_shim.ts                       # (existing) Skia-backed p5 shim

  libraryIntegrationTetsts/
    p5_test.ts                            # (existing) Windowed p5 test
    p5_test_headless.ts                   # (existing) Headless p5 test
    p5_test_sketches.ts                   # Shared test sketch library
    p5_comparison_tests.ts                # Dual-backend test runner
    compare_renders.ts                    # Pixel diff / RMSE utility
```

Alternatively, if keeping it simpler for Phase 1, the entire renderer can live in a single `tools/p5gpu.ts` file and split into submodules only when it grows large.

---

## Reusable Code from Existing Codebase

| What | Source | How to Reuse |
|---|---|---|
| Point generators (circle, ellipse, rect polygons) | `packages/power2d/core/point_generators.ts` | Import directly or copy pattern |
| Stroke mesh generation (miter math, normals) | `packages/power2d/core/stroke_mesh_generator.ts` | Reference algorithm; adapt for our simpler vertex format |
| Earcut triangulation | `npm:earcut@^3` (already in workspace deno.json) | `import earcut from 'earcut'` |
| GPU texture readback + PNG encode | `libraryIntegrationTetsts/raw-webgpu-helpers.ts` | Import `writeTextureToPng()` |
| Blit pipeline (texture → window surface) | `window/blit.ts` | Import `createBlitPipeline`, `blit` for windowed display |
| Window creation + event loop | `window/mod.ts` | Import `createGpuWindow` |

---

## Potential Challenges & Mitigations

| Challenge | Mitigation |
|---|---|
| Earcut requires flattened coords + holes array | Write a helper that collects vertex/contour data and formats for earcut |
| Miter joins can produce spiky artifacts at sharp angles | Implement miter limit (2× stroke weight); fall back to bevel |
| Round caps/joins need many triangles for smoothness | Adaptive segment count based on radius (min 8, scale with size) |
| Rounded rect corners are arcs + straight segments | Decompose into 4 corner arcs + 4 straight edges; tessellate each arc as a fan |
| Catmull-Rom with tightness parameter changes the basis matrix | Parameterize the matrix computation; test with multiple tightness values |
| WebGPU MSAA differs from Skia's AA | Compare with RMSE threshold (allow ~5/255 error); optionally disable AA on both |
| Blend modes like OVERLAY/HARD_LIGHT aren't expressible as GPU blend equations | Defer to Phase 5; implement with custom fragment shader that reads from previous frame |
| p5's `fill()` accepts CSS color strings, p5.Color objects, arrays | Build a robust color parser; handle common cases first (numeric args), add string parsing later |
| Vertex buffer grows unpredictably per frame | Grow-only strategy: track max size, only recreate buffer when exceeded |
| Alpha compositing order matters | Render in exact submission order (painter's algorithm, no depth buffer) |

---

## Running Comparison Tests

```bash
# Render all test sketches with both backends
cd apps/deno-notebooks
deno run --unstable-webgpu --unstable-ffi --allow-ffi --allow-read --allow-env --allow-write \
  libraryIntegrationTetsts/p5_comparison_tests.ts

# Output:
# .output/p5-reference/basic-shapes.png
# .output/p5gpu/basic-shapes.png
# .output/p5-diff/basic-shapes.png
# ...
# ── Results ──
# basic-shapes:        RMSE=1.2  max=8   PASS
# stroke-caps:         RMSE=3.4  max=18  PASS
# transforms:          RMSE=0.8  max=5   PASS
# concave-polygon:     RMSE=2.1  max=12  PASS
```

---

## Phase 1 Detailed Breakdown (First Implementation)

Since Phase 1 is the foundation, here's a more granular task list:

### 1a. P5GPU class skeleton
- Constructor: create device, output texture, shader module, pipeline, uniform buffer
- beginFrame(): reset vertex arrays, set background pending flag
- endFrame(): upload vertices, render, return texture
- dispose(): destroy resources

### 1b. State machine
- DrawState struct with defaults
- push/pop stack
- fill()/noFill()/stroke()/noStroke()
- Color parsing (numeric args only, RGB mode, normalize to [0..1])

### 1c. Transform system
- 3×3 affine matrix as Float32Array(6): `[a, b, c, d, tx, ty]`
- translate(x,y): `tx += a*x + c*y; ty += b*x + d*y`
- rotate(angle): multiply by rotation matrix
- scale(sx, sy): multiply by scale matrix
- shearX/shearY: multiply by shear matrix
- applyMatrix: multiply
- resetMatrix: identity
- transformPoint(x, y) → [x', y']: apply matrix to a point

### 1d. Filled shape tessellation
- rect: 4 corners → 2 triangles (handle rectMode)
- triangle: 3 points → 1 triangle
- quad: 4 points → 2 triangles
- ellipse/circle: center + N perimeter points → N triangles (fan) (handle ellipseMode)
- Each triangle: 3 vertices, each with position (transformed) + fillColor

### 1e. GPU pipeline
- WGSL shader (vertex: pixel→clip, fragment: pass-through color)
- Render pipeline with alpha blending (src-over)
- Vertex buffer layout: float32x2 (position) + float32x4 (color)
- Uniform: canvas size vec2f
- Render pass: clear to background color, draw all fill triangles

### 1f. Output + testing
- Return output texture from endFrame()
- Utility to save texture to PNG (reuse writeTextureToPng from raw-webgpu-helpers.ts)
- First comparison test: basic filled shapes

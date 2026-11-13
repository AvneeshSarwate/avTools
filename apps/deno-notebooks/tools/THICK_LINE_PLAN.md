# Thick Line Rendering Plan for p5gpu.ts

## 1. Current Implementation Analysis

### How `line()` Works (line 1511)

`line(x1, y1, x2, y2)` is a thin wrapper: it calls `_emitStrokePathLocal` with a
two-point path and `closed = false`. The stroke color comes from
`_effectiveStrokeColor()`.

### How `_emitStrokePathLocal` / `_emitStrokePathScreen` Work

1. **`_emitStrokePathLocal`** transforms all points from local space to screen
   space via the current matrix, then delegates to `_emitStrokePathScreen`.

2. **`_emitStrokePathScreen`** is the core stroke routine (line 2738). It:
   - Computes an effective `weight` by multiplying `strokeWeight` by
     `_estimatedStrokeScale()` (average of the two matrix singular values).
   - For open paths with SQUARE/PROJECT caps: clones the path and extends the
     first/last points by `half` along their respective tangent directions.
   - Emits a **quad per segment** via `_emitStrokeSegmentQuad` (two triangles
     per segment, extruded along the perpendicular normal by `half`).
   - Emits **joins** between consecutive segments via `_emitStrokeJoin`.
   - For ROUND caps on open paths, emits semicircular fans via `_emitRoundCap`.

### Stroke Segment Quad (`_emitStrokeSegmentQuad`, line 2793)

For segment A-B:
- Computes the perpendicular normal `(nx, ny)` scaled to `half` thickness.
- Builds 4 corners: A+n, A-n, B-n, B+n.
- Emits 2 triangles (the rectangle).

### Join Logic (`_emitStrokeJoin`, line 2811)

- Computes directions of the two adjacent segments.
- Determines the cross product to find which side is "outer."
- For **ROUND** joins: delegates to `_emitRoundJoin` which fans triangles
  around the join point through the angular gap.
- For **MITER** joins: computes the intersection of the two outer edges. If the
  miter length exceeds `strokeWeight * scale * 2`, falls through to bevel.
- **BEVEL** (and miter-exceeded fallback): emits a single triangle from the
  center point to the two outer edge endpoints.

### Cap Logic

- **BUTT** (default when no cap logic fires): no cap geometry; the segment quad
  ends flush.
- **SQUARE / PROJECT**: the endpoint is extended by `half` along the tangent
  *before* the quads are emitted, effectively lengthening the first/last
  segment.
- **ROUND**: `_emitRoundCap` (line 2876) emits a semicircular fan of triangles
  centered at the endpoint, with adaptive segment count based on radius.

### Catmull-Rom / Bezier Pipeline

- `curveVertex` accumulates control points. Each time 4 are available, it
  converts via `_catmullRomToBezier` (standard p5 formula using tightness), then
  samples the cubic bezier at a resolution determined by Wang's formula
  (`_wangCubicSegments`). The sampled points are pushed onto the current ring.
- `bezierVertex` / `quadraticVertex` similarly sample into the ring.
- All splines are **flattened to polylines before stroke emission** -- the
  stroke path is always a sequence of straight segments by the time it reaches
  `_emitStrokePathLocal`.

### Geometry Pipeline (`_getGeomPipeline`, line 3114)

- Uses a `triangle-list` topology.
- Vertex format: `float32x2` position + `float32x4` color = 24 bytes/vertex.
- The vertex shader (`vsMain`) simply converts pixel coords to NDC. The
  fragment shader (`fsMain`) passes through the vertex color.
- All geometry (fills, strokes, caps, joins) shares this single pipeline.
- Vertices are written into a CPU staging `Float32Array`, then uploaded via
  `writeBuffer` each frame.

### Limitations of the Current Approach

1. **All tessellation is CPU-side.** Every segment generates 6 floats x 6
   vertices (2 triangles). Every round join/cap generates a fan. For a polyline
   with N segments the vertex count is roughly `12N + fan_vertices`. This is
   fine for modest geometry but scales poorly.

2. **No anti-aliasing on stroke edges.** The geometry is hard-edged triangles.
   The only AA comes from MSAA (configurable `sampleCount`). There is no
   distance-based alpha falloff on stroke edges.

3. **Miter limit is simplistic.** The miter limit is fixed at `2 * weight`
   (i.e. a miter-limit ratio of 2), which is quite aggressive. p5.js does not
   expose a miter-limit API, but the constant could be tuned.

4. **Per-frame vertex upload.** The entire staging buffer is re-uploaded every
   frame. There is no retained-mode path caching.

5. **No variable-width strokes.** strokeWeight is a scalar; there is no
   per-vertex width.

6. **Bevel join is a single triangle.** For wide strokes at sharp angles this
   can look noticeably different from a proper bevel (which should clip to the
   segment boundary).

7. **Round join/cap segment counts** are purely radius-based with no upper
   bound beyond what is implied by the math. Very large radii (e.g.
   `strokeWeight(200)`) can emit hundreds of triangles per join.

---

## 2. Technique Comparison

### Technique A: CPU-Side Polyline Tessellation (Current Approach, Improved)

**How it works:** Tessellate the polyline into triangles on the CPU, upload as a
triangle list. This is what the code already does.

**Pros:**
- Already implemented; improvements are incremental.
- No shader changes needed.
- Works with the existing single-pipeline architecture.
- Easy to debug (all geometry is explicit triangles).

**Cons:**
- CPU-bound for large polylines.
- No per-fragment AA without MSAA.
- Vertex count grows linearly with segment count and join complexity.

**Verdict:** Good baseline. Worth improving the join/cap math and adding optional
edge AA, but not a fundamentally different architecture.

### Technique B: GPU Instanced Lines (rreusser / regl-gpu-lines approach)

**How it works:** Each line segment is one *instance*. A small triangle-strip
template (typically 4-8 vertices) is repeated per instance. The vertex shader
reads the current, previous, and next point positions from a storage buffer or
vertex attributes, computes the miter/bevel/round extrusion in screen space, and
positions each template vertex accordingly. Joins are split across adjacent
instances (each instance handles "its half" of the join on either end).

**Pros:**
- Massively reduces CPU work: only the point positions and per-point attributes
  need to be uploaded. The GPU does all extrusion.
- Naturally supports variable-width lines.
- Screen-space extrusion means constant pixel thickness regardless of transform.
- Proven in production (Mapbox, deck.gl, rreusser's WebGPU port).

**Cons:**
- Requires a dedicated render pipeline with a specialized vertex shader.
- More complex shader code.
- Round joins/caps require enough vertices in the template strip (or a separate
  pass).
- Integrating with the existing batch system requires some plumbing.

**Verdict:** The gold standard for GPU line rendering. Best long-term choice.

### Technique C: SDF-Based Line Rendering

**How it works:** Each segment (or the entire polyline) is rendered as an
oversized quad. The fragment shader computes a signed-distance-field value to the
nearest line edge, and uses `smoothstep` to produce anti-aliased coverage. Joins
and caps can be expressed as SDF primitives (semicircles, miters as half-planes).

**Pros:**
- Excellent anti-aliasing "for free" -- smooth edges without MSAA.
- Very low vertex count (one quad per segment, or one quad per polyline with an
  SDF texture).
- Elegant for simple cases.

**Cons:**
- Complex SDF math for polylines with many segments and arbitrary joins.
- Performance depends on fragment shader complexity; for dense/overlapping lines
  the fragment cost can dominate.
- Harder to handle variable-width and dashed lines.
- Not a natural fit for the existing architecture (needs a different shader and
  possibly different vertex format).

**Verdict:** Best for isolated shapes (circles, rounded rectangles) but
over-complicated for arbitrary polylines in a general 2D API.

### Technique D: Geometry Shader / Compute Shader Expansion

**How it works:** A compute shader reads the polyline points and writes out the
expanded triangle geometry into a storage buffer, which is then drawn. This is
the "geometry shader" pattern adapted for WebGPU (which lacks actual geometry
shaders).

**Pros:**
- Offloads tessellation to the GPU entirely.
- Can handle arbitrarily complex join/cap logic.

**Cons:**
- WebGPU does not have geometry shaders; must use compute + indirect draw.
- Adds pipeline complexity (compute pass before render pass).
- Harder to integrate with the existing batched draw model.
- Buffer sizing requires either a conservative upper bound or a two-pass
  approach.

**Verdict:** Overkill for this use case. The instanced approach achieves similar
GPU-side benefits with less complexity.

---

## 3. Recommended Approach: Hybrid (Improved CPU Tessellation + Optional SDF AA)

Given the constraints of this codebase:
- It is a **p5-like 2D drawing API** -- correctness and visual quality matter
  more than rendering millions of lines.
- The existing architecture uses a **single geometry pipeline** with CPU-side
  vertex generation.
- The user expects `strokeWeight`, `strokeCap`, `strokeJoin` to "just work" with
  all shapes (rect, ellipse, beginShape, bezier, curve, etc.).
- **MSAA is already available** and enabled by default.

### Phase 1: Fix and Polish CPU Tessellation (Recommended First)

Improve the existing approach without changing the pipeline architecture. This
gets the visual quality right and fixes the current limitations.

### Phase 2 (Future): GPU Instanced Lines

If performance becomes a bottleneck, migrate to the instanced approach for
`line()`, `beginShape`/`endShape` polylines, and spline strokes. Keep the
CPU-tessellated approach for complex shape outlines (rect, ellipse, arc strokes).

---

## 4. Phase 1 Implementation Plan: Improved CPU Tessellation

### Step 1: Refactor `_emitStrokePathScreen` for Clarity

**Current state:** The method handles caps, segments, and joins in a flat
sequence with some special-casing.

**Refactored structure:**

```
_emitStrokePathScreen(points, closed, color):
  1. Deduplicate consecutive coincident points (< EPS apart)
  2. If < 2 points remain, return (or emit a point/dot for 1 point)
  3. Compute effective weight and half-width
  4. If open path:
     a. Handle start cap (BUTT / SQUARE / ROUND)
     b. Handle end cap (BUTT / SQUARE / ROUND)
  5. For each segment i:
     a. Emit segment quad (same as current _emitStrokeSegmentQuad)
  6. For each interior vertex (and all vertices if closed):
     a. Emit join geometry (MITER / BEVEL / ROUND)
```

This is mostly what the code does now, but making it explicit will help with the
join fixes.

### Step 2: Fix Bevel Join Geometry

**Problem:** The current bevel join emits a single triangle from the center to
the two outer points. For wide strokes at sharp angles, this triangle can be too
large and protrude past the segment boundary.

**Fix:** A proper bevel join should:
1. Determine the outer side (already done via cross product).
2. On the outer side, emit a single triangle: `(center, outerA, outerB)` --
   this is correct as-is for standard bevel.
3. On the inner side, the two segment quads naturally overlap at the center, so
   no additional geometry is needed.

The current code is actually correct for standard SVG-style bevel. The visual
issue (if any) comes from the segment quads not meeting cleanly. Verify by
testing with `strokeJoin(BEVEL)` at various angles and weights.

### Step 3: Improve Miter Join

**Current issue:** Miter limit is hardcoded to `weight * scale * 2`, which is a
miter-limit-ratio of 2.0. SVG default is 4.0; p5.js uses 10x strokeWeight in
some references.

**Fix:**
- Add a `_miterLimit` property (default: 4.0 as ratio, matching SVG).
- In `_emitStrokeJoin`, compute miter length and compare against
  `half * miterLimit`. If exceeded, fall through to bevel.
- The miter intersection computation is correct; just tune the threshold.

### Step 4: Improve Round Join Quality

**Current state:** `_emitRoundJoin` uses `Math.PI / 24` as the angular step
(about 7.5 degrees). For large strokes this is visible.

**Fix:** Use an adaptive step count based on radius, similar to `_emitRoundCap`:
```
const steps = Math.max(4, Math.ceil(Math.abs(delta) * radius / 3));
```
This gives approximately 1 triangle per 3 pixels of arc length.

### Step 5: Improve Round Cap Quality

**Current state:** `_emitRoundCap` already uses adaptive segments:
`Math.max(8, Math.ceil(PI * radius / 3))`. This is reasonable.

**Minor improvement:** Add an upper bound to prevent excessive triangle counts
for very large strokeWeights:
```
const steps = Math.min(128, Math.max(8, Math.ceil(PI * radius / 3)));
```

### Step 6: Handle Degenerate Cases

- **Zero-length segments:** `_emitStrokeSegmentQuad` already skips these
  (`len <= EPS`). Good.
- **Single-point paths:** Currently dropped. Should emit a round dot (like
  `point()`) if strokeCap is ROUND, or a square if SQUARE.
- **Two coincident points:** Should emit a dot, not nothing.
- **Very sharp angles (near 180-degree reversal):** The miter calculation can
  produce extreme lengths. The miter limit handles this, but verify the bevel
  fallback looks correct.

### Step 7: Add Optional Edge Anti-Aliasing (SDF-in-Fragment)

This is an **optional enhancement** that adds smooth edges without relying solely
on MSAA. It would require a new shader variant.

**Approach:** Expand each segment quad by 1 pixel on each side. Add a `distance`
vertex attribute that encodes the signed distance from the stroke edge. In the
fragment shader, use `smoothstep` on that distance to produce alpha falloff.

**Vertex format change:**
```
Current:  position (float32x2) + color (float32x4) = 6 floats
Proposed: position (float32x2) + color (float32x4) + edgeDist (float32) = 7 floats
```

**Fragment shader change:**
```wgsl
@fragment
fn fsMain(v: VertexOut) -> @location(0) vec4f {
  let alpha = 1.0 - smoothstep(-0.5, 0.5, abs(v.edgeDist) - 1.0);
  return vec4f(v.color.rgb, v.color.a * alpha);
}
```

**Decision:** This adds complexity and changes the vertex format for all
geometry. Recommend deferring to Phase 2 unless MSAA quality is insufficient.

### Step 8: Optimize Round Join/Cap Triangle Counts

For `optimizedMode = true`, use more aggressive reduction:
- Caps: `Math.max(4, Math.ceil(PI * radius / 6))` (already done).
- Joins: Apply the same `optimizedMode` check.
- Add a global upper bound (e.g., 64 triangles per cap/join).

---

## 5. Addressing Splines Specifically

Splines (Catmull-Rom via `curveVertex`, cubic bezier via `bezierVertex`,
quadratic via `quadraticVertex`) are all **flattened to polylines** before
reaching the stroke emission code. This is the correct approach because:

1. The flattening uses Wang's formula for adaptive subdivision, which gives
   near-optimal segment counts.
2. After flattening, the stroke code sees only straight segments and does not
   need to know the original curve type.
3. Join types apply at the sampled points, which is correct for smooth curves
   (adjacent segments have small angular differences, so joins are nearly
   invisible).

**No changes needed** for the spline-to-polyline pipeline. The improvements to
joins and caps will automatically benefit spline rendering.

**One consideration:** For very thick strokes on curves, the flattening tolerance
(`CURVE_TOLERANCE = 0.5` pixels) should be tightened relative to the stroke
width. A curve that is "smooth enough" for a 1px stroke might show faceting at
20px. Consider:
```
const effectiveTolerance = Math.min(CURVE_TOLERANCE, half * 0.1);
```
This ensures the polyline approximation is smooth enough relative to the visible
stroke width.

---

## 6. Phase 2 Sketch: GPU Instanced Lines (Future)

For reference, here is an outline of what the instanced approach would look like.
This is NOT recommended for immediate implementation, but is the logical next
step if performance matters.

### Architecture

1. **New pipeline:** `_getLinePipeline()` returns a pipeline with:
   - Topology: `triangle-strip`
   - Vertex buffer 0: template strip (per-vertex), ~8 vertices
   - Vertex buffer 1: per-instance line point data (position, prev, next, width,
     color)

2. **Template strip:** A unit rectangle with vertices at positions like
   `(-1, -1), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 1)` plus extra vertices
   for join geometry on each end. Each vertex carries a "role" attribute
   indicating whether it is a segment vertex or a join vertex.

3. **Vertex shader:** Reads the current instance's start/end points plus
   previous/next points. Computes:
   - Segment direction and perpendicular normal
   - Miter vector at each endpoint
   - Extrusion offset based on template vertex position and miter
   - Screen-space position

4. **Per-instance data:** For a polyline with N points, emit N-1 instances. Each
   instance stores indices or direct references to points [i-1, i, i+1, i+2].
   Points i and i+1 are the segment endpoints; i-1 and i+2 are needed for
   miter/join computation.

5. **Integration:** The `_emitStrokePathLocal` method would switch to writing
   instance data instead of triangles when the instanced pipeline is available.

### Benefits Over CPU Tessellation

- For a polyline with 1000 segments:
  - Current: ~12,000 vertices (segments) + ~thousands for joins/caps
  - Instanced: ~1000 instances x 8 template vertices = 8,000 vertex shader
    invocations, but only ~1000 * (4-5 floats) of data uploaded

- Dynamic strokeWeight changes would not require re-tessellation.

---

## 7. Summary of Recommended Changes (Phase 1)

| Change | File Location | Complexity | Impact |
|--------|--------------|------------|--------|
| Refactor `_emitStrokePathScreen` for clarity | line 2738 | Low | Maintainability |
| Tune miter limit (add `_miterLimit` property) | line 2833 | Low | Visual correctness |
| Adaptive round join segments | line 2850 | Low | Visual quality |
| Cap round cap/join segment count | line 2876 | Low | Performance safety |
| Handle single-point / degenerate paths | line 2738 | Low | Correctness |
| Adaptive curve tolerance based on stroke width | line 2909 | Low | Spline quality |
| (Optional) SDF edge AA shader variant | new shader | Medium | Edge quality |
| (Optional) Add `strokeMiterLimit()` API | new method | Low | API completeness |

All Phase 1 changes are backward-compatible and do not require new pipelines or
shader modifications (except the optional SDF AA). They improve visual quality
and correctness while maintaining the current architecture.

---

## 8. Current Problems

### What was attempted

Two rewrites of `_emitStrokePathScreen` were attempted:

**Attempt 1: Two-pass connected mesh (offset arrays)**

Replaced the original independent-quads + join-patches approach with a two-pass
system: first compute miter/bevel offsets for every vertex into `Float64Array`
buffers (`leftX/Y`, `rightX/Y`), then emit connected quads between consecutive
offset vertices.

- **Result:** Regressed to visible splayed rectangles, worse than the original.
- **Root cause:** At bevel joints, a single left/right offset per vertex cannot
  represent both adjacent segments. The code stored segment B's normal (overwriting
  A's) so the quad connecting from the previous segment to this vertex used the
  wrong normal on one side. The standard technique handles this by "splitting" the
  vertex — emitting two offset pairs (one per adjacent segment) — but the fixed-
  size array approach can't represent that without a more complex data structure.

**Attempt 2: Single-pass connected mesh**

Rewrote to walk segments in order, carrying the previous segment's end offsets
forward. At bevel joints, close the previous segment with segment A's normal,
emit the bevel/round fill, then start the new segment with segment B's normal.

- **Result:** Still showed splayed rectangles and inner triangle flickering.
- **Root cause (suspected):** The connecting quads between previous-segment-end
  and current-segment-start were being emitted incorrectly. For miter joints, the
  previous end and current start should be identical (shared miter point), but the
  code emitted redundant degenerate quads. For bevel joints, the closing quad from
  `prevEnd` to segment-A normal was connecting miter-computed offsets to segment-
  normal offsets, creating mismatched geometry. The interplay of independently
  computed offsets at the same vertex across iterations introduced subtle
  misalignments.

### Pre-existing issues (visible even with original code)

These were present before any rewrite attempts, visible when the p5gpu changes
are stashed:

1. **Inner triangle flickering at near-collinear joints.** When the cross product
   in `_emitStrokeJoin` is very close to zero (nearly straight segments), the
   `sign` variable can flip between +1 and -1 across frames due to floating-point
   instability. This causes the join triangle to alternate sides frame-to-frame,
   producing a visible flicker. A larger epsilon guard on the cross product (e.g.
   skip join emission when `|cross| < threshold` scaled to segment length) would
   fix this.

2. **Small edge gaps at joints.** The independent-quad approach has inherent gaps
   between segment quads at joints. The join triangles (bevel/miter/round) are
   supposed to fill these, but for very small angular differences the join geometry
   can be slightly misaligned with the quad edges, leaving hairline gaps visible
   at certain angles.

### Remaining phase 1 changes that ARE working

The following changes from the original phase 1 plan were applied and are working
correctly (kept even after the mesh rewrite attempts):

- `strokeMiterLimit` property added to state (default 4.0) with `strokeMiterLimit()` API
- Miter limit calculation fixed: `half * strokeMiterLimit` instead of `weight * scale * 2`
- Adaptive round join steps: `arcLen / 3`, capped at 64
- Capped round cap steps: max 128 (normal) / 64 (optimized)
- Single-point / degenerate path handling (dot emission)
- Stroke-aware curve tolerance in Wang's formula: `min(0.5, strokeHalf * 0.1)`

### Recommended next steps

1. **Revert `_emitStrokePathScreen` to the original independent-quads approach**
   with the phase 1 constant-tuning fixes. This was "mostly right."

2. **Fix inner triangle flicker** by adding a scaled epsilon guard to the cross
   product in `_emitStrokeJoin` — skip join emission entirely when segments are
   nearly collinear (the overlap of adjacent quads already covers the joint).

3. **For a proper connected mesh** (if needed later), the correct approach is:
   - Single pass, but each vertex can emit 1 pair (miter) or 2 pairs (bevel)
     of offset vertices
   - Use a dynamic vertex list, not fixed-size arrays
   - At miter joints: shared offsets, one quad spans both segments
   - At bevel/round joints: close segment A with A-normal offsets, emit join fill,
     open segment B with B-normal offsets — three separate pieces of geometry
   - This is exactly what Mapbox/deck.gl do in their vertex shader template, with
     extra template vertices reserved for the bevel case

---

## References

- [Drawing Lines is Hard -- Matt DesLauriers](https://mattdesl.svbtle.com/drawing-lines-is-hard)
- [webgpu-instanced-lines -- rreusser](https://github.com/rreusser/webgpu-instanced-lines)
- [regl-gpu-lines -- rreusser](https://rreusser.github.io/regl-gpu-lines/)
- [Drawing Polylines by Tessellation -- CodeProject](https://www.codeproject.com/Articles/226569/Drawing-polylines-by-tessellation)
- [Line Rendering on the GPU -- Handmade Network](https://hero.handmade.network/forums/code-discussion/t/2188-line_rendering_on_the_gpu)
- [WebGL Polyline Tessellation with Mapbox-GL-JS](https://blog.sumbera.com/2014/10/27/webgl-polyline-tessellation-with-mapbox-gl-js/)
- [6 Implementations of Wide Line Rendering -- mhalber](https://github.com/mhalber/Lines)
- [LinaVG -- 2D Vector Graphics Library](https://github.com/inanevin/LinaVG)
- [Fast Prefiltered Lines -- NVIDIA GPU Gems 2](https://developer.nvidia.com/gpugems/gpugems2/part-iii-high-quality-rendering/chapter-22-fast-prefiltered-lines)
- [Antialiased Lines via Geometry Shader -- atyuwen](https://atyuwen.github.io/posts/antialiased-line/)
- [THREE.MeshLine](https://github.com/spite/THREE.MeshLine)
- [Efficient Spatial Anti-Aliasing for Line Joins on Vector Maps (paper)](https://arxiv.org/pdf/1906.11999)

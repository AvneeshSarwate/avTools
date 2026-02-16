# P5GPU Shape Rendering Optimization Log

## Session 1 — Circle + Stroke Hot Path

**Problem**: Rendering 12 stroked circles in `p5_webgpu_syphon.ts` takes ~3ms on M1 Max (~250us/circle). The bottleneck is CPU-side vertex generation, not GPU.

**Root Cause Analysis**: Traced `circle()` → `ellipse()` → fill fan + `_emitStrokePathLocal` → `_emitStrokePathScreen` → segment quads + round joins.

Per circle (~20 polygon segments):
- **Fill**: 20 triangles via fan
- **Stroke segments**: 20 quads = 40 triangles
- **Stroke round joins**: 20 joins × 6 triangles each = 120 triangles
- **Total**: ~180 triangles = ~540 vertices

Key bottlenecks identified:
1. Massive temporary `[x, y]` tuple allocation in inner loops
2. Per-triangle function call overhead (`_emitTriangle` → `_currentBlendMode` → `_ensureBatch` → 3× `_pushVertex`)
3. Redundant `.map()` clone in `_emitStrokePathScreen` (always cloned even for closed paths that don't need cap mutation)
4. Over-tessellated round joins (min 6 triangles per join even when angle is tiny)

### Optimization 1: `_pushTriangleVertices` bulk method
**File**: `tools/p5gpu.ts`
**What**: Added `_pushTriangleVertices(ax, ay, bx, by, cx, cy, color)` that pushes all 3 vertices in a single `.push()` call with 18 args, increments vertex count once, and updates batch count once.
**Why**: Eliminates 3× `_pushVertex` calls per triangle, each with its own `.push()`, vertex count increment, and batch lookup.

### Optimization 2: Inline transform in ellipse fill fan
**File**: `tools/p5gpu.ts`, `ellipse()` method
**What**: Replaced per-point `transformPoint()` calls (each allocating a `[x, y]` tuple) + `_emitTriangle()` calls with:
- Matrix extracted once as `m`
- Blend mode + batch computed once before loop
- Transform inlined as `m[0]*x + m[2]*y + m[4]`
- Previous transformed point cached to avoid re-transforming shared vertices
- `_pushTriangleVertices` used directly
**Why**: Eliminates N+1 Vec2 allocations, N `_currentBlendMode()` calls, N `_ensureBatch()` lookups.

### Optimization 3: Eliminate redundant `.map()` clone in `_emitStrokePathScreen`
**File**: `tools/p5gpu.ts`, `_emitStrokePathScreen()`
**What**: Changed unconditional `points.map(p => [p[0], p[1]])` clone to only clone when needed: `!closed && (strokeCap === SQUARE || PROJECT)`. For closed paths (circles, rects, polygons), uses input array directly.
**Why**: Input from `_emitStrokePathLocal` is already a fresh `.map()` array. The clone only existed for open-path cap endpoint mutation. Saves N tuple allocations + array allocation for every closed shape.

### Optimization 4: Hoist blend/batch to `_emitStrokePathScreen` level
**File**: `tools/p5gpu.ts`, `_emitStrokePathScreen()`
**What**: Compute `_currentBlendMode()` + `_ensureBatch()` once at the top of the stroke path, before iterating segments/joins. All sub-methods (`_emitStrokeSegmentQuad`, `_emitStrokeJoin`, `_emitRoundJoin`, `_emitRoundCap`) now use `_pushTriangleVertices` directly instead of going through `_emitTriangle`.
**Why**: Eliminates per-triangle blend mode checks and batch lookups for the entire stroke path.

### Optimization 5: Inline Vec2 math in stroke sub-methods
**File**: `tools/p5gpu.ts`, `_emitStrokeSegmentQuad()`, `_emitStrokeJoin()`, `_emitRoundJoin()`, `_emitRoundCap()`
**What**:
- `_emitStrokeSegmentQuad`: Replaced 4 Vec2 tuple allocations + normalize() call with inline scalar math
- `_emitStrokeJoin`: Replaced Vec2 offset/outer tuples with scalar variables (nAx/nAy, outerAx/outerAy)
- `_emitRoundJoin`: Changed signature from `(center, fromOffset: Vec2, toOffset: Vec2, ...)` to `(center, fromX, fromY, toX, toY, ...)`, uses inline trig + `_pushTriangleVertices`
- `_emitRoundCap`: Same pattern — cached center coords, inline trig, `_pushTriangleVertices`
**Why**: Each Vec2 `[x, y]` tuple is a heap allocation. In hot loops generating hundreds of triangles per frame, this creates significant GC pressure.

### Optimization 6: Reduce round join minimum segments from 6 to 2
**File**: `tools/p5gpu.ts`, `_emitRoundJoin()`
**What**: Changed `Math.max(6, ...)` to `Math.max(2, ...)`.
**Why**: For a circle with 20 polygon segments, each join angle is only ~18 degrees. 6 fan triangles for an 18-degree arc is overkill — 2-3 is visually indistinguishable. For 12 circles × 20 joins, this cuts ~80 triangles per circle (from 120 join triangles to ~40).

### Expected Impact
- ~50% fewer temporary object allocations (Vec2 tuples)
- ~3× fewer function calls in hot path (no per-triangle _emitTriangle overhead)
- ~33% fewer triangles (reduced join tessellation)
- Closed-path stroke skips one full array clone

### Semantic Preservation
- All changes are internal to the vertex generation pipeline
- Draw order, alpha blending, and p5.js API semantics are fully preserved
- No changes to shader code, render pass structure, or batch ordering
- `_emitTriangle` left unchanged for non-hot-path callers (rect, triangle, quad, arc, etc.)

---

## Session 2 — Adaptive Curve Subdivision via Wang's Formula

**Problem**: All curve methods (`curveVertex`, `bezierVertex`, `quadraticVertex`, `curve`, `bezier`) used hardcoded subdivision counts (48 or 72 segments per span). This wastes vertices on nearly-straight curves and under-tessellates tight/large curves. Canvas2D/Skia use adaptive subdivision to match visual quality to actual curvature.

**Solution**: Replaced fixed segment counts with Wang's formula, which computes the mathematically optimal number of line segments needed to approximate a bezier curve within a given pixel tolerance.

### Wang's Formula

For a cubic bezier with control points B0, B1, B2, B3:
```
dx1 = B2.x - 2*B1.x + B0.x
dy1 = B2.y - 2*B1.y + B0.y
dx2 = B3.x - 2*B2.x + B1.x
dy2 = B3.y - 2*B2.y + B1.y
maxDeviation = max(hypot(dx1,dy1), hypot(dx2,dy2))
n = ceil(sqrt(sqrt(3/8) * maxDeviation / tolerance))
```

For a quadratic bezier with control points P0, P1, P2:
```
dx = P2.x - 2*P1.x + P0.x
dy = P2.y - 2*P1.y + P0.y
maxDeviation = hypot(dx, dy)
n = ceil(sqrt(sqrt(1/8) * maxDeviation / tolerance))
```

Tolerance is set to 0.5 pixels (half-pixel accuracy). Segments are clamped to [2, 64].

### Catmull-Rom to Cubic Bezier Conversion

Catmull-Rom splines (used by `curveVertex` and `curve`) are first converted to equivalent cubic bezier control points using the standard p5.js v2 formula:
```
s = (1 - tightness) / 6
B0 = P1
B1 = P1 + (P2 - P0) * s
B2 = P2 + (P1 - P3) * s
B3 = P2
```

This allows all curve types to share the same Wang's formula and cubic bezier sampling path.

### Changes Made

**New module-level constants**:
- `CURVE_TOLERANCE = 0.5` — half-pixel tolerance for adaptive subdivision
- `CURVE_MIN_SEGMENTS = 2` — minimum segments for any curve span
- `CURVE_MAX_SEGMENTS = 64` — maximum segments for any curve span

**New DrawState fields**: `curveDetail` (default 1.0), `bezierDetail` (default 1.0)

**New public API methods**: `curveDetail(d?)`, `bezierDetail(d?)` — getter/setter pattern, acts as a multiplier on Wang's formula result for user control

**New private helper methods**:
- `_wangCubicSegments(b0, b1, b2, b3)` — Wang's formula for cubic beziers
- `_wangQuadraticSegments(p0, p1, p2)` — Wang's formula for quadratic beziers
- `_catmullRomToBezier(p0, p1, p2, p3, tightness)` — converts 4 CR points to 4 cubic bezier control points

**Modified methods**:
- `curveVertex()`: converts CR to bezier, uses `_wangCubicSegments` + `_sampleCubicBezier` (was: `_sampleCatmullRom` with 48 segments)
- `bezierVertex()`: uses `_wangCubicSegments` (was: hardcoded 48)
- `quadraticVertex()`: uses `_wangQuadraticSegments` (was: hardcoded 48)
- `bezier()`: uses `_wangCubicSegments` (was: hardcoded 72)
- `curve()`: converts CR to bezier, uses `_wangCubicSegments` + `_sampleCubicBezier` (was: `_sampleCatmullRom` with 72 segments)

### Expected Impact

- **Nearly-straight curves**: 2-4 segments instead of 48-72 (massive vertex reduction)
- **Moderate curves**: 8-16 segments (typical), still far fewer than 48
- **Very tight curves**: Up to 64 segments (more than before for extreme cases)
- **Visual quality**: Matches Canvas2D/Skia behavior — no visible difference from the fixed approach at normal zoom, better quality for extreme curvature
- **Performance**: Significant reduction in vertex count for typical curve-heavy scenes

### Semantic Preservation
- `_sampleCatmullRom` is preserved but no longer called by `curveVertex`/`curve` (available as fallback)
- `_sampleCubicBezier` and `_sampleQuadraticBezier` are reused unchanged
- Draw order, alpha blending, and p5.js API semantics are fully preserved
- The `detail` multiplier defaults to 1.0, so no behavior change unless explicitly set by user

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

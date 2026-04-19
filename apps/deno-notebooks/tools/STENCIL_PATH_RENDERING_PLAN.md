# Stencil Path Rendering Plan for p5gpu

## Context

The current `P5GPU` path renderer flattens curves to polylines, expands those
polylines into CPU-side triangle meshes, and draws the triangles directly into
the color target. This works for simple paths, but it differs from p5/Canvas2D
when a path overlaps itself:

- Stroke triangles can overlap and alpha-blend more than once.
- Join patches are local and do not know about later crossings.
- Fill triangulation uses `earcut`, which expects simple polygon rings and is
not a complete solution for self-intersecting filled paths.

p5's default 2D renderer delegates to Canvas2D, which rasterizes the complete
path with path-level fill/stroke rules. Matching that behavior while staying
pure WebGPU requires a path-level mask/stencil step rather than direct
per-triangle color blending.

## Research Notes

The most relevant established technique is "stencil, then cover" path rendering.
NVIDIA's NV_path_rendering documentation describes a two-step model: first update
stencil samples for the fill or stroke region, then render covering geometry that
colors only samples selected by stencil. The key property for strokes is that
the stencil stroke step can use `REPLACE`, making self-overlapping stroke
geometry order-independent for coverage before color is composited once.

References:

- NV_path_rendering FAQ:
  https://developer.download.nvidia.com/assets/gamedev/files/NV_path_rendering_FAQ.pdf
- GPU-accelerated Path Rendering:
  https://developer.download.nvidia.com/devzone/devcenter/gamegraphics/files/opengl/gpupathrender.pdf
- WebGPU specification:
  https://www.w3.org/TR/webgpu/

WebGPU supports the required primitives:

- Depth/stencil render attachments with stencil load/store operations.
- Stencil operations including `replace`, `zero`, `invert`,
  `increment-wrap`, and `decrement-wrap`.
- Stencil references via `GPURenderPassEncoder.setStencilReference()`.
- Renderable depth/stencil formats such as `stencil8` and
  `depth24plus-stencil8`.

## Clarifications From The Design Discussion

- The expensive part that can be naive `O(n^2)` is self-intersection detection,
  not curve flattening or stroke mesh generation.
- CPU flattening and stroke mesh generation are still roughly linear in the
  flattened segment count.
- Around 200 Catmull-Rom control points does not automatically require compute
  shaders. What matters is the flattened segment count and number of paths per
  frame.
- For long/complex paths, it is acceptable to skip exact self-intersection
  detection and route to stencil/cover by heuristic.
- Compute shaders may become useful later for GPU-side stroke expansion,
  intersection binning, or retained path data, but they are not needed for the
  first correctness pass.

## Target Architecture

Keep the existing direct triangle renderer for common simple cases. Add a second
path command path for complex or translucent paths:

```text
simple path:
  CPU tessellation -> direct color draw

complex/translucent/self-overlapping path:
  CPU tessellation -> stencil pass -> cover pass
```

The first implementation should focus on strokes. Filled self-intersecting paths
need winding-aware stencil fill and can follow once the command/resource plumbing
exists.

## Phase 1: Stencil-Cover Strokes

Goal: prevent a single stroke from alpha-blending with itself when its mesh
overlaps.

Pipeline:

```text
1. Generate the same stroke mesh used by the direct path.
2. Draw that mesh into stencil with `passOp: "replace"` and stencil reference 1.
3. Draw a conservative cover quad over the stroke bounds.
4. Cover pass uses stencil compare `equal`, colors once, and resets stencil to 0.
```

This fixes the largest visual mismatch for translucent or self-overlapping
strokes while preserving the current CPU mesh generation.

Recommended initial routing:

```text
Use direct draw when:
  - stroke alpha is 1
  - path is short
  - path is open/simple

Use stencil-cover stroke when:
  - stroke alpha < 1
  - flattened segment count is above a threshold
  - path is closed and complex
  - a debug/quality flag forces it
```

Initial heuristic:

```text
stencil stroke if color alpha < 1 OR (closed && segmentCount >= 64)
```

This deliberately avoids `O(n^2)` detection in the hot path. The `64`
threshold is intentionally low for the first implementation so closed spline
tests exercise the stencil path; tune it upward if timing shows the extra passes
cost too much for ordinary closed outlines.

## Phase 2: Fill Stencil For Complex Closed Paths

For nonzero winding fill:

```text
1. Flatten path to screen-space polyline.
2. Emit fan triangles from an anchor point to each edge.
3. Stencil front faces increment, back faces decrement.
4. Cover bounds where stencil != 0.
5. Reset stencil during cover.
```

Implementation detail: because the vertex shader maps screen-space y downward
into clip-space y upward, front/back orientation may be inverted. Add a small
bowtie test and swap increment/decrement if needed.

Keep `earcut` for simple non-self-intersecting fills until this is verified.

Initial routing:

```text
stencil fill if:
  - single-ring fill
  - fill alpha < 1, OR
  - ring length >= 64, OR
  - a cheap short-ring segment intersection check finds a crossing
```

Contour/hole fills stay on `earcut` until multi-ring winding semantics are
explicitly implemented.

## Phase 3: Optional Self-Intersection Detection

Do not begin with exact detection. Use routing heuristics first.

If exact detection becomes useful:

- `n < 300`: naive segment-pair checks are acceptable.
- `300 <= n <= several thousand`: use a CPU spatial hash / uniform grid broad
  phase.
- Very large or many paths: route to stencil/cover based on length and skip
  detection.

## Phase 4: Compute Shader Considerations

Compute shaders are not required for the first implementation.

Potential future compute tasks:

- GPU-side stroke expansion from path point buffers.
- Spatial binning for intersection detection.
- Prefix-sum allocation for variable join/cap output.
- Retained path baking for paths reused across frames.

Do not add compute until timing shows CPU flattening/tessellation is the
bottleneck. For a small number of 200-point splines, CPU-side path processing is
expected to be acceptable.

## Implementation Checklist

1. Add stencil texture resource management keyed by canvas size and sample count.
2. Add render pipelines:
   - direct geometry with optional stencil attachment compatibility
   - stroke stencil write pipeline
   - stencil cover pipeline
3. Extend draw batching into ordered draw commands so a stencil path can emit:
   - mask geometry range
   - cover geometry range
   - blend mode and color
4. Add helpers to emit a cover quad from path/stroke bounds.
5. Route selected strokes through stencil-cover.
6. Type-check `p5gpu.ts` and run the closed-curve visual test.
7. Add fill stencil only after stroke stencil is stable.

## Self-Validation Checklist

- Backend capability probe: create target stencil textures and matching
  pipelines/passes for the exact formats and sample counts.
- Minimal stencil microtest: one stencil mask triangle, one cover quad, read
  pixels back, and vary one pipeline field at a time.
- Renderer-path readback: instantiate `P5GPU`, render representative shapes
  offscreen, call `loadPixels()`, and assert nonzero coverage.
- Batch/order inspection: verify ordered batch kinds and vertex ranges when a
  mask/cover pair should be emitted.
- Semantic fill check: compare offscreen stencil fill pixels against a CPU
  nonzero-winding classifier for deterministic bowtie/star paths, ignoring
  boundary pixels.
- Validation scopes: wrap draw submission in WebGPU validation scopes and wait
  for `device.queue.onSubmittedWorkDone()`.
- Type checks: run `deno check` on `p5gpu.ts` and the active visual test sketch.

## Current Implementation Status

Stroke stencil plumbing exists in `p5gpu.ts` and automatic routing is enabled by
`ENABLE_STENCIL_STROKES = true`.

The first attempt caused blank frames in the windowed renderer. Suspected cause:
the implementation added a stencil attachment to the main render pass whenever
any stencil command was present, while the same pass also drew normal
geometry/text batches with pipelines that were created without matching
depth/stencil state.

The current implementation splits ordered drawing into render-pass runs:

```text
direct color batches -> normal render pass
stencil mask/cover batches -> stencil render pass
direct color batches -> normal render pass
```

This avoids mixing stencil and non-stencil pipelines in one pass. As a first
safety tradeoff, frames containing stencil stroke batches force `sampleCount = 1`
instead of MSAA. This avoids MSAA resolve/load complications across multiple
passes and should be revisited once stencil correctness is visually stable.

A headless Deno WebGPU probe on this machine showed that stencil textures are
available, but a `stencil8` pipeline/pass failed validation with the current
pipeline shape. `depth24plus-stencil8` texture creation and pipeline/pass
validation succeeded, so the implementation now standardizes on
`depth24plus-stencil8` instead of carrying a runtime format fallback.

The second blank-stroke issue was subtler: `depth24plus-stencil8` pipelines
validated without an explicit depth compare, but produced zero covered pixels on
this backend. A microtest showed that `depthCompare: "always"` is required when
using the depth/stencil format this way. Both stroke stencil pipelines now set
`depthCompare: "always"` and `depthWriteEnabled: false`.

Single-ring fill stencil is now implemented for translucent, long, or detected
self-intersecting rings. Fill cover uses `compare: "not-equal"` with stencil
reference 0. A first implementation accidentally reused reference 1 from stroke
cover, which drew the inverse of the intended mask. Offscreen bowtie and
self-intersecting star tests now match a CPU nonzero-winding classifier exactly
for non-boundary pixels.

## Open Questions

- Should stencil routing be automatic only, or exposed through an API/debug flag?
- Should all translucent strokes use stencil-cover, even when they are simple?
  This gives better single-path compositing but costs extra passes.
- Should closed fills use stencil more broadly than the current single-ring
  alpha/length/intersection heuristic?
- How should `eraseMode` interact with stencil-cover? The first implementation
  should likely keep erase paths direct until explicitly verified.
- How should contour/hole fills map onto winding stencil semantics while
  preserving the current p5-style contour behavior?

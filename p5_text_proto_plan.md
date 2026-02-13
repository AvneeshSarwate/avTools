Below is a proto “handoff doc” you can paste into a coding agent chat. It’s written to set goals + architecture + testing context without getting bogged down in line-by-line details.

---

## Project: p5.js-style renderer on Deno WebGPU textures

### Goal

Build a p5.js-compatible (or p5-inspired) 2D rendering backend that renders into **WebGPU textures owned by Deno’s WebGPU implementation**, so textures can be **zero-copy composed** with other WebGPU-based graphics libraries in the same stack.

* Primary goal: **visual and behavioral parity with p5.js Canvas2D output**, with “close enough” tolerance (especially for text).
* Secondary goal: **reasonable performance parity with browser p5.js**, with creative-coding usage patterns in mind (animated params, small-ish text blocks, frequent redraws).
* Explicit non-goal: using gfx/canvas/Skia as the final renderer (gfx/canvas is only a baseline), because it requires CPU readback to get pixels/bitmaps in current workflow.

### Scope (initial)

* Shapes (already mostly working): lines, rects, ellipses, arcs, fill/stroke, transforms, blend/alpha.
* Text rendering: `text()`, `textFont()`, `textSize()`, `textAlign()`, `textLeading()`, `textStyle()`, `textWeight()` (variable fonts), `textWidth()` + related metrics.
* Variable fonts: support animating axes in the draw loop (common in p5.js 2.x examples). Prefer “works well for creative coding” over perfect UI-text micro-optimizations.

### Constraints / Requirements

* GPU side MUST render into **Deno-owned WebGPU textures** (`GPUTexture` / render targets managed by the JS WebGPU device).
* Rust code via FFI must be CPU-side only (no submitting wgpu command buffers), because Deno’s WebGPU device/texture handles are not directly interoperable over FFI.
* Cross-platform: macOS, Windows, Raspberry Pi 5 (Linux aarch64). End-user build ergonomics should be “cargo build” friendly.

---

## High-level Architecture

### Split: Rust CPU text pipeline + Deno JS WebGPU rendering

**Rust (FFI helper, CPU-side only):**

* Font loading / management / fallback.
* Text shaping + layout + bidi.
* Glyph rasterization (into bitmap masks and/or RGBA for color glyphs).
* Output data for the renderer:

  * positioned glyph instances (quads)
  * atlas update rectangles + pixel payloads
  * text metrics (advance, bounds, ascent/descent, baseline)

Preferred Rust stack:

* **cosmic-text** for shaping/layout and overall ergonomics.
* swash/fontdb as used by cosmic-text (or accessed directly where needed).
* Goal is “easy builds,” not “pure Rust at all costs,” but default path should be minimal external toolchain burden.

**Deno JS (WebGPU renderer):**

* Own the WebGPU `GPUDevice`, `GPUQueue`, render targets, and command encoding.
* Maintain one or more atlas textures (A8 + optional RGBA).
* Upload glyph bitmaps into atlas textures using `queue.writeTexture` / staging buffers.
* Render text as instanced quads sampling the atlas in the same render pass as shapes.
* Allow interleaving: shapes → text → shapes within a single pass.

### Glyphon as architecture reference

* Clone `glyphon` repo locally and treat it as an implementation reference for:

  * glyph caching concepts / cache keys
  * atlas packing
  * batching/instance data layout
* Do NOT try to run glyphon’s GPU renderer directly; only copy the architectural patterns into the Deno WebGPU renderer.

### Caching as a separate module (tunable later)

Implement caching as a small, isolated subsystem with a clean interface so it can evolve:

* Start simple: single atlas, basic packer, small LRU.
* Include variable-font axes in cache keys (optionally quantized).
* Provide an alternative “dynamic/scratch” mode for always-changing animations (bounded memory).
* Keep policy decisions in one place (creative coding patterns differ from typical UI text).

---

## Text strategy (conceptual)

1. JS calls Rust helper with: text string, font selection, size, alignment, style/weight, variation axes (e.g. wght/wdth/opsz/etc), and any OpenType features needed for parity.
2. Rust returns:

   * `GlyphInstances[]`: per-glyph quad placement + UV rect references + per-run color/style
   * `AtlasUploads[]`: any missing/updated glyph rasters for the atlas
   * `Metrics`: advance, tight bounds, ascent/descent, baseline
3. JS uploads `AtlasUploads` into Deno-owned `GPUTexture` atlases.
4. JS draws glyph quads via a dedicated text pipeline in the active render pass.

Notes:

* Variable fonts: treat axes as part of the font instance key. For animated axes, accept that rasterization may be frequent; caching policy can be improved later.
* Aim for “browser-ish” behavior rather than perfect Skia internals.

---

## Testing and Baseline Strategy

### Visual regression harness (already exists, extend it)

Use a programmatic sketch runner to render the same sketch through:

1. **Custom Deno WebGPU backend** (the new renderer)
2. **gfx/canvas backend (Skia)** as a reference baseline

Then compare outputs via:

* image diff with tolerance thresholds (text will vary by platform and font rasterization)
* per-feature snapshots (shapes-only tests, text-only tests, mixed tests)

Important: Treat gfx/canvas/Skia as a *baseline reference*, not “ground truth.” Expect platform differences; use tolerant diffs.

### Text-specific tests

Add test cases covering:

* font selection/fallback (including bundled font option for consistency)
* text metrics (`textWidth`, ascent/descent) vs baseline within tolerance
* alignment/baseline correctness
* variable font axis animation: short strings updated every frame (p5-like)
* performance instrumentation: per-frame timing of shaping/raster/atlas upload counts

### Performance expectations

Target “loose parity with browser p5.js” for creative coding:

* short strings (<= ~100 chars) with animated axes should run smoothly on desktop; Pi 5 may require knobs (atlas size, quantization, dynamic mode).
* avoid unbounded cache growth; enforce limits.

---

## Deliverables (prototype phase)

1. Rust FFI helper exposing:

   * load/register font (from file bytes / path / URL-resolved bytes)
   * shape+layout+raster API returning instances/uploads/metrics
2. Deno JS text renderer:

   * atlas texture management
   * text pipeline and instanced quad rendering
   * integration with existing shape renderer (interleaving)
3. Separate caching module:

   * cache key definition includes variation axes
   * simple LRU + bounded memory
   * optional axis quantization setting
4. Expanded visual regression suite + performance logging.

---

## Agent instructions / working style

* Use local repo code as the source of truth for current renderer abstractions and test harness.
* Use cosmic-text docs and glyphon repo only as references; implement a minimal viable subset first.
* Keep modules cleanly separated:

  * `text_cpu` (Rust)
  * `text_cache` (JS or Rust—choose whichever makes integration simpler)
  * `text_gpu` / renderer integration (JS WebGPU)
* Prioritize correctness + deterministic behavior, then tune performance knobs.

---

If you want the agent to generate a detailed plan next, it should:

* map p5 text APIs to internal calls
* define the FFI structs and serialization strategy (buffer layout, zero-copy where possible)
* define atlas formats, packing, eviction
* outline shader/pipeline requirements for A8 and RGBA glyphs
* integrate into the existing render pass flow and the visual regression harness

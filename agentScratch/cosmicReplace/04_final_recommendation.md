# Final Recommendation: Should You Replace cosmic-text?

## TL;DR

**The original improvement plan is solid for the short/medium term. Fully replacing cosmic-text is feasible but is NOT the highest-ROI path right now.** The P0/P1 fixes from the plan (double-layout elimination, binary FFI protocol, LRU atlas eviction, layout caching) will give you 3-5x performance improvement with ~2 weeks of work. Replacing cosmic-text is a separate, larger project (~3-5 weeks) that solves a different problem (full variable axis support + eliminating double-shaping).

## The Three Subagent Analyses — Key Findings

### Finding 1: cosmic-text's Variable Axis Limitation is Real and Systemic (01_cosmic_text_architecture.md)

The limitation is baked into 5 layers of cosmic-text, not just one:

1. **`Attrs`** — only has `weight: Weight`, no arbitrary axes field
2. **`Font::new()`** — only passes `("wght", weight)` to skrifa axis location (line 141-143)
3. **`FontSystem::get_font()`** — cache key is `(fontdb::ID, Weight)`, different `wdth` values return same cached `Font`
4. **`CacheKey`** — includes `font_weight` but no other variation coordinates
5. **`swash_image()`** — only passes `wght` to the swash scaler

This is NOT a bug to fix upstream. It's an architectural decision. Changing it would require modifying core types (`Attrs` is `Clone + Hash + Eq` used everywhere) and the entire caching model.

### Finding 2: Your Code Already Bypasses cosmic-text for Most Hard Operations (02_text_engine_usage.md)

Looking at `lib.rs`, you already have direct swash/harfrust code for:
- **Axis-aware rasterization** (`rasterize_with_axes`, lines 429-502) — uses swash directly
- **Variable-font advance measurement** (`measure_advance_with_axes`, lines 528-610) — uses harfrust directly
- **Font metrics** (`measure_font_box_metrics`, lines 612-687) — uses swash directly
- **Glyph outline measurement** (`measure_glyph_outline_x_bounds`, lines 689-889) — uses swash directly

The ONLY thing cosmic-text still exclusively provides is:
1. **Font database** (fontdb — but this is a standalone crate)
2. **Shaping orchestration** (`Buffer.set_text` → harfrust — but you already call harfrust directly)
3. **Line breaking + word wrapping + alignment** (~500 lines in cosmic-text's `layout_to_buffer`)
4. **CacheKey generation** (subpixel binning logic)

### Finding 3: The Underlying Libraries All Support Full Variable Axes (03_direct_pipeline_feasibility.md)

- **swash** — full shaping AND rasterization with arbitrary axes via `Setting<f32>` on builders
- **harfrust** — full shaping with `ShaperInstance::from_coords()` accepting arbitrary normalized coordinates
- **skrifa** — variation-aware metrics via `font_ref.metrics(Size, &location)` with any axes
- **fontdb** — standalone crate, can be used independently

**The variable axis bottleneck is purely in cosmic-text's glue layer.**

### Finding 4: A New Contender — Parley (03_direct_pipeline_feasibility.md)

Parley (from linebender, the same folks behind xilem/vello) has `FontVariation` supporting arbitrary `(tag, value)` pairs by design. It provides layout, bidi, fallback, wrapping — all the things cosmic-text provides that you'd have to rebuild. However:
- Pre-1.0, API not stable
- Less battle-tested
- Designed primarily for the vello GPU renderer
- Would need evaluation to confirm end-to-end variable axis support actually works

## The Four Options, Ranked

### Option A: Implement the P0/P1 Fixes from the Original Plan (RECOMMENDED FIRST)
**Effort: ~2 weeks | Impact: 3-5x performance improvement**

These fixes are independent of whether you keep or replace cosmic-text:

| Fix | Effort | Impact |
|-----|--------|--------|
| Pre-allocated buffer (eliminate double-layout) | 4-6h | 40-60% layout speedup |
| Binary FFI protocol (eliminate JSON) | 4-6h | Major for 100+ char frames |
| LRU atlas eviction (eliminate full clear) | 4-8h | Eliminate frame stutters |
| Per-frame layout cache | 3-4h | 3-4x fewer FFI calls |
| Float32Array vertex buffer | 2-3h | Reduced GC pressure |
| Reuse ScaleContext for outlines | 30min | Free performance |
| Persist outline bounds cache | 1h | Free performance (especially with double-layout fix) |

The double-layout fix alone (pre-allocate 64KB buffer, only re-call on overflow) cuts your FFI cost nearly in half. Combined with the per-frame layout cache (same text+params = cached result), you eliminate ~75% of redundant work.

### Option B: Fork cosmic-text and Patch Variable Axis Support
**Effort: ~2-3 weeks | Impact: Eliminates double-shaping, enables full axis control**

Changes needed:
1. Add `variations: Vec<(Tag, f32)>` to `Attrs` (with proper Hash/Eq)
2. Thread variations through `Font::new()`, `FontSystem::get_font()`, `CacheKey`, `swash_image()`
3. Cache key changes from `(fontdb::ID, Weight)` to `(fontdb::ID, VariationCoords)`

**Pros:** Keeps all of cosmic-text's line breaking, bidi, fallback, wrapping
**Cons:** Must maintain a fork, core type changes are invasive, upstream unlikely to accept

### Option C: Build Direct Pipeline with swash (Skip cosmic-text entirely)
**Effort: ~3-5 weeks | Impact: Full control, full axis support, simpler architecture**

Build ~2000 lines replacing cosmic-text's core:
1. Font loading via fontdb (standalone)
2. Shaping via swash (has both shaping + rasterization, unified variation handling)
3. Layout: unicode-bidi + unicode-linebreak + custom wrapping (~500 lines)
4. Custom CacheKey with variation coordinate hash
5. Rasterization via swash (already done in your codebase)

**Pros:** No more double-shaping, full axis support, total control, simpler FFI boundary
**Cons:** Must reimplement font fallback (~400 lines), line breaking/wrapping (~500 lines), bidi integration (~100 lines)

### Option D: Evaluate and Adopt Parley
**Effort: ~1 week evaluation + ~2 weeks integration | Impact: cosmic-text-level features with axis support**

**Pros:** Gets you layout features for free with designed-in variable axis support
**Cons:** Pre-1.0, might not work end-to-end, dependency on a young library

## My Recommendation: A then B/C (Not D)

**Phase 1 (now, ~2 weeks):** Do Option A — the P0/P1 performance fixes. These are high-ROI, low-risk, and independent of the cosmic-text decision. They'll immediately solve your frame-rate issues.

**Phase 2 (after Phase 1, ~3-5 weeks):** Do Option C — build the direct pipeline. Here's why:

1. **You're already 60% there.** Your `lib.rs` already has direct swash + harfrust code for rasterization, metrics, outlines, and variable-font advance measurement. The remaining 40% is replacing `Buffer.set_text()` + `shape_until_scroll()` + `layout_runs()`.

2. **Your use case doesn't need cosmic-text's full feature set.** You're rendering creative/generative text in p5.js — you don't need rich text editors, vi mode, selection handling, or syntect integration. You need: shape a string with a font at specific axis values → get positioned glyphs → rasterize them.

3. **The "HarfRust double-shaping bridge" is the elephant in the room.** Even after the P0/P1 fixes, every variable-font layout call runs shaping TWICE — once through cosmic-text (ignoring non-weight axes), once through your direct harfrust code (to correct positions). Eliminating cosmic-text eliminates this entirely.

4. **swash can do both shaping and rasterization.** Using one crate for both means variation coordinates flow consistently through the whole pipeline. No more mismatch between how the shaper and rasterizer interpret axes.

5. **Line breaking/wrapping is ~500 lines of straightforward code for your use case.** You don't need BiDi (p5.js text is typically LTR), you don't need ligature-aware break suppression for coding fonts, and you don't need justified text. A simple word-wrapping implementation covers your needs.

**Skip Option D (Parley)** for now — it's too young, and you'd be trading one external dependency's limitations for another's growing pains. If parley matures to v1.0 by the time you need it, revisit.

## What This Means for Your Current Codebase

After Phase 1 (performance fixes), your `lib.rs` architecture looks like:

```
Current:
  cosmic-text (shaping, layout) → [double-shaping workaround] → swash (rasterization)

After Phase 2:
  fontdb (font loading) → swash (shaping + rasterization) → custom layout (~500 lines)
```

The `layout_to_json` function shrinks dramatically because:
- No more `Buffer.set_text()` / `shape_until_scroll()` / `layout_runs()` dance
- No more `measure_advance_with_axes()` double-shaping workaround
- No more JSON serialization (replaced by binary in Phase 1)
- Direct swash shaping gives you positioned glyphs with correct axis values in ONE pass

## Effort Breakdown for Phase 2 (Direct Pipeline)

| Component | Lines | Days | Notes |
|-----------|-------|------|-------|
| Font storage (wrap fontdb directly) | ~100 | 0.5 | Replace `FontSystem` wrapper |
| Shaping with swash (single-run) | ~150 | 1 | Replace `Buffer.set_text()` |
| Simple word wrapping | ~200 | 1 | Replace `shape_until_scroll()` |
| Text alignment (left/right/center) | ~100 | 0.5 | Replace cosmic-text alignment |
| Custom CacheKey with variation hash | ~80 | 0.5 | Replace `CacheKey::new()` |
| Rasterization (already done) | ~0 | 0 | `rasterize_with_axes` exists |
| Metrics (already done) | ~0 | 0 | `measure_font_box_metrics` exists |
| Outline measurement (already done) | ~0 | 0 | `measure_glyph_outline_x_bounds` exists |
| Integration + testing | ~300 | 3 | Validate against current output |
| **Total** | **~930** | **~6.5** | About 1.5 weeks of coding |

The big risk is validation — making sure the new pipeline produces identical (or acceptably similar) output to the current one. Budget 2x the coding time for testing and debugging.

## Files Written

- [01_cosmic_text_architecture.md](01_cosmic_text_architecture.md) — Deep analysis of cosmic-text's internals, dependency chain, and variable axis limitations (890 lines)
- [02_text_engine_usage.md](02_text_engine_usage.md) — Complete mapping of how lib.rs uses cosmic-text APIs, the double-layout pattern, HarfRust double-shaping, and what would need replacing (689 lines)
- [03_direct_pipeline_feasibility.md](03_direct_pipeline_feasibility.md) — Analysis of swash, harfrust, fontdb, parley, glyphon capabilities and the feasibility of building a direct pipeline (460 lines)
- [04_final_recommendation.md](04_final_recommendation.md) — This file: synthesized recommendation

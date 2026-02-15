# Revised Strategy: Replacing cosmic-text Given p5.js Analysis

## Executive Summary

The original plan overestimated the complexity of what needs replacing and underestimated the severity of the actual bottleneck. Three findings fundamentally change the picture:

1. **p5.js does almost nothing** -- it is a thin wrapper around `ctx.fillText()` and `ctx.measureText()`. No shaping, no bidi, no font fallback. Word wrapping is 50 lines of greedy `measureText()` calls.

2. **The bottleneck is 900 cosmic-text paragraph layouts per frame**, not redundant calls, not JSON overhead, not vertex allocation. Each `text("A", x, y)` call runs full `Buffer.set_text() + shape_until_scroll()`, which internally does bidi analysis, script detection, linebreak opportunities, font fallback, and harfrust shaping -- all for a single character.

3. **The P0 fixes (binary FFI, pre-alloc buffer, LRU eviction) made no measurable difference** because they optimized the wrong thing. The dominant cost is the sheer number of cosmic-text layout invocations, not per-invocation overhead.

---

## Q1: Do the Remaining P1 Fixes Make Sense?

### Per-frame layout cache: MARGINAL VALUE

The per-frame layout cache was designed to avoid redundant `_layoutText()` calls when `textWidth()`, `textAscent()`, etc. call `_layoutText()` for the same string within a frame.

For the 900-character LFO benchmark, each call is `text("A", x, y)` with a **different weight**. There are no separate `textWidth("A")` calls. The cache key would be `(text, family, fontSize, lineHeight, width, height, align, wrap, weight, style, axes)` -- and with 900 different weights, there would be 900 different cache keys and zero cache hits.

**Verdict: Will not help for this workload.** It could help if the user calls `textWidth()` and `text()` for the same string, but that is not the bottleneck.

### Float32Array vertex buffer: MARGINAL VALUE

Pre-allocating a typed array with a cursor instead of building `number[]` and copying would reduce GC pressure. But vertex construction is not the bottleneck -- cosmic-text's paragraph layout is. Even if vertex building were free, the 900 layout calls would still dominate.

**Verdict: Nice-to-have, 2-3 hours, will not move the needle on frame time.** Could be worth doing eventually for GC smoothness, but not a priority.

### Reuse ScaleContext for outlines: ALREADY DONE

The current `lib.rs` already stores `outline_scale_context` as a persistent field on `TextEngine` and uses `std::mem::replace` to avoid borrow conflicts. This was done in a previous round of fixes.

### Persist outline bounds cache: ALREADY DONE

The `outline_bounds_cache` is now stored on `TextEngine` as a persistent `HashMap` field, not a per-call local variable. This was also done previously.

### Bottom line on P1 fixes

The remaining P1 fixes (layout cache, Float32Array vertex buffer) are worth at most a few percent improvement in the steady-state benchmark. They are not wrong, but they are not the fix. The fix is reducing the number of cosmic-text layout calls from 900 to something much smaller, or replacing cosmic-text with something that can handle single-character shaping at trivial cost.

---

## Q2: How Does p5.js's Simple Word Wrap Change the Replacement Plan?

### What we thought we needed to replace

The original plan (document 04) estimated:
- Line breaking + word wrapping: ~500 lines, medium complexity
- Bidi integration: ~100 lines
- Font fallback: ~300-400 lines
- Total "glue" code: ~2000 lines

### What we actually need

p5.js 2.0 does:
- **Word wrapping**: 50 lines of greedy `measureText()` loop (`_lineate`)
- **Line breaking**: split on `\n` -- 5 lines
- **Height truncation**: count lines until `leading * i > height` -- 10 lines
- **Bidi**: delegates to `ctx.direction` -- we do not need it
- **Font fallback**: not applicable -- p5 uses one font at a time via CSS
- **Rich text spans**: not applicable -- p5 is single-font, single-style per `text()` call
- **Justification**: not supported in p5
- **Ligature-aware break suppression**: not needed

To match p5.js's feature set, the replacement needs:

| Feature | What p5 does | What our pipeline needs |
|---------|-------------|----------------------|
| `text(str, x, y)` | `ctx.fillText(str, x, y)` | Shape string -> glyph positions -> render quads |
| `text(str, x, y, w, h)` | Greedy word wrap via `measureText()` + `fillText()` per line | Shape words, accumulate widths, break on overflow, shape each line |
| `textWidth(str)` | `ctx.measureText(str).actualBoundingBoxLeft + .actualBoundingBoxRight` | Shape string -> compute outline bounds (already have this) |
| `textAscent()` | `ctx.measureText('_').fontBoundingBoxAscent` | Read font metrics (already have `measure_font_box_metrics`) |
| `textDescent()` | `ctx.measureText('_').fontBoundingBoxDescent` | Read font metrics (already have this) |
| `textWeight(w)` | `ctx.font = "w 16px Inter"` | Pass weight to shaper as variation axis |

### The crucial insight

cosmic-text's `Buffer.set_text() + shape_until_scroll()` does **all** of the following for every single `text("A", x, y)` call:

1. Parse text into `BidiParagraph` runs (unicode-bidi)
2. Detect scripts per character (unicode-script)
3. Find line break opportunities (unicode-linebreak)
4. Split into word-boundary spans
5. For each span: resolve font via `FontSystem` (font fallback, weight matching)
6. For each span: construct harfrust `ShaperInstance` (with only `wght`)
7. For each span: create `UnicodeBuffer`, push text, shape
8. Accumulate glyph advances, compute line widths
9. Line-break algorithm (wrapping, alignment)
10. Produce `LayoutRun` with glyph positions

For `text("A", x, y)` -- a single character with no wrapping -- steps 1-4 and 8-9 are pure waste. The character "A" has no bidi properties worth analyzing, no line break opportunities, no words to wrap. All we need is step 6+7: shape "A" with the font at the requested axes, get one glyph position.

### What the replacement actually looks like

For `text(str, x, y)` with no wrapping (the LFO benchmark case):

```
Input: "A", font_id, font_size, weight, axes
  1. Look up font data by font_id (fontdb)
  2. Build harfrust ShaperInstance with full variation coords (weight + all axes)
  3. Shape "A" -> get glyph_id + advance
  4. Build CacheKey (font_id, glyph_id, size, subpixel, axes_hash)
  5. Return positioned glyph
```

This is exactly what `measure_advance_with_axes()` already does (lines 535-617 of lib.rs), except it only returns the total advance width. The function already:
- Creates `harfrust::FontRef` from raw font data
- Creates `ShaperData` + `ShaperInstance` with full variation coords
- Creates `UnicodeBuffer`, pushes text, shapes
- Sums glyph advances

We just need to return the individual glyph IDs and positions instead of just the sum.

For `text(str, x, y, w, h)` with wrapping:

```
Input: "Hello world wraps here", font_id, font_size, weight, axes, max_width
  1. Split on "\n"
  2. For each line: split on spaces -> words
  3. For each word: shape word -> sum advances -> word_width
  4. Greedy accumulate: if line_width + word_width > max_width, start new line
  5. For each resulting line: shape the full line -> positioned glyphs
  6. Offset lines vertically by leading
```

This is ~100 lines of Rust, not ~500. We do not need unicode-linebreak (p5 only breaks on spaces in WORD mode and on every character in CHAR mode). We do not need bidi. We do not need font fallback (p5 uses one font).

---

## Q3: Revised Effort Estimate

### What exists already (no work needed)

| Component | Status | Lines in lib.rs |
|-----------|--------|----------------|
| Font loading via fontdb | Working | 84-94 |
| Variable-axis rasterization (swash) | Working | 436-509 |
| Variable-axis font metrics | Working | 619-694 |
| Variable-axis glyph outline bounds | Working | 696-896 |
| Axis parsing, hashing | Working | 939-992 |
| Cache key generation | Working | 987-992 |
| Binary FFI protocol | Working | 387-412, 1046-1059 |
| Rasterization mask extraction | Working | 994-1032 |

### What needs to change

#### A. New function: `shape_simple` (~80 lines)

A function that shapes a single string with a single font at specific variation coordinates and returns individual glyph positions (not just the advance sum). This is a generalization of `measure_advance_with_axes()`.

```rust
struct ShapedGlyph {
    glyph_id: u16,
    x_advance: f32,
    x_offset: f32,
    y_offset: f32,
    cluster: u32,
}

fn shape_simple(
    &self,
    font_id: fontdb::ID,
    text: &str,
    font_size: f32,
    weight: u16,
    axes: &[AxisSetting],
) -> Option<(Vec<ShapedGlyph>, f32)>  // glyphs + total advance
```

This is mostly copy-paste from `measure_advance_with_axes` (lines 535-617) with the closure returning `Vec<ShapedGlyph>` instead of `f32`.

**Effort: 2-3 hours.**

#### B. Replace `layout_to_binary` core (~150 lines changed)

Replace the `Buffer.set_text() + shape_until_scroll() + layout_runs()` block (lines 160-167 + 196-351 in current code) with:

1. If no width constraint: call `shape_simple()` once, position glyphs horizontally
2. If width constraint: implement greedy word wrap:
   - Split text on `\n` then on spaces (or per-character for CHAR mode)
   - For each word: `shape_simple(word)` -> get advance width
   - Accumulate widths, break lines on overflow
   - For each output line: `shape_simple(line_text)` -> get glyph positions
3. Apply horizontal alignment (left/center/right) -- a few lines of offset math
4. Compute vertical positions using `leading` per line

The current `layout_to_binary` is ~300 lines (from the start of `layout_to_binary` to the binary encoding). The replacement core logic would be ~150 lines. The binary encoding (lines 387-412) stays unchanged.

**Effort: 1-2 days.**

#### C. Remove cosmic-text Buffer dependency

After B, the `Buffer` field, `SwashCache` field, and all `cosmic_text::Buffer`/`Attrs`/`Shaping`/`Align`/`Wrap` imports become unused. Remove them.

The `TextEngine` struct shrinks to:
```rust
pub struct TextEngine {
    font_system: FontSystem,        // KEEP: still need fontdb for font data access
    scale_context: swash::scale::ScaleContext,
    outline_scale_context: swash::scale::ScaleContext,
    outline_bounds_cache: HashMap<GlyphOutlineBoundsKey, Option<(f32, f32)>>,
    glyph_records: HashMap<u64, GlyphRasterRecord>,
    axis_image_cache: HashMap<u64, RasterizedMask>,
}
```

Actually, `FontSystem` is only used for `font_system.db().with_face_data()` and `font_system.get_font()` (for the `as_swash()` call in rasterization). Since we can use `fontdb::Database` directly and create `swash::FontRef` from raw bytes, we could replace `FontSystem` with just `fontdb::Database`. But keeping `FontSystem` for now is fine -- the coupling is minimal.

**Effort: 1-2 hours (cleanup).**

#### D. Remove double-shaping workaround

The `run_requires_axis_advance_adjustment()` / `measure_advance_with_axes()` / `run_x_scale` block (lines 235-275 in current code) exists because cosmic-text shapes with wrong axis values and we have to re-shape to correct the advances. With `shape_simple()` doing shaping with correct axes from the start, the double-shaping workaround is eliminated entirely.

**Effort: 0 hours (it just goes away).**

#### E. Adapt rasterization path

The `rasterize_with_axes()` function currently uses `font_system.get_font()` + `.as_swash()` to get a swash `FontRef`. This can be changed to use `font_system.db().with_face_data()` + `swash::FontRef::from_index()` directly (the same pattern used by all the other direct-swash functions). This removes the dependency on `cosmic_text::Font`.

The non-axis path (`swash_cache.get_image()`) also goes away -- all rasterization goes through the axis-aware path (which handles the no-axes case fine by just using weight).

**Effort: 1-2 hours.**

#### F. Custom CacheKey

Currently we use `cosmic_text::CacheKey` and `CacheKey::new()` for subpixel binning. We need our own version. The subpixel binning logic in cosmic-text is straightforward -- it bins x and y fractional offsets into 4 bins (0, 0.25, 0.5, 0.75). Reimplementing this is ~30 lines.

```rust
#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
struct GlyphCacheKey {
    font_id: fontdb::ID,
    glyph_id: u16,
    font_size_bits: u32,
    x_bin: u8,      // 0-3 subpixel bin
    y_bin: u8,      // 0-3 subpixel bin
    axes_hash: u64,
    flags: u8,      // FAKE_ITALIC, etc.
}
```

**Effort: 2-3 hours.**

### Total effort estimate

| Task | Hours | Days |
|------|-------|------|
| A. `shape_simple` function | 2-3 | 0.3 |
| B. Replace layout core | 8-16 | 1-2 |
| C. Remove cosmic-text Buffer deps | 1-2 | 0.2 |
| D. Remove double-shaping (free) | 0 | 0 |
| E. Adapt rasterization path | 1-2 | 0.2 |
| F. Custom CacheKey | 2-3 | 0.3 |
| G. Testing + validation | 8-16 | 1-2 |
| **Total** | **22-42** | **3-5 days** |

This is roughly **one week**, compared to the original estimate of 3-5 weeks. The reduction comes from:
- Not needing bidi (saves ~100 lines and significant complexity)
- Not needing unicode-linebreak (saves ~200 lines)
- Not needing font fallback (saves ~300-400 lines)
- Word wrapping being ~50 lines instead of ~500
- Already having 60% of the direct-swash/harfrust code

---

## Q4: Batch Layout API -- Short-Term Fix Without Replacing cosmic-text?

### The idea

Instead of 900 individual FFI calls to `text_engine_layout_json`, provide a single FFI call:

```rust
fn batch_layout(
    &mut self,
    entries: &[(text, family, font_size, line_height, weight, style, axes, x, y)],
) -> Vec<BatchLayoutResult>
```

### Can this work with cosmic-text's Buffer API?

Technically yes, but with limited benefit. Here is why:

**What you save:**
- FFI crossing overhead (900 -> 1 Deno FFI calls)
- Axes JSON parsing (900 -> 1 parse, or N parses for N distinct axes configs)
- TypeScript<->Rust string encoding overhead
- Potentially some Rust function call overhead

**What you do NOT save:**
- cosmic-text's `Buffer.set_text()` must still be called for each distinct text+weight+axes combination. The Buffer is a single-paragraph container. You cannot batch multiple paragraphs into one Buffer.
- `shape_until_scroll()` must still run for each Buffer.set_text() call.
- The internal harfrust shaping (bidi + script + linebreak + shape) runs once per `set_text()` regardless of batching.

So a batch API would look like:

```rust
fn batch_layout(&mut self, entries: &[BatchEntry]) -> Vec<u8> {
    let mut results = Vec::new();
    for entry in entries {
        // Still runs the full cosmic-text pipeline for each entry
        self.buffer.set_text(&mut self.font_system, entry.text, &attrs, Shaping::Advanced, align);
        self.buffer.shape_until_scroll(&mut self.font_system, true);
        // ... collect glyphs ...
    }
    // ... encode all results into one binary response ...
    results
}
```

This saves FFI overhead but does NOT reduce the 900 cosmic-text layout calls. The FFI overhead was shown to be negligible by the P0 fix results -- binary FFI did not move the needle.

### Where batching WOULD help

If we replace cosmic-text with `shape_simple()`, then batching becomes powerful because:

1. **Shaper reuse**: harfrust `ShaperData` and `ShaperInstance` can be created once per (font_id, weight, axes) combination and reused for all entries with the same parameters. In the LFO benchmark, all 900 characters use the same font but different weights, so we would create ~900 shaper instances. BUT if weights are quantized (which they already are via `axis_quantization`), many entries share the same weight, reducing to maybe 50-100 shaper instances.

2. **Font data access**: `font_system.db().with_face_data()` is called once per shaper instance, not 900 times.

3. **Amortized allocation**: One `Vec<ShapedGlyph>` allocation reused across entries.

4. **Potential parallelism**: With the direct shaping approach, individual shaping calls are independent and could run on multiple threads. cosmic-text's `Buffer` is not `Send`/`Sync`.

### Recommendation on batching

**Do NOT implement batching as a standalone fix on top of cosmic-text.** It would save trivial FFI overhead (already proven negligible) while still running 900 full paragraph layouts.

**DO implement batching as part of the cosmic-text replacement.** Once shaping is done via `shape_simple()`, a batch API becomes the highest-leverage optimization:

```rust
fn batch_layout_simple(
    &mut self,
    entries: &[BatchEntry],  // Vec of (text, font_size, weight, axes, x, y)
) -> Vec<u8> {
    // Group entries by (font_id, weight, axes) to reuse ShaperInstance
    let mut groups: HashMap<(fontdb::ID, u16, u64), Vec<&BatchEntry>> = HashMap::new();
    // ... group ...

    for ((font_id, weight, axes_hash), group) in &groups {
        // Create ONE ShaperInstance for this (font, weight, axes) combo
        let instance = create_shaper_instance(font_id, weight, axes);
        for entry in group {
            // Shape each text with the shared instance
            shape_with_instance(&instance, entry.text);
        }
    }
}
```

For the LFO benchmark where most entries are `text("A", x, y)` with the same character but different weights, grouping by quantized weight would reduce the number of ShaperInstance creations dramatically.

### Batch API effort

| Task | Hours |
|------|-------|
| New FFI function signature | 1 |
| Binary encoding for batch input | 2 |
| Rust batch_layout_simple | 3 |
| TS batch calling code | 2 |
| Integration with p5gpu.ts draw loop | 3 |
| **Total** | **~11 hours (1.5 days)** |

This should be done AFTER the cosmic-text replacement (items A-F above), not before.

---

## Revised Plan

### Phase 1: Replace cosmic-text's layout pipeline (~1 week)

This is now the **only** recommended phase. The P1 fixes are not worth doing as a separate step because the real fix subsumes them.

1. **Write `shape_simple()`** -- generalize `measure_advance_with_axes()` to return per-glyph positions (2-3 hours)

2. **Replace `layout_to_binary` core** -- swap out `Buffer.set_text() + shape_until_scroll() + layout_runs()` with:
   - For no-wrap: `shape_simple()` -> position glyphs (30 lines)
   - For wrap: greedy word/char wrapping with `shape_simple()` per word for measurement, then `shape_simple()` per output line for final glyph positions (~80 lines)
   - Alignment: offset math for left/center/right (~20 lines)
   - Vertical positioning: `y += leading` per line (~10 lines)
   - Total: ~140 lines replacing ~200 lines of cosmic-text orchestration

3. **Custom CacheKey** -- replace `cosmic_text::CacheKey` with our own struct including axes_hash and subpixel binning (2-3 hours)

4. **Adapt rasterization** -- make all rasterization go through the axis-aware path, using `fontdb::Database` directly for font data (1-2 hours)

5. **Remove cosmic-text dependencies** -- strip `Buffer`, `SwashCache`, `Attrs`, `Shaping`, etc. Keep `fontdb` (standalone crate). Consider keeping `FontSystem` for convenience or replacing with raw `fontdb::Database`. (1-2 hours)

6. **Test and validate** -- compare output against current pipeline for:
   - Single character, various weights (LFO benchmark)
   - Multi-line wrapped text
   - Alignment modes
   - Tight width vs font width
   - Font metrics (ascent, descent, cap height)
   - Subpixel positioning

### Phase 2: Batch API (~1.5 days, after Phase 1)

7. **Add `batch_layout_simple` FFI function** -- takes array of (text, weight, x, y) tuples, returns all glyph positions in one binary response

8. **Group by shaper key** -- reuse `ShaperInstance` for entries with same (font_id, quantized_weight, axes)

9. **Integrate with p5gpu.ts** -- modify the draw loop to collect all `text()` calls and submit them as a batch at the end of the frame (or on flush)

### Expected performance impact

**Current state:** 900 calls x (FFI overhead + cosmic-text full paragraph layout + double-shaping + outline measurement) per frame.

**After Phase 1:** 900 calls x (FFI overhead + direct harfrust shaping + outline measurement) per frame. The harfrust shaping for a single character is dramatically cheaper than cosmic-text's full pipeline because it skips bidi analysis, script detection, line break computation, font fallback resolution, and Buffer management. Estimated: **3-5x improvement**.

**After Phase 2:** 1 FFI call x (N shaper instance creations + 900 direct shapings + outline measurement). With weight quantization, N might be 50-100 instead of 900. Plus: no FFI crossing overhead per character. Estimated: **additional 2-3x improvement on top of Phase 1**.

**Combined estimate: 6-15x improvement over current state.** This should bring the native pipeline into the same ballpark as Canvas2D `fillText()`, which is the target.

---

## What About cosmic-text's Full Feature Set?

We are explicitly choosing NOT to support:
- Bidi (RTL) text
- Font fallback (missing glyph -> try another font)
- Justified alignment
- Rich text (per-span attributes within a single `text()` call)
- Ligature-aware line break suppression
- Tab stops
- Shape plan caching (will add if profiling shows it matters)

This is fine because p5.js does not support any of these either (except delegating bidi to the browser, which users rarely use in creative coding contexts).

If any of these become needed in the future, they can be added incrementally:
- Font fallback: ~200 lines (iterate `fontdb::Database::faces()` by family, try each)
- Bidi: add `unicode-bidi` crate, split text into directional runs before shaping
- Justified alignment: distribute extra space across word gaps after wrapping

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Shaping quality regression (wrong glyph positions) | Medium | Validate against current output with pixel-diff tests |
| Subpixel positioning mismatch | Medium | Reimplement cosmic-text's SubpixelBin logic exactly |
| Missing kerning/ligatures | Low | harfrust handles these via GPOS/GSUB, same as cosmic-text |
| Word wrapping edge cases | Low | p5's algorithm is trivial; match it exactly |
| ShaperInstance creation overhead | Medium | Profile; if expensive, cache instances by (font_id, quantized_weight, axes_hash) |
| Font metrics differences | Low | Already using direct swash metrics; no change |

### Highest risk: ShaperInstance creation cost

The `measure_advance_with_axes()` function creates a new `ShaperData` + `ShaperInstance` on every call. For 900 calls per frame, this could be expensive. The fix is straightforward: cache `ShaperData` per font_id (it is font-specific, not weight-specific) and cache `ShaperInstance` per (font_id, quantized_weight, axes_hash) with an LRU.

This is a natural part of the Phase 2 batch API but could be added in Phase 1 if profiling shows it matters.

---

## Files That Change

| File | Change |
|------|--------|
| `native/text_engine/src/lib.rs` | Major rewrite of `layout_to_binary`, new `shape_simple`, custom CacheKey, simplified rasterization |
| `native/text_engine/Cargo.toml` | Potentially simplify cosmic-text features or replace with direct fontdb + harfrust + swash deps |
| `tools/p5gpu_text/ffi.ts` | No change needed for Phase 1 (same FFI interface). Phase 2 adds batch function. |
| `tools/p5gpu_text/atlas.ts` | No change needed (glyph keys remain u64 hashes). |
| `tools/p5gpu.ts` | Phase 2: collect text() calls for batching. |

---

## Summary

| Question | Answer |
|----------|--------|
| Do P1 fixes help? | No -- layout cache has zero hits for this workload, vertex buffer is noise |
| How does p5's simplicity change the plan? | Drastically -- we need ~150 lines of layout code, not ~2000 |
| Revised effort? | ~1 week (down from 3-5 weeks) |
| Batch API without replacing cosmic-text? | Not worth it -- FFI overhead is not the bottleneck |
| Batch API after replacing cosmic-text? | High value -- amortize ShaperInstance creation, 1.5 days additional |
| Expected speedup? | 6-15x combined (Phase 1 + Phase 2) |

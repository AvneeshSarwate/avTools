# Font Axis Quantization Plan

## Problem Statement

Profiling of the 900-character LFO benchmark (`p5gpu_text_lfo_perf.ts`) shows that **58% of frame time (~11.4ms out of ~19.5ms)** is spent in atlas operations. The root cause: each character's font weight changes every frame via a sinusoidal LFO producing values across the 300--900 range. Because the glyph cache key incorporates the exact weight value, nearly every glyph is a cache miss every frame (~650--700 misses out of ~971 glyph lookups). This triggers re-rasterization (5.5ms) and GPU re-upload (4.8ms) every frame.

The solution: **quantize continuous axis values to a coarser grid** before they enter the cache key path, so that small weight changes collapse to the same cache key and the atlas can serve hits instead of re-rasterizing.

---

## 1. Research Findings

### 1.1 How Chrome/Chromium Handles Font Caching

Chromium's Blink renderer uses a `FontDescription` class with a `BitFields` struct that packs font properties into bit fields for cache key construction. The `FontCacheKey` is derived from `FontDescription` plus `FontFaceCreationParams`. Key observations:

- **Font weight is stored as a CSS keyword-scale integer** (`fontdb::Weight(u16)` in our Rust code, corresponding to CSS's 100--900 range). Chromium's `FontDescription` stores weight in a compact bit field.
- **Skia's glyph cache** (SkGlyphCache) uses `SkScalerContextRec` + `SkDescriptor` as the cache key. Variable font axis coordinates are passed through `SkFontArguments::VariationPosition::Coordinate` and incorporated into the scaler context. Skia does NOT quantize axis values -- it treats them as exact f32 coordinates. Each unique set of axis coordinates produces a distinct typeface instance.
- **FreeType** (used by Chromium for variable font rasterization on platforms without native support) also treats variation coordinates as exact values. The ppem (pixels per em) is rounded to the nearest integer, but axis coordinates are not rounded.
- **Implication**: Browsers do not animate font-weight in CSS at the frame level, so they have never needed axis quantization. Our use case (per-frame LFO-driven weight animation in a creative coding context) is novel and requires a custom solution.

**Sources**: [Chromium font platform code](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/platform/fonts/), [Skia SkFontHost_FreeType.cpp](https://github.com/google/skia/blob/main/src/ports/SkFontHost_FreeType.cpp), [Variable Fonts in Chrome (WebEngines Hackfest)](https://webengineshackfest.org/2018/slides/variable-fonts-in-chrome-by-behdad-esfahbod-and-dominik-rottsches.pdf)

### 1.2 How p5.js Handles Font Caching (WebGL)

p5.js v2's WebGL text renderer uses a completely different approach from bitmap rasterization:

- **Geometry-based rendering**: Glyphs are converted to bezier curve data, packed into texture atlases (ImageData), and rendered via a fragment shader that evaluates the bezier curves analytically. This is resolution-independent and does NOT involve bitmap rasterization.
- **Cache key for font info**: `JSON.stringify(axs)` where `axs` is the array of variation axis values. A `FontInfo` object (containing glyph grid/stroke textures) is created per unique axis combination.
- **Glyph cache**: `glyphInfos[glyph.index]` -- indexed by glyph ID only, NOT by weight. Since the geometry approach renders curves analytically, the same glyph geometry works at any weight because the curve data adapts.
- **No weight quantization**: p5.js does not quantize because its shader-based approach does not rasterize per-weight bitmaps.
- **LRU eviction**: `maxCachedGlyphs = 200` glyph texture sets, evicted LRU when exceeded.
- **Variable font axes**: `_currentAxes(renderer)` reads `renderer.states.fontWeight` for the `wght` axis and current `fontVariationSettings` for other axes.

**Key takeaway**: p5.js's approach sidesteps the problem entirely by using analytical curve rendering. Our pipeline rasterizes to bitmap, so we must solve the caching problem directly.

**Source**: `/Users/avneeshsarwate/agentCombine/avTools/clonedCompanionRepos/p5.js/src/webgl/text.js`, `/Users/avneeshsarwate/agentCombine/avTools/clonedCompanionRepos/p5.js/src/type/p5.Font.js`

### 1.3 Game Engine / Creative Tool Approaches

- **Warp Terminal**: Cache key is `(font_id, glyph_id, font_size, sub-pixel_bin)`. Sub-pixel positions are quantized to 3 bins (0.0, 0.33, 0.66). Variable font weight is NOT part of their cache key because they target monospace terminal fonts at fixed weight. [Source](https://www.warp.dev/blog/adventures-text-rendering-kerning-glyph-atlases)
- **fontstash / Font-Stash**: Caches by `(font_id, glyph_id, font_size, blur)`. No variable font support. [Source](https://github.com/memononen/fontstash)
- **etxt (Ebitengine)**: Caches by font size and glyph ID. Variable fonts are not directly supported. [Source](https://github.com/tinne26/etxt)
- **Unreal Engine**: Uses "Composite Font" (runtime SDF) and offline font atlas approaches. Variable font axis animation is not a target use case.
- **SDF approaches** (Signed Distance Fields): Weight-independent because the SDF is generated from outlines. Weight changes require re-generating the SDF. Some implementations pre-generate multiple weight variants.

**Common pattern**: All production glyph atlas systems quantize at least sub-pixel position (typically 2--4 bins). None of them handle continuous variable-font axis animation because it is an unusual use case. Our system already quantizes sub-pixel position to 4 bins (SubpixelBin::Zero/One/Two/Three). We need to extend the same principle to weight and other axes.

### 1.4 Perceptual Weight Thresholds

Research from Bigelow & Holmes (Lucida Fonts) on the Just Noticeable Difference (JND) for font weight:

- **JND for weight: ~3%** of stroke width. At weight 400 (Regular), a 3% change corresponds to ~12 CSS weight units. At weight 700 (Bold), 3% corresponds to ~21 CSS weight units.
- **"Definitely noticeable" (semantic) difference: 1.3--1.5x** the normal weight. This is the threshold for perceiving "this text is bolder" rather than "this text is slightly different."
- **Weight is NOT perceptually linear**: The OpenType weight axis (100--900) maps to stroke width, but perceptual weight difference follows Weber's Law -- the JND is proportional to the current value. A 20-unit change at weight 200 is more noticeable than a 20-unit change at weight 700.
- **At 40px size**: Fine weight details are more visible than at 12px. However, in animated contexts (LFO modulation), the eye tracks motion rather than absolute weight, making quantization artifacts less perceptible.
- **CSS standard weight names** are spaced by 100 units (Thin=100, Light=300, Regular=400, Medium=500, SemiBold=600, Bold=700, Black=900), suggesting that differences of 100+ units are "obviously different" and differences under 100 units are refinements.

**Source**: [Lucida Fonts - On Font Weight](https://lucidafonts.com/blogs/bigelow-holmes-blog/typeface-weights-1), [W3C Font Characteristics Contrast](https://www.w3.org/WAI/GL/WCAG3/2020/methods/font-characteristics-contrast/)

---

## 2. Quantization Strategy

### 2.1 Where Quantization Currently Happens

The system already has an `axisQuantization` parameter that flows through three layers:

1. **TS state**: `_state.textAxisQuantization` (default: `1`) stored in P5GPU
2. **TS cache key** (ffi.ts line 262): `axisQuantization` is included in the string cache key but the weight is already `Math.round(req.weight)` -- so effectively weight is quantized to integer steps (step=1).
3. **Rust `parse_axes()`** (lib.rs line 1557--1594): Applies `(val / quantization).round() * quantization` to axes from the `axes` JSON. However, this only applies to explicit axes (e.g., `{ wght: 456 }`), NOT to the `weight` parameter itself.
4. **Rust `CacheKey`** (lib.rs line 74--109): Contains `font_weight: u16` directly (integer). The `hash_glyph_key()` function hashes the CacheKey + axes_hash.

**Critical gap**: The `weight: u16` field in CacheKey is derived from `Math.round(req.weight)` and passed as the FFI `weight` parameter. It is NOT subject to `axisQuantization`. Meanwhile, the `axes` JSON may also contain `wght` which IS quantized. But the `weight` field and `wght` axis both influence rasterization independently (the Rust code applies weight via `font_weight` if no `wght` axis is present in axes, or via the axes if `wght` is present).

### 2.2 Proposed Quantization Approach

#### Core Principle: Quantize Early, Quantize Once

Apply quantization on the TS side before constructing cache keys and before the FFI call. This ensures both the TS layout cache and the Rust glyph/raster caches see the same quantized values.

#### Quantization Formula

For each axis value `v` with quantization step `q`:
```
quantized = q <= 0 ? v : Math.round(v / q) * q
```

For weight specifically, we also need to clamp to the valid range [1, 1000] after quantization.

#### Default Step Sizes

Based on the perceptual research:

| Axis | Default Step | Rationale |
|------|-------------|-----------|
| `wght` (weight) | **20** | At 3% JND, weight 400 has JND~12, weight 700 has JND~21. A step of 20 is close to the JND across most of the useful range (300--900). In animated contexts, 20 is conservative (imperceptible). |
| `wdth` (width) | **5** | Width changes are less common in animation. 5% is a reasonable step. |
| `opsz` (optical size) | **2** | Optical size is typically set once per text block, rarely animated. |
| `ital` (italic) | **0.1** | Italic is binary in practice (0 or 1), but partial italic exists in some fonts. |
| All others | **1** | Generic default for unknown axes. |

The weight default of 20 means a sinusoidal LFO sweeping 300--900 produces `(900-300)/20 + 1 = 31` unique weight values instead of 601. With 900 characters, that is `900 * 31 = 27,900` maximum unique glyph keys -- well within the atlas capacity.

#### Non-Linear Quantization: Not Needed

While Weber's Law suggests the JND is proportional to the absolute value (favoring logarithmic quantization), the practical benefit is marginal:

- At weight 200, JND~6, so step=20 is ~3x the JND. Slightly wasteful but acceptable.
- At weight 800, JND~24, so step=20 is slightly below the JND. Optimal.
- A logarithmic scheme would use step~6 at weight 200 and step~24 at weight 800, saving some atlas space at the low end but adding complexity.
- **Decision**: Use linear quantization with step=20. The simplicity benefit outweighs the ~15% atlas efficiency loss at low weights. Users who need finer control at specific weight ranges can set a smaller step.

### 2.3 Per-Axis Configuration

Rather than a single `axisQuantization` number, we need a per-axis configuration. The API should allow:

```typescript
// Current (single number for all axes):
p.textAxisQuantization(20);

// New (per-axis object, with fallback default):
p.textAxisQuantization({ wght: 20, wdth: 5, _default: 1 });

// New (single number still works -- applied to all axes including weight):
p.textAxisQuantization(25);

// Disable quantization entirely:
p.textAxisQuantization(0);
```

---

## 3. API Design

### 3.1 P5GPU State

```typescript
interface P5GPUState {
  // ... existing fields ...
  textAxisQuantization: number | Record<string, number>;
  // number: applied uniformly to all axes AND to the weight parameter
  // Record: per-axis steps. "_default" key for fallback. "wght" controls weight quantization.
}
```

Default value: `{ wght: 20, wdth: 5, opsz: 2, _default: 1 }`

### 3.2 Public API Methods

```typescript
class P5GPU {
  /**
   * Get or set axis quantization for text rendering cache.
   *
   * Controls how font variation axis values (including weight) are rounded
   * before being used as glyph cache keys. Higher values = fewer unique
   * cache entries = better performance, but coarser visual fidelity.
   *
   * @param step - A number (applied to all axes) or an object with per-axis
   *   steps. Use 0 to disable quantization. Special key "_default" sets
   *   the fallback for unlisted axes.
   * @returns Current setting when called with no arguments.
   *
   * @example
   * // Good default for animated weight (20 weight units per step):
   * p.textAxisQuantization({ wght: 20 });
   *
   * // Coarser quantization for maximum performance:
   * p.textAxisQuantization({ wght: 50, wdth: 10 });
   *
   * // Disable all quantization (exact values, worst cache performance):
   * p.textAxisQuantization(0);
   *
   * // Single value for all axes:
   * p.textAxisQuantization(25);
   */
  textAxisQuantization(step?: number | Record<string, number>): number | Record<string, number> | void;
}
```

### 3.3 Backward Compatibility

- The current API `textAxisQuantization(step: number)` passes a single number.
- The current default is `1` (integer rounding only).
- **Change**: The new default will be `{ wght: 20, wdth: 5, opsz: 2, _default: 1 }`.
- When a single number is passed, it is applied as the step for ALL axes (same as current behavior but now also applies to the `weight` parameter, not just the `axes` JSON).
- When an object is passed, each axis gets its own step. Missing axes use `_default` (which defaults to `1` if not specified).

### 3.4 No Separate `textWeightQuantization()` Method

Weight quantization is just axis quantization for the `wght` axis. A separate method would fragment the API. The `textAxisQuantization` method handles it uniformly.

---

## 4. Implementation Details

### 4.1 TS Side (p5gpu.ts) -- Quantize Before FFI

The quantization must happen BEFORE constructing the `TextLayoutRequest` object, so both the TS-side layout cache key and the Rust-side cache keys see the same quantized values.

**Location**: `P5GPU._layoutText()` method (around line 1878)

**Pseudocode**:

```typescript
private _layoutText(text: string, width: number | null, height: number | null): TextLayoutResult {
  // ... existing setup ...

  const resolvedWeight = this._resolvedTextWeight();
  const quantConfig = this._state.textAxisQuantization;

  // Resolve per-axis quantization config
  const getAxisStep = (tag: string): number => {
    if (typeof quantConfig === "number") return quantConfig;
    return quantConfig[tag] ?? quantConfig._default ?? 1;
  };

  // Quantize weight
  const wghtStep = getAxisStep("wght");
  const quantizedWeight = wghtStep > 0
    ? Math.max(1, Math.min(1000, Math.round(resolvedWeight / wghtStep) * wghtStep))
    : resolvedWeight;

  // Quantize axes
  const rawAxes = this._resolvedTextAxes(resolvedWeight);
  const quantizedAxes: Record<string, number> = {};
  for (const [tag, value] of Object.entries(rawAxes)) {
    const step = getAxisStep(tag);
    quantizedAxes[tag] = step > 0 ? Math.round(value / step) * step : value;
  }

  const layout = subsystem.engine.layoutText({
    text,
    family: this._state.textFontFamily,
    fontSize: this._state.textSize,
    lineHeight: this._state.textLeading,
    width,
    height,
    alignH,
    wrapMode,
    weight: quantizedWeight,
    style: styleCode,
    axisQuantization: 0,  // Disable Rust-side quantization since we do it in TS
    axes: quantizedAxes,
  });
  // ...
}
```

**Key change**: Set `axisQuantization: 0` in the FFI call since quantization now happens entirely on the TS side. This avoids double-quantization.

### 4.2 TS Side (ffi.ts) -- Layout Cache Key

The layout cache key in `NativeTextEngine.layoutText()` (line 258--262) already incorporates `weight` and `axesKey`. Since quantized values are passed in, the cache key automatically benefits -- many requests that previously had different cache keys (weight 456 vs 458) will now have the same key (weight 460).

**No changes needed in ffi.ts** -- the quantization in p5gpu.ts flows through naturally.

### 4.3 Rust Side (lib.rs) -- CacheKey

The Rust `CacheKey` struct already uses `font_weight: u16`. Since the quantized weight is passed across FFI as a `u16`, it is automatically part of the cache key.

The `parse_axes()` function in lib.rs currently applies quantization:
```rust
if quantization.is_finite() && quantization > 0.0 {
    val = (val / quantization).round() * quantization;
}
```

With the TS-side quantization, we pass `axis_quantization = 0.0` to disable this. The Rust side will see pre-quantized values.

**No changes needed in lib.rs** -- but we could optionally remove the Rust-side quantization code since it becomes dead code. However, keeping it is harmless and provides a safety net.

### 4.4 Atlas (atlas.ts) -- No Changes

The atlas is keyed by `glyph.key` (a `bigint` from the Rust engine). Since the Rust engine receives quantized weight/axis values, the glyph keys it produces will be quantized. The atlas benefits automatically.

### 4.5 Data Flow Summary

```
User calls p.textWeight(456.7)
  |
  v
P5GPU._state.textWeight = 456.7
  |
  v
_layoutText():
  resolvedWeight = 456.7 (or 457 after Math.round in ffi.ts)
  quantizedWeight = Math.round(457 / 20) * 20 = 460
  quantizedAxes = { wght: 460 }
  |
  v
NativeTextEngine.layoutText():
  cacheKey = "...460..."  (TS layout cache hit if weight was 460 last frame too)
  FFI call with weight=460, axes={wght:460}
  |
  v
Rust TextEngine::layout_to_binary():
  CacheKey { font_weight: 460, ... }
  hash_glyph_key(cache_key, axes_hash) -> u64 glyph key
  |
  v
GlyphAtlas.ensureGlyph(key):
  key matches previous frame -> HIT (no re-rasterize, no re-upload)
```

### 4.6 Files Modified

| File | Changes |
|------|---------|
| `p5gpu.ts` | Add `getAxisStep()` helper, quantize weight and axes in `_layoutText()`, update `textAxisQuantization()` to accept `Record<string, number>`, update state default |
| `p5gpu.ts` | Update `cloneState()` to deep-copy the quantization config when it is an object |

**Files NOT modified**:
- `ffi.ts` -- no changes needed
- `lib.rs` -- no changes needed (Rust quantization becomes dormant with `axis_quantization=0`)
- `atlas.ts` -- no changes needed

---

## 5. Estimated Performance Impact

### 5.1 Unique Glyph Keys Per Frame

The benchmark renders 900 characters with per-character weight LFO sweeping 300--900.

| Quantization Step | Unique Weights | Max Unique Glyph Keys (900 chars) | Atlas Feasibility |
|---|---|---|---|
| 0 (disabled) | ~601 (integers) | ~540,900 | Far exceeds atlas (8192 max entries) |
| 1 (current default) | 601 | ~540,900 | Same as above |
| 10 | 61 | ~54,900 | Exceeds atlas over many frames, but much better |
| **20 (proposed)** | **31** | **~27,900** | **Good -- atlas working set per frame is ~971, well within 8192** |
| 25 | 25 | ~22,500 | Slightly better |
| 50 | 13 | ~11,700 | Very good perf, but weight jumps may be visible |

### 5.2 Atlas Hit Rate Prediction (Step=20)

With step=20, on any given frame each character maps to one of ~31 quantized weights. Since the LFO is continuous, consecutive frames will often produce the SAME quantized weight for a given character.

- **Characters per frame**: 971
- **Unique (char, quantizedWeight) pairs per frame**: ~971 (each char at its quantized weight)
- **Atlas capacity**: 8192 entries, eviction threshold 3 frames
- **Retained across frames**: With step=20, a character's quantized weight changes approximately every `20 / weightChangePerFrame` frames. For a sin LFO at 60fps spanning 300--900, the weight velocity is at most `(900-300) * PI * freq / 60`. At freq=0.5 Hz, max velocity = `600 * 3.14 * 0.5 / 60 = 15.7 units/frame`. So a quantized weight step of 20 persists for ~1.3 frames on average at peak velocity. At low velocity (near LFO peaks/troughs), it persists for many frames.
- **Expected hit rate**: ~60--80% (up from ~30% currently), depending on LFO frequency
- **Expected atlas misses**: ~200--400/frame (down from ~650--700)
- **Expected rasterization savings**: ~4--6ms saved per frame
- **Expected upload savings**: ~2--4ms saved per frame
- **Total estimated savings**: ~6--10ms per frame, bringing total from ~19.5ms to ~10--13ms

### 5.3 Visual Quality

At 40px font size with Inter Variable:
- Step=20: Weight 450 and 470 are rasterized as 460. The 10-unit maximum error (half the step) corresponds to ~2.5% of the weight at 400. This is at or below the perceptual JND of 3%.
- In animated contexts, the eye tracks smooth motion. A 20-unit quantization grid at 40px produces no visible stepping artifacts during LFO animation.
- **At larger sizes (72px+)**: Weight differences become slightly more visible. Users rendering at very large sizes with slow animation may want to reduce the step to 10.
- **At smaller sizes (16px and below)**: Weight differences are less visible. Step=20 or even step=50 is fine.

### 5.4 Comparison Table

| Metric | Before (step=1) | After (step=20) | Change |
|---|---|---|---|
| Unique weights in LFO range | 601 | 31 | 19x reduction |
| Atlas misses/frame | ~650--700 | ~200--400 | 40--70% reduction |
| Rasterize time/frame | ~5.5ms | ~1--3ms | 2--5x faster |
| Upload time/frame | ~4.8ms | ~1--3ms | 2--5x faster |
| Total frame time | ~19.5ms | ~10--13ms | ~35--50% reduction |
| Visual quality loss | None | Imperceptible | JND threshold |

---

## 6. Open Questions and Future Work

### 6.1 Should We Also Pre-Warm Common Weight Steps?

If we know the LFO range is 300--900 with step=20, we could pre-rasterize all 31 weight variants of each character glyph at startup. This would eliminate atlas misses entirely after the first frame. However:
- Pre-warming 900 chars * 31 weights = 27,900 rasterizations at startup would take ~2--3 seconds.
- The atlas has 8192 max entries, so we cannot hold all 27,900. We would need a much larger atlas or multi-atlas system.
- **Decision**: Defer pre-warming to a future optimization pass. The quantization alone provides sufficient improvement.

### 6.2 Adaptive Quantization Based on Animation Speed?

We could detect the rate of weight change and automatically adjust quantization:
- If weight changes by <5 units/frame, use step=10 (high quality)
- If weight changes by >20 units/frame, use step=40 (high performance)

This adds complexity and unpredictability. **Decision**: Keep it simple with a fixed configurable step. Users who need adaptive behavior can implement it in their sketch code by calling `textAxisQuantization()` dynamically.

### 6.3 SDF-Based Rendering (Long Term)

p5.js's analytical curve rendering and SDF approaches solve this problem fundamentally by making rendering weight-independent. A future version of our text pipeline could use multi-channel SDF (MSDF) glyphs, which can be rendered at any weight by adjusting distance field thresholds. This is a large architectural change beyond the scope of this plan.

---

## 7. Implementation Checklist

1. [ ] Update `P5GPUState.textAxisQuantization` type to `number | Record<string, number>`
2. [ ] Update default from `1` to `{ wght: 20, wdth: 5, opsz: 2, _default: 1 }`
3. [ ] Update `textAxisQuantization()` method to accept/return the new type
4. [ ] Update `cloneState()` to deep-copy the config object
5. [ ] Add `_getAxisQuantizationStep(tag: string): number` helper method
6. [ ] Update `_layoutText()` to quantize weight and axes BEFORE the layoutText call
7. [ ] Pass `axisQuantization: 0` to the Rust engine (disable Rust-side quantization)
8. [ ] Update the text LFO perf benchmark to test with the new default
9. [ ] Verify no visual artifacts at 40px with step=20
10. [ ] Profile the benchmark to confirm performance improvement

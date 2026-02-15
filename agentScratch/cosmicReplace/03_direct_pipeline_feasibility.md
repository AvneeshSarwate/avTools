# Feasibility Analysis: Replacing cosmic-text with Direct Library Usage

## Executive Summary

**Verdict: Feasible, with significant but manageable effort. The variable font axis problem is solved at every layer below cosmic-text.**

cosmic-text's limitation is architectural: its `CacheKey`, `Attrs`, `Font`, and `FontMatchAttrs` types only understand `weight` (and `stretch`/`style` as static font-selection attributes). It never passes arbitrary variation axes through to shaping or rasterization. The underlying libraries -- swash, harfrust (the successor to rustybuzz), fontdb, and skrifa -- all have full, native support for arbitrary variable font axes. Using them directly is viable, but you must reimplement the "glue" that cosmic-text provides: font fallback, bidi processing, line breaking, word wrapping, and the glyph cache keyed by variation coordinates.

---

## 1. Library-by-Library Analysis

### 1.1 swash (v0.2.6) -- Font Introspection, Shaping, and Rasterization

**What it provides:**
- **Font introspection**: `FontRef::variations()` returns an iterator of `Variation` objects, each with `tag()`, `min_value()`, `max_value()`, `default_value()`, `normalize(value)`. Works for ALL axes including custom ones.
- **Full text shaping**: `ShapeContext` -> `ShaperBuilder` -> `Shaper`. The builder accepts `.variations(&[("wght", 520.5), ("wdth", 75.0), ("CASL", 1.0)])` with arbitrary 4-byte tags via `Setting<f32>`.
- **Glyph rasterization**: `ScaleContext` -> `ScalerBuilder` -> `Scaler`. Builder accepts `.variations(...)` with the same `Setting<f32>` interface. Supports TrueType hinting, CFF hinting, subpixel rendering, color outlines, color bitmaps, and embedded strikes.
- **Font metrics**: `FontRef::metrics(&normalized_coords)` and `FontRef::glyph_metrics(&normalized_coords)` both accept normalized coordinates, so metrics are variation-aware.
- **Charmap**: `FontRef::charmap()` for codepoint-to-glyph mapping.
- **Outline extraction**: `Scaler::scale_outline()` returns hinted outlines that can be fed to zeno, lyon, or pathfinder.

**Can it do shaping?** YES. swash has a complete OpenType shaper (`swash::shape` module) that handles GSUB/GPOS, complex scripts, ligatures, mark positioning, and all shaping features. It accepts variations natively on the `ShaperBuilder`. Output is cluster-based `GlyphCluster` with positioned glyphs.

**Can it do layout?** NO. swash does not do line breaking, word wrapping, paragraph layout, bidi reordering, or multi-line text. It shapes a single run of text with a single font.

**Variable font axis support:** COMPLETE. All axes (registered and custom) are first-class. The `Setting<f32>` type accepts any 4-byte tag string. Normalized coordinates flow through shaping and scaling consistently.

**Key API pattern:**
```rust
// Enumerate axes
for var in font_ref.variations() {
    println!("{}: {} .. {} (default {})", var.tag(), var.min_value(), var.max_value(), var.default_value());
}

// Shape with variations
let mut context = ShapeContext::new();
let mut shaper = context.builder(font_ref)
    .size(24.0)
    .variations(&[("wght", 600.0), ("wdth", 75.0), ("opsz", 12.0), ("CASL", 1.0)])
    .features(&[("liga", 1), ("calt", 1)])
    .script(Script::Latin)
    .build();
shaper.add_str("Hello");
shaper.shape_with(|cluster| { /* GlyphCluster with positioned glyphs */ });

// Rasterize with matching variations
let mut scale_ctx = ScaleContext::new();
let mut scaler = scale_ctx.builder(font_ref)
    .size(24.0)
    .variations(&[("wght", 600.0), ("wdth", 75.0)])
    .hint(true)
    .build();
let image = Render::new(&[Source::ColorOutline(0), Source::ColorBitmap(StrikeWith::BestFit), Source::Outline])
    .format(Format::Alpha)
    .render(&mut scaler, glyph_id);
```

### 1.2 harfrust (successor to rustybuzz) -- Text Shaping

**What it is:** harfrust is a pure-Rust port of HarfBuzz, maintained by the HarfBuzz team. It is the evolution of rustybuzz. cosmic-text v0.17+ uses harfrust instead of rustybuzz.

**Key difference from rustybuzz:** harfrust uses `read-fonts` (skrifa's low-level parser) instead of `ttf-parser`, aligning it with the linebender font stack. This means it shares font data structures with skrifa/fontique/parley.

**Variable font axis support:** COMPLETE. The `ShaperInstance` type is constructed with `from_coords()` which accepts arbitrary normalized coordinates. In cosmic-text, this is where the limitation originates -- `Font::new()` constructs the `ShaperInstance` with only `("wght", weight)`:

```rust
// cosmic-text/src/font/mod.rs line 141-142 -- THE BOTTLENECK
let location = font_ref
    .axes()
    .location([(Tag::new(b"wght"), weight.0 as f32)]);
// Only weight! No width, no optical size, no custom axes.
```

harfrust itself has no such limitation. If you construct the `ShaperInstance` with full coordinates, it shapes correctly for all axes.

**API for direct use:**
```rust
use harfrust::{ShaperData, ShaperInstance, UnicodeBuffer, Direction};

let shaper_data = ShaperData::new(&font_ref);
let shaper_instance = ShaperInstance::from_coords(
    &font_ref,
    font_ref.axes().location([
        (Tag::new(b"wght"), 600.0),
        (Tag::new(b"wdth"), 75.0),
        (Tag::new(b"opsz"), 12.0),
        (Tag::new(b"CASL"), 1.0),
    ]).coords().iter().copied()
);
let shaper = shaper_data.shaper(&font_ref).instance(Some(&shaper_instance)).build();

let mut buffer = UnicodeBuffer::new();
buffer.push_str("Hello world");
buffer.set_direction(Direction::LeftToRight);
let output = shaper.shape(buffer, &[]);
// output.glyph_infos() and output.glyph_positions() give glyph_id + x/y advance/offset
```

### 1.3 rustybuzz (older, still maintained)

**What it is:** The original Rust port of HarfBuzz, using `ttf-parser` for font parsing.

**Variable font axis support:** COMPLETE. `Face::set_variation(tag, value)` accepts any `Tag` + `f32` value. `Face::variation_axes()` enumerates all axes. Supports up to 64 variation coordinates on the stack.

**Relevance:** If you wanted to use rustybuzz instead of harfrust, you get the same full variable axis support. However, harfrust is the more modern choice and shares the skrifa data model. For a new pipeline, prefer harfrust or swash's built-in shaper.

### 1.4 fontdb -- Font Database

**What cosmic-text uses it for:**
- System font discovery (`load_system_fonts()`)
- Font metadata: family name, weight, stretch, style, monospaced flag
- Font matching via `Query` (family + weight + stretch + style)
- Font data storage and retrieval
- Face ID assignment

**What you would need it for:**
- Same things. fontdb is a good, lightweight font database. You could use it directly.
- However, fontdb's `Query` type only matches on weight/stretch/style -- it does not understand variable font instances or arbitrary axes. This is fine because you'd handle axis resolution yourself.

**Alternative: fontique (from linebender/parley)**
- fontique is a more modern font enumeration/fallback library that understands system font collections better
- It provides script-based fallback and locale-aware font selection
- It is what parley uses instead of fontdb

### 1.5 skrifa -- Font Parsing (read-fonts)

**What it provides:**
- Low-level OpenType table parsing
- `FontRef` with axis enumeration, location computation
- `Metrics` (ascent, descent, line gap, units per em) -- variation-aware
- `GlyphMetrics` (advance width, advance height, lsb, tsb) -- variation-aware
- Charmap (codepoint to glyph ID mapping)
- Outline extraction

**Relevance:** Both harfrust and cosmic-text already depend on skrifa. If building a direct pipeline, skrifa provides the font-parsing foundation. The key method is `font_ref.axes().location(...)` which converts user-space axis values to normalized coordinates that all downstream consumers (shaping, scaling, metrics) understand.

### 1.6 Unicode Processing Libraries

**unicode-bidi:**
- Implements the Unicode Bidirectional Algorithm (UAX #9)
- Determines text direction per paragraph and per character run
- cosmic-text uses it to split text into directional spans
- **You MUST handle this** if you support RTL text or mixed-direction text

**unicode-linebreak:**
- Implements Unicode Line Break Algorithm (UAX #14)
- Determines valid line break opportunities
- cosmic-text uses it to split spans into words at line break points
- **You MUST handle this** for multi-line text

**unicode-segmentation:**
- Provides grapheme cluster boundaries
- cosmic-text uses it to identify attribute boundaries within words
- **You MUST handle this** for correct attribute span splitting

**unicode-script:**
- Identifies the script of each character (Latin, Arabic, Devanagari, etc.)
- Used for font fallback decisions
- **You MUST handle this** for multi-script text

**How much manual work?** These crates are straightforward to use directly. The hard part is not calling them -- it is integrating their results into a coherent layout pipeline. cosmic-text's shape.rs is ~1800 lines of this integration logic.

---

## 2. The Variable Axis Problem in cosmic-text -- Root Cause Analysis

The limitation is not in one place. It is systemic across multiple layers:

### Layer 1: `Attrs` (attrs.rs)
```rust
pub struct Attrs<'a> {
    pub weight: Weight,      // Only weight
    pub stretch: Stretch,    // Used for font selection, not variation
    pub style: Style,        // Used for font selection, not variation
    // NO field for arbitrary variation axes
}
```
There is no way to specify `wdth`, `opsz`, `CASL`, or any custom axis through `Attrs`.

### Layer 2: `Font::new()` (font/mod.rs)
```rust
let location = font_ref
    .axes()
    .location([(Tag::new(b"wght"), weight.0 as f32)]);
let shaper_instance = ShaperInstance::from_coords(&font_ref, location.coords().iter().copied());
```
Only `wght` is passed to skrifa's axis location computation. The shaper instance is baked with only weight variation.

### Layer 3: `FontSystem::get_font()` (font/system.rs)
```rust
font_cache: HashMap<(fontdb::ID, fontdb::Weight), Option<Arc<Font>>>,
```
Fonts are cached by `(ID, Weight)` only. Two requests for the same font with different `wdth` values would return the same cached `Font` instance (with its single baked-in weight-only shaper).

### Layer 4: `CacheKey` (glyph_cache.rs)
```rust
pub struct CacheKey {
    pub font_id: fontdb::ID,
    pub glyph_id: u16,
    pub font_size_bits: u32,
    pub x_bin: SubpixelBin,
    pub y_bin: SubpixelBin,
    pub font_weight: fontdb::Weight,
    pub flags: CacheKeyFlags,
}
```
The cache key includes `font_weight` but no other variation coordinates. Two glyphs at the same weight but different widths would collide in the cache.

### Layer 5: `swash_image()` in swash.rs
```rust
let variable_width = font.as_swash().variations().find_by_tag(swash::Tag::from_be_bytes(*b"wght"));
if let Some(variation) = variable_width {
    scaler = scaler.variations(std::iter::once(swash::Setting {
        tag: swash::Tag::from_be_bytes(*b"wght"),
        value: f32::from(cache_key.font_weight.0).clamp(variation.min_value(), variation.max_value()),
    }));
}
```
Only `wght` is passed to the swash scaler. Despite the variable name `variable_width`, it is actually looking up the weight axis (the code searches for `b"wght"`, not `b"wdth"`).

### Summary of the problem:
Every layer from user-facing API down to rasterization only threads `weight` through. Width, optical size, slant, and all custom axes are completely lost. This is not a bug -- it was a deliberate simplification. cosmic-text was designed for desktop UI text, where weight is the only commonly varied axis.

---

## 3. What You Gain by Going Direct

| Capability | cosmic-text | Direct (swash + harfrust) |
|---|---|---|
| Weight axis | YES (only axis) | YES |
| Width axis (wdth) | NO | YES |
| Optical size (opsz) | NO | YES |
| Slant (slnt) | NO | YES |
| Custom axes (CASL, CRSV, MONO, etc.) | NO | YES |
| Per-glyph variation-aware metrics | Weight only | All axes |
| Glyph cache keyed by all axes | NO | You build it |
| Font fallback | YES (sophisticated) | You build it |
| Bidi text | YES | You build it |
| Line breaking | YES | You build it |
| Word wrapping | YES | You build it |
| Ligature-aware line breaks | YES (detects coding ligatures) | You build it |
| Rich text (per-span attrs) | YES | You build it |
| Tab handling | YES | You build it |
| Shape run caching | YES (optional) | You build it |

### What you lose:
1. **Font fallback** -- cosmic-text's `FontFallbackIter` tries multiple fonts when glyphs are missing. This is ~400 lines of non-trivial code dealing with script-based fallback, monospace matching, and per-codepoint support detection.
2. **Bidi integration** -- ~100 lines handling `unicode_bidi::BidiInfo` to split text into directional spans.
3. **Line breaking and wrapping** -- ~500 lines of `ShapeLine::layout_to_buffer()` handling word/glyph/none wrapping, justified text, alignment, hinting.
4. **Ligature-aware break suppression** -- ~60 lines that detect when a Unicode line break would split a coding ligature (e.g., `|>`, `!=`).
5. **Shape plan caching** -- harfrust `ShapePlan` is expensive to create. cosmic-text caches up to 6 plans in an LRU.
6. **Shape run caching** -- optional feature that caches shaped glyph sequences by text + attrs key.

### What you gain beyond variable axes:
1. **Full control over the shaping pipeline** -- you can customize which features are enabled per-glyph, not just per-span.
2. **Custom cache key** -- you design the cache key to include exactly the variation coordinates you use, plus any other parameters (e.g., subpixel offsets for animation).
3. **Direct access to outline data** -- swash's `Scaler::scale_outline()` gives you hinted outlines for GPU tessellation without going through rasterization.
4. **Metrics with full variation awareness** -- ascent, descent, advance widths all respond to all axes, enabling proper layout at any point in variation space.

---

## 4. Alternative: Parley (linebender)

Parley is a newer text layout library from the linebender project (the folks behind xilem, vello, and the Rust GUI ecosystem). It is a strong alternative to cosmic-text.

### Architecture
- **fontique** -- font enumeration and fallback (replaces fontdb for discovery)
- **harfrust** -- shaping (same as cosmic-text v0.17+)
- **skrifa** -- font parsing and metrics (same as cosmic-text v0.17+)
- **swash** -- miscellaneous Unicode features
- **peniko** -- style primitives

### Variable font axis support
Parley has a `FontVariation` type (re-exported from `text-primitives`) that represents arbitrary `(tag, value)` pairs. The `StyleProperty::FontVariations` variant accepts a list of these. This means parley's API is designed from the ground up to handle arbitrary axes.

### What parley provides:
- Rich text layout with per-span styling including arbitrary font variations
- Line breaking, word wrapping, alignment
- Bidi text support
- Font fallback
- Text selection and editing utilities
- Cursor positioning

### Current status:
- Under active development (linebender ecosystem, used by xilem)
- API is not yet stable (pre-1.0)
- Less battle-tested than cosmic-text
- Designed for the vello GPU renderer ecosystem

### Verdict on parley:
If parley's `FontVariation` support works end-to-end (from style specification through shaping to rasterization), it could be a drop-in replacement for cosmic-text that solves the variable axis problem without building a custom pipeline. **This should be evaluated before committing to a fully custom pipeline.** The risk is that parley may have similar baking/caching limitations internally, or its API may not be stable enough for production use.

---

## 5. The "Middle Path": Patching cosmic-text

Before building from scratch, consider whether cosmic-text could be patched:

### What would need to change:
1. **`Attrs`** -- add a `variations: Vec<(Tag, f32)>` or `variations: SmallVec<[Setting<f32>; 4]>` field
2. **`Font::new()`** -- accept full variation coordinates, not just weight
3. **`FontSystem::get_font()`** -- cache key must include variation coordinates (e.g., hash of sorted axis values)
4. **`CacheKey`** -- add variation coordinate hash or normalized coords
5. **`swash_image()`** -- pass all variation axes to the scaler, not just `wght`
6. **`FontMatchAttrs`** -- include variation coordinates in font matching

### Difficulty:
- **Medium-high**. The changes touch core types used everywhere.
- `Attrs` is `Clone + Hash + Eq` and used in `RangeMap`. Adding a `Vec` to it requires careful handling of equality/hashing.
- The `Font` caching model assumes one font instance per (ID, Weight). Changing to per-variation-set is a significant architectural shift.
- Shape run caching in `ShapeRunKey` uses `AttrsOwned` which would need the same changes.

### Pros:
- Keep all the line breaking, bidi, fallback, wrapping logic
- Minimal risk of regression in features you're already using
- Smaller code delta

### Cons:
- Still constrained by cosmic-text's overall architecture and API
- Upstream may not accept the patch (it changes fundamental types)
- Must maintain a fork

---

## 6. glyphon Analysis

glyphon (in `/Users/avneeshsarwate/agentCombine/avTools/clonedCompanionRepos/glyphon/`) is a thin wgpu text rendering layer on top of cosmic-text. It:

1. Takes cosmic-text `Buffer` output (shaped, laid out text)
2. Uses cosmic-text's `SwashCache` to rasterize glyphs
3. Packs glyph bitmaps into a GPU texture atlas (via `etagere`)
4. Renders quads sampling from the atlas (via wgpu)

glyphon does NOT do any shaping or layout itself. It re-exports all of cosmic-text's types. If you replace cosmic-text's pipeline, you would also need to replace or adapt glyphon's atlas/render layer, or create your own equivalent.

**Key insight:** glyphon's `Cache` and `TextAtlas` use cosmic-text's `CacheKey` (which lacks variation coordinates). So even if you patched cosmic-text's shaping to use all axes, glyphon's glyph cache would also need updating to avoid cache collisions between different variation instances of the same glyph.

---

## 7. skia_canvas Analysis

skia_canvas (in `/Users/avneeshsarwate/agentCombine/avTools/clonedCompanionRepos/skia_canvas/`) is a Deno module for canvas rendering backed by Skia. It is relevant as an alternative rasterization backend but operates at a completely different level -- it provides a full 2D canvas API, not individual glyph rasterization. It is not a replacement for swash's glyph-level rendering.

---

## 8. Recommended Architecture for Direct Pipeline

If building from scratch (not patching cosmic-text, not using parley):

### Layer 1: Font Loading & Database
```
fontdb (system font discovery)
  + skrifa (font parsing, metrics, charmap)
  + swash::FontRef (for shaping + rasterization)
```

### Layer 2: Text Shaping
```
Option A: swash::shape (ShapeContext -> ShaperBuilder -> Shaper)
  - Pro: Single crate for shaping + rasterization, coherent variation handling
  - Pro: Cluster-based output with source ranges
  - Con: Less battle-tested than harfbuzz for exotic scripts

Option B: harfrust (ShaperData -> ShaperInstance -> Shaper)
  - Pro: Direct port of HarfBuzz, most compatible
  - Pro: Same shaper cosmic-text uses, easier to validate
  - Con: Separate crate from rasterizer, must coordinate variation coords
```

**Recommendation:** Use swash for both shaping AND rasterization. It provides a unified variation coordinate system across both operations, reducing the chance of shaping/rendering mismatch. swash's shaper is good enough for Latin, CJK, and most scripts. If you hit edge cases with complex scripts (Arabic, Devanagari), you can fall back to harfrust for those runs.

### Layer 3: Layout (you build this)
```
Input: text + per-span attrs (including variation coordinates)
  1. unicode-bidi -> directional spans
  2. unicode-script -> script runs within spans
  3. For each run: shape with swash (passing full variation coords)
  4. unicode-linebreak -> word boundaries
  5. Word wrapping (simple width accumulation)
  6. Alignment (left/right/center/justified)
Output: Vec<LayoutGlyph> with (glyph_id, x, y, font_id, variation_coords)
```

### Layer 4: Glyph Cache + Rasterization
```
CacheKey: (font_id, glyph_id, font_size, subpixel_bin, variation_coords_hash, flags)
  - variation_coords_hash: hash of all (tag, normalized_value) pairs
  - This ensures different axis values produce different cache entries

Rasterization: swash ScaleContext -> ScalerBuilder
  - Pass SAME variation coords used during shaping
  - Get SwashImage (bitmap) or scaled outline (for GPU rendering)
```

### Layer 5: GPU Rendering
```
Option A: Texture atlas approach (like glyphon)
  - Pack rasterized glyph bitmaps into atlas
  - Render quads with atlas sampling

Option B: SDF/MSDF approach
  - Generate signed distance fields from outlines
  - Resolution-independent, better for animation/zoom

Option C: Direct outline tessellation
  - Use swash outlines -> lyon/pathfinder tessellation -> GPU
  - Most flexible, highest quality
```

### Estimated Effort

| Component | Lines of code | Complexity |
|---|---|---|
| Font loading + variation setup | ~200 | Low |
| Single-run shaping with swash | ~100 | Low |
| Font fallback (basic) | ~300 | Medium |
| Bidi processing | ~100 | Low (library does the work) |
| Line breaking + word wrapping | ~400 | Medium |
| Alignment + justification | ~200 | Medium |
| Glyph cache with variation key | ~150 | Low |
| Rasterization with swash | ~100 | Low |
| Integration + testing | ~500 | High |
| **Total** | **~2050** | **Medium** |

Compare to cosmic-text's shape.rs (1810 lines) + layout.rs (179 lines) + font/ (711 lines) + swash.rs (247 lines) + glyph_cache.rs (171 lines) = ~3118 lines of core text handling. A stripped-down pipeline without cosmic-text's full feature set (editor, vi mode, syntect, etc.) is realistic at ~2000 lines.

---

## 9. Key Questions Answered

### Q: If you use rustybuzz/harfrust + swash directly, do you get full axis support natively?
**A: YES.** Both harfrust and swash accept arbitrary variation coordinates. The limitation is entirely in cosmic-text's glue layer, not in the underlying libraries.

### Q: What would you lose?
**A:** Font fallback, bidi integration, line breaking/wrapping, ligature-aware break suppression, shape plan caching, and the tested/battle-hardened integration of all these pieces. You would NOT lose any text quality -- shaping and rasterization quality comes from the underlying libraries which you'd still be using.

### Q: Is parley a viable alternative?
**A:** Potentially. parley's `FontVariation` type supports arbitrary axes by design. It needs evaluation to confirm this works end-to-end. If it does, parley would give you cosmic-text-level layout features with proper variable axis support, at the cost of depending on a less mature library.

### Q: Should you patch cosmic-text or build from scratch?
**A:** Depends on your requirements:
- If you need full multi-line text editing with bidi, fallback, wrapping: **patch cosmic-text** (or evaluate parley)
- If you need single-line or simple multi-line text with full variable axis control for creative/generative use: **build direct pipeline** with swash
- If you need maximum flexibility for animation, GPU rendering, per-glyph control: **build direct pipeline**

---

## 10. Recommendation

For a text rendering pipeline focused on creative/generative use with variable fonts:

1. **First:** Evaluate parley. If its `FontVariation` support works end-to-end and its API is sufficient, use it. This gets you layout features for free.

2. **If parley doesn't work:** Build a direct pipeline using swash for both shaping and rasterization, with fontdb for font discovery and the unicode-* crates for text processing. Start with single-line Latin text and add complexity incrementally.

3. **If you need cosmic-text compatibility:** Fork cosmic-text and patch the 5 layers identified in Section 2. This is the highest-effort option but preserves the most existing functionality.

The direct pipeline (option 2) is the most likely winner for a creative/generative context where you want per-glyph control, animation of variation axes, and don't need full text editing capabilities.


# Variable Font Axis Gap in cosmic-text

## Critical Finding

cosmic-text's CacheKey only includes `font_weight` -- NOT arbitrary variation axes (wdth, opsz, slant, grad, etc.). This is a significant limitation for the animated-axes use case.

## Where the limitation exists

| Component | Supports arbitrary axes? | Details |
|-----------|-------------------------|---------|
| **swash** (rasterizer) | YES | `scaler.variations()` accepts `Iterator<swash::Setting>` with any tag |
| **skrifa** (font metrics) | YES | `location()` accepts `[(Tag, f32)]` slice |
| **harfrust** (shaper) | YES | `ShaperInstance::from_coords()` accepts axis coords |
| **cosmic-text CacheKey** | NO -- weight only | `font_weight: fontdb::Weight` is the only axis field |
| **cosmic-text Attrs** | NO -- weight only | Has `weight: Weight`, `stretch: Stretch`, `style: Style` but no arbitrary axes |
| **cosmic-text FontSystem cache** | NO -- weight only | `HashMap<(fontdb::ID, fontdb::Weight), _>` |
| **cosmic-text Font::new()** | NO -- weight only | Creates skrifa location with only `wght` tag |
| **cosmic-text swash rasterization** | NO -- weight only | Only passes `wght` Setting to swash scaler |

The underlying libraries all support full variable font axes. The limitation is entirely in cosmic-text's cache architecture. There's even a TODO comment in the source: `// TODO: correctly take variable axes into account`.

## Impact on our use case

Animated variable font axes (wght, wdth, opsz, etc.) are a **primary use case** per the plan. Without fixing this:
- Same glyph at wdth=75 and wdth=100 would share the same cache entry
- Shaping would not reflect axis changes (glyph substitution, kerning differ by axis)
- Rasterization would ignore non-weight axes

## Options

### Option 1: Fork/patch cosmic-text locally
- Extend CacheKey to include axis hash
- Extend Attrs to store arbitrary axes
- Modify Font::new() and FontSystem to pass all axes
- Modify swash rasterization to pass all axes

**Pros:** Clean, correct, uses cosmic-text's full pipeline
**Cons:** Maintenance burden, must track upstream changes

### Option 2: Bypass cosmic-text's caching, use our own
- Use cosmic-text for shaping/layout (re-creating Font instances with full axes as needed)
- Manage our own cache keys (with full axis values) in the FFI module
- Call swash directly for rasterization with all axes

**Pros:** No cosmic-text modifications needed
**Cons:** Duplicates some logic, may miss cosmic-text optimizations

### Option 3: Thin wrapper approach
- Use cosmic-text's Buffer/FontSystem for basic text operations
- Intercept at the rasterization level: when requesting glyph images,
  use our own extended cache key and pass all axes to swash
- Shaping still uses cosmic-text's HarfRust integration (which does support coords)

**Pros:** Minimal changes, leverages cosmic-text where it works
**Cons:** Tricky to intercept cleanly, shaping still limited by Font cache

### Recommended: Option 1 (fork/patch)
Since cosmic-text is already cloned locally and the changes are well-scoped:
1. Add `variations: Vec<(Tag, f32)>` to Attrs (or a hash of axis values)
2. Include axis hash in CacheKey
3. Pass full axes to Font::new() → skrifa location + harfrust coords
4. Pass full axes to swash scaler.variations()
5. Update FontSystem cache key to include axis values

The changes touch ~5 files and are mechanically straightforward. The underlying libraries already support everything needed.

## Cache key design for variable fonts

For animated axes, the cache key should include:
```
font_id + glyph_id + font_size + subpixel_bin + axis_values_hash
```

With quantization (per the plan), axis values should be rounded before hashing:
- Weight: round to nearest 1 (or configurable step)
- Width: round to nearest 1
- Optical size: round to nearest 0.5
- Custom axes: configurable quantization step

This limits cache explosion while still producing visually distinct renderings.

## Memory implications

For animated weight (100-900, step 1 = 800 values) with 70 common ASCII glyphs:
- 800 * 70 = 56,000 cache entries per font per size
- At ~64 bytes per glyph bitmap (12px average): ~3.5 MB of glyph data
- Atlas texture: ~3.5 MB at R8

With quantization (step 10 = 80 values):
- 80 * 70 = 5,600 entries → ~350 KB
- Much more manageable

The plan's "dynamic/scratch mode" with bounded memory addresses this: evict aggressively, accept re-rasterization cost.

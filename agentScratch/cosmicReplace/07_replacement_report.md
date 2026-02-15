# cosmic-text Replacement Report

## Summary

Successfully replaced cosmic-text with direct harfrust + swash + fontdb pipeline in the text_engine Rust FFI library. Both the perf benchmark and visual comparison test pass.

## Changes Made

### Cargo.toml

Removed:
- `cosmic-text = { version = "0.17.1", features = ["swash", "std", "fontconfig"] }`

Added:
- `bitflags = "2"` (was transitive via cosmic-text)
- `fontdb = { version = "0.23", default-features = false, features = ["memmap", "std"] }`
- `harfrust = { version = "0.5.0", default-features = false, features = ["std"] }`

Kept unchanged:
- `serde_json = "1"`
- `swash = { version = "0.2.6", features = ["render", "scale", "std"] }`

### lib.rs

**Removed dependencies on:**
- `cosmic_text::FontSystem` -- replaced with `fontdb::Database` directly
- `cosmic_text::Buffer` -- replaced with direct harfrust shaping
- `cosmic_text::CacheKey` / `CacheKeyFlags` / `SubpixelBin` -- reimplemented locally (exact copy of cosmic-text's glyph_cache.rs logic)
- `cosmic_text::SwashCache` -- replaced with direct `swash::scale::Render` calls via `db.with_face_data()`
- `cosmic_text::SwashImage` / `SwashContent` -- replaced with `swash::scale::image::Image` / `Content`
- `cosmic_text::Attrs` / `Family` / `Weight` / `Style` / `Shaping` / `Wrap` / `Align` / `Metrics` -- all removed
- `cosmic_text::LayoutGlyph` / `PhysicalGlyph` / `LayoutRun` -- all removed
- `physical_with_x()` function -- no longer needed
- `style_from_code()` / `wrap_from_code()` helper functions -- no longer needed

**New architecture:**
1. **Font resolution:** `fontdb::Database::query()` replaces cosmic-text's font matching. Takes family name + weight + style, returns `fontdb::ID`.
2. **Shaping:** `shape_text()` method uses harfrust directly (same pattern as the existing `measure_advance_with_axes()`). Creates harfrust buffer, pushes text, shapes, extracts glyph IDs + advances + offsets, converts from font units to pixels.
3. **Layout/wrapping:** Three paths:
   - No wrapping: shape entire line, position glyphs linearly
   - Word wrapping: split text into whitespace/non-whitespace segments, shape each, greedy line-breaking at word boundaries
   - Glyph wrapping: shape entire text, break at glyph boundaries when exceeding width
4. **CacheKey:** Local reimplementation with identical SubpixelBin quantization logic (4 bins: 0, 0.25, 0.5, 0.75).
5. **Rasterization:** `rasterize_glyph()` uses `db.with_face_data()` to get font data, builds swash FontRef/scaler inline. No more `font_system.get_font()` / `font.as_swash()`.
6. **Metrics/outline:** `measure_font_box_metrics()` and `measure_glyph_outline_x_bounds()` already used `db.with_face_data()` via `self.font_system.db()` -- changed to `self.db` directly. Logic unchanged.

**What was NOT changed:**
- Binary protocol format (44-byte header + 16 bytes/glyph)
- FFI function signatures
- `ffi.ts`, `atlas.ts`, `p5gpu.ts` -- untouched

## Test Results

### Performance benchmark (p5_text_lfo_perf.ts, 100 frames, 900 chars with variable weight)

```
frame=   20 avgFrameMs(20)=18.30 avgDrawMs(20)=14.05 fps~54.7
frame=   40 avgFrameMs(20)=17.15 avgDrawMs(20)=11.71 fps~58.3
frame=   60 avgFrameMs(20)=18.38 avgDrawMs(20)=11.03 fps~54.4
frame=   80 avgFrameMs(20)=18.87 avgDrawMs(20)=11.10 fps~53.0
```

Average draw time: ~11-14ms per frame (900 characters with per-character variable weight animation).

### Visual comparison test (text-style-weight)

```
text-style-weight  RMSE= 20.60  max=221  diff=  6.05%  PASS
```

Passes within the text-specific thresholds (RMSE<=50, diffRatio<=25%).

## Build

```
cargo build --release  -- completed in 15.06s
```

Clean compilation, no warnings.

## Architecture Notes

The key performance win comes from bypassing cosmic-text's full paragraph layout pipeline (`Buffer.set_text()` + `shape_until_scroll()` + `layout_runs()`) which:
- Rebuilds a BiDi paragraph structure
- Runs word segmentation and Unicode line-breaking
- Maintains a per-line glyph cache with change tracking
- Handles font fallback chains

Our replacement does a single harfrust `shape()` call per text segment, which is the minimal work needed for shaping. Word wrapping is done with simple string splitting and advance accumulation.

The `measure_advance_with_axes()` method (which already existed and used direct harfrust) served as the template for `shape_text()`. The main addition was extracting glyph IDs and per-glyph offsets (not just total advance width).

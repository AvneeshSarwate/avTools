# Text Engine (text_engine) -- Comprehensive cosmic-text Usage Analysis

> **Source file:** `/Users/avneeshsarwate/agentCombine/avTools/apps/deno-notebooks/native/text_engine/src/lib.rs` (1208 lines)
> **TS FFI binding:** `/Users/avneeshsarwate/agentCombine/avTools/apps/deno-notebooks/tools/p5gpu_text/ffi.ts` (372 lines)
> **Glyph atlas:** `/Users/avneeshsarwate/agentCombine/avTools/apps/deno-notebooks/tools/p5gpu_text/atlas.ts` (352 lines)
> **Consuming renderer:** `/Users/avneeshsarwate/agentCombine/avTools/apps/deno-notebooks/tools/p5gpu.ts`

---

## 1. Dependency Versions

From `Cargo.toml` (line 10-13):
```toml
cosmic-text = { version = "0.17.1", features = ["swash", "std", "fontconfig"] }
swash = { version = "0.2.6", features = ["render", "scale", "std"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

Key: cosmic-text v0.17.1 re-exports `harfrust` (its bundled shaping engine) and `fontdb` (its font database). The `swash` feature enables `SwashCache` and glyph image types. A separate top-level `swash` v0.2.6 dependency is used for direct outline/rasterization work.

---

## 2. All cosmic-text Types/APIs Imported

**Line 1-6 -- direct imports:**
```rust
use cosmic_text::fontdb;              // re-exported fontdb crate
use cosmic_text::harfrust;            // re-exported harfrust shaper
use cosmic_text::{
    Align, Attrs, Buffer, CacheKey, CacheKeyFlags, Family, FontSystem,
    Metrics, Shaping, Style, SwashCache, SwashContent, SwashImage,
    Weight, Wrap,
};
```

**Line 12-13 -- direct swash imports (NOT through cosmic-text):**
```rust
use swash::scale::{Render, Source, StrikeWith};
use swash::zeno::{Angle, Format, Transform, Vector, Verb};
```

### Complete cosmic-text type usage map

| Type | Where used | Purpose |
|------|-----------|---------|
| `FontSystem` | Line 69 (field), 78-85 (constructor), 98/104-106 (font loading), 147-180 (layout), 416-417/436-437 (rasterization) | Core font database + shaping orchestrator |
| `Buffer` | Line 70 (field), 85 (constructor), 147-154 (set_metrics/wrap), 173-180 (set_text/shape), 204 (layout_runs) | Text layout buffer |
| `Metrics` | Line 84 (constructor default), 149 (per-layout) | Font size + line height |
| `Attrs` | Line 168-171 (per-layout) | Font family, weight, style attributes |
| `Family` | Line 163-166 (per-layout) | Font family selector |
| `Weight` | Line 170 (per-layout) | Font weight wrapper |
| `Style` | Line 916-922 (style_from_code helper) | Normal/Italic/Oblique |
| `Align` | Line 156-160 (per-layout) | Left/Center/Right alignment |
| `Wrap` | Line 924-930 (wrap_from_code helper) | Word/Glyph/None wrapping |
| `Shaping` | Line 177 (always `Shaping::Advanced`) | Selects HarfBuzz/harfrust shaping |
| `CacheKey` | Line 23 (in GlyphRasterRecord), 339/900-907 (glyph key creation), 436-501 (rasterization) | Glyph identity for cache lookup |
| `CacheKeyFlags` | Line 443/477/493 (rasterization flags) | DISABLE_HINTING, PIXEL_FONT, FAKE_ITALIC |
| `SwashCache` | Line 71 (field), 90 (constructor), 416-417 (get_image for non-axis glyphs) | cosmic-text's built-in rasterization cache |
| `SwashImage` | Line 433 (return type of rasterize_with_axes) | Rasterized glyph image data |
| `SwashContent` | Line 993-1015 (mask extraction) | Mask/Color/SubpixelMask content type |
| `fontdb::ID` | Lines 39/504/516/528/612/689 | Font face identifier |
| `fontdb::Database` | Line 82 (constructor) | Font database (new empty one, no system fonts) |
| `fontdb::Source` | Line 106 (Binary font loading) | Font source for loading bytes |
| `harfrust::FontRef` | Line 544 | Font reference for re-shaping |
| `harfrust::ShaperData` | Line 545 | Shaper data structure |
| `harfrust::ShaperInstance` | Line 584 | Variable-font shaper instance |
| `harfrust::Variation` | Line 547/557/564/576 | Axis variation setting |
| `harfrust::UnicodeBuffer` | Line 591 | Text buffer for shaping |
| `harfrust::Direction` | Line 593-596 | LTR/RTL direction |
| `harfrust::Tag` | Line 558/565/577 | OpenType tag |
| `cosmic_text::LayoutGlyph` | Line 893 (physical_with_x parameter type) | Glyph from layout run |
| `cosmic_text::PhysicalGlyph` | Line 909 (return type of physical_with_x) | Pixel-snapped glyph position |

---

## 3. Public FFI Functions

### 3a. `text_engine_create` (line 1066-1069)

```
extern "C" fn text_engine_create() -> *mut TextEngine
```

Creates a new `TextEngine` instance. Internally calls:
- `fontdb::Database::new()` -- empty font DB (no system fonts)
- `FontSystem::new_with_locale_and_db("en-US", db)` -- cosmic-text FontSystem
- `Buffer::new(&mut font_system, Metrics::new(12.0, 15.3))` -- cosmic-text Buffer
- `SwashCache::new()` -- cosmic-text SwashCache
- `swash::scale::ScaleContext::new()` -- direct swash ScaleContext

### 3b. `text_engine_destroy` (line 1071-1077)

```
extern "C" fn text_engine_destroy(engine: *mut TextEngine)
```

Drops the `TextEngine` box. No cosmic-text API calls beyond destructors.

### 3c. `text_engine_load_font_file` (line 1079-1098)

```
extern "C" fn text_engine_load_font_file(engine, path_ptr, path_len) -> u32
```

Calls `engine.load_font_file(path)` which calls:
- **`self.font_system.db_mut().load_font_file(path)`** (line 98) -- `fontdb::Database::load_font_file`

### 3d. `text_engine_load_font_bytes` (line 1100-1117)

```
extern "C" fn text_engine_load_font_bytes(engine, data_ptr, data_len) -> u32
```

Calls `engine.load_font_bytes(bytes)` which calls:
- **`self.font_system.db_mut().load_font_source(fontdb::Source::Binary(...))`** (line 104-106) -- `fontdb::Database::load_font_source`

### 3e. `text_engine_layout_json` (line 1119-1171)

```
extern "C" fn text_engine_layout_json(engine, text, family, font_size,
    line_height, width, height, align_h, wrap_mode, weight, style,
    axis_quantization, axes_json, out_ptr, out_cap) -> u32
```

This is the core layout function. Delegates to `engine.layout_to_json(...)`.

**cosmic-text API calls within `layout_to_json` (lines 110-406):**

1. **`buffer.set_metrics_and_size(&mut font_system, metrics, width, height)`** (line 147-152) -- Sets font size, line height, and layout box dimensions.
2. **`buffer.set_wrap(&mut font_system, wrap)`** (line 153-154) -- Sets word/glyph/none wrapping.
3. **`buffer.set_text(&mut font_system, text, &attrs, Shaping::Advanced, align)`** (line 173-179) -- Sets text content with attributes. This triggers **shaping** via harfrust internally.
4. **`buffer.shape_until_scroll(&mut font_system, true)`** (line 180) -- Runs layout on shaped text.
5. **`buffer.layout_runs()`** (line 204) -- Iterates over layout runs to extract glyph positions.
6. **`glyph.physical((0.0, run.line_y), 1.0)`** (line 337) -- Converts layout glyph to pixel-snapped physical glyph.
7. **`CacheKey::new(...)`** (line 900-907, called from `physical_with_x`) -- Creates cache key for glyph identity.

### 3f. `text_engine_rasterize_glyph` (line 1173-1207)

```
extern "C" fn text_engine_rasterize_glyph(engine, key, out_ptr, out_cap,
    out_width, out_height, out_left, out_top, out_content_type) -> u32
```

Delegates to `engine.rasterize_mask_for_key(key)`. See Section 8 for the full rasterization path.

---

## 4. The "Double-Layout" Pattern

The double-layout pattern exists at the **TypeScript FFI boundary**, not in the Rust code itself.

### Where it happens

In `ffi.ts`, the `layoutText` method (lines 223-306):

**First call (lines 244-263):** Passes `out_ptr: null, out_cap: 0` to get the required buffer size:
```typescript
const needed = this._lib.symbols.text_engine_layout_json(
  this._enginePtr,
  text.ptr, text.len,
  family.ptr, family.len,
  req.fontSize, req.lineHeight,
  req.width ?? -1, req.height ?? -1,
  req.alignH, req.wrapMode,
  Math.max(1, Math.min(1000, Math.round(req.weight))),
  req.style, req.axisQuantization,
  axesJson.ptr, axesJson.len,
  null, 0,   // <-- probe call: no output buffer
);
```

**Second call (lines 283-302):** Allocates a buffer of `needed` bytes and calls again to fill it:
```typescript
const out = new Uint8Array(needed);
const outPtr = Deno.UnsafePointer.of(out);
const written = this._lib.symbols.text_engine_layout_json(
  this._enginePtr,
  text.ptr, text.len,
  ... // same parameters
  outPtr, out.length,   // <-- real call: output buffer provided
);
```

### Why this happens

The Rust `write_bytes` function (line 1039-1052) implements a two-phase protocol:
- If `out_cap < needed`, it returns `needed` (the required buffer size) without writing.
- If `out_cap >= needed`, it copies the JSON bytes into the buffer and returns `needed`.

This means **every logical `layoutText` call causes TWO complete passes through cosmic-text's layout pipeline**: `set_metrics_and_size`, `set_wrap`, `set_text` (which triggers shaping), `shape_until_scroll`, and `layout_runs` iteration all run twice. The entire glyph outline measurement path also runs twice. The only thing that benefits from the second pass is the `axis_image_cache` retention (line 365-366), since `glyph_records` is rebuilt each time (line 361-364).

### Performance impact

This is the single largest performance issue in the current architecture. Every frame that renders text does 2x the shaping, 2x the layout, and 2x the outline measurement work.

---

## 5. The "HarfRust Double-Shaping" for Variable Fonts

### Where it happens

The double-shaping occurs when variable font axes (other than `wght`) are present, or when the font has an `opsz` axis.

**Detection:** `run_requires_axis_advance_adjustment` (lines 504-514):
```rust
fn run_requires_axis_advance_adjustment(&self, font_id: fontdb::ID, axes: &[AxisSetting]) -> bool {
    // If any axis besides wght is explicitly set, we need re-shaping
    if axes.iter().any(|axis| axis.tag != *b"wght") {
        return true;
    }
    // Even with only wght, if the font has an opsz axis, we need re-shaping
    self.font_has_axis(font_id, *b"opsz")
}
```

**The re-shaping:** `measure_advance_with_axes` (lines 528-610):

This function performs a **complete second shaping pass** using `harfrust` directly (bypassing cosmic-text's `Buffer`):

1. Gets raw font data via `font_system.db().with_face_data(font_id, ...)` (line 541-542)
2. Creates `harfrust::FontRef` from raw bytes (line 544)
3. Creates `harfrust::ShaperData` (line 545)
4. Builds variation settings including `wght` and `opsz` (lines 547-582)
5. Creates `harfrust::ShaperInstance::from_variations(...)` (line 584)
6. Builds shaper with `.point_size(Some(font_size))` (line 588)
7. Creates `harfrust::UnicodeBuffer`, pushes text, sets direction (lines 591-597)
8. Calls `shaper.shape(buffer, &[])` (line 600)
9. Sums up `glyph_positions().x_advance` and converts from font units to pixels (lines 601-607)

The result is a **scale factor** (`run_x_scale`) computed as `measured_width / run_scale_denom` (line 277), clamped to `[0.5, 1.5]` (line 279). This factor is then applied to all glyph x-positions in the run (lines 294-303).

### Why this exists

cosmic-text's internal shaping (via `set_text` with `Shaping::Advanced`) does NOT apply user-specified variation axes. It shapes with the font's default axis values (or at best the `wght` axis via the `Weight` attribute). When variable fonts have axes like `wdth`, `opsz`, `GRAD`, etc., the advance widths from cosmic-text's layout are wrong. The second harfrust pass measures what the advances *should* be with the correct axis settings, and the ratio is used to scale glyph positions.

### Specific lines involved

- **Detection call:** line 267 (`self.run_requires_axis_advance_adjustment(first.font_id, &axes_arc)`)
- **Measurement call:** lines 269-276 (`self.measure_advance_with_axes(...)`)
- **Scale application to x-positions:** lines 294-298 (`run_origin_x + (glyph.x - run_origin_x) * run_x_scale`)
- **Scale application to widths:** lines 299-303 (`glyph.w * run_x_scale`)
- **Scale application to font_width:** line 285 (`font_width.max(run.line_w * run_x_scale)`)

---

## 6. JSON Serialization Boundary

### Rust-side structures serialized

**`LayoutResponse`** (lines 53-66, serialized at line 403):
```rust
#[derive(Serialize)]
struct LayoutResponse {
    glyphs: Vec<LayoutGlyphOut>,  // per-glyph positions + cache keys
    tight_width: f32,              // ink-based width (outline bounds)
    font_width: f32,               // advance-based width
    ascent: f32,                   // distance from line-top to baseline
    descent: f32,                  // distance from baseline to line-bottom
    font_ascent: f32,              // OS/2 table ascent scaled to font_size
    font_descent: f32,             // OS/2 table descent scaled to font_size
    font_cap_height: f32,          // OS/2 cap height scaled to font_size
    first_baseline: f32,           // y of first baseline
    total_height: f32,             // total layout height
    line_count: usize,             // number of layout lines
}
```

**`LayoutGlyphOut`** (lines 47-51):
```rust
#[derive(Serialize)]
struct LayoutGlyphOut {
    key: String,       // 16-char hex of u64 hash
    x: i32,            // pixel x position
    y: i32,            // pixel y position
}
```

### Serialization point

Line 403-405:
```rust
serde_json::to_string(&response).unwrap_or_else(|_| { /* fallback empty JSON */ })
```

### TS-side deserialization

In `ffi.ts`, `parseLayoutResponse` (lines 146-188):
- Parses JSON with `JSON.parse`
- Converts glyph `key` strings from hex to `BigInt` (line 170: `BigInt(\`0x${glyph.key}\`)`)
- Renames snake_case to camelCase fields
- Returns `TextLayoutResult` interface

### Data flow

```
Rust layout_to_json() -> serde_json::to_string -> JSON bytes -> FFI buffer ->
TS textDecoder.decode -> JSON.parse -> parseLayoutResponse -> TextLayoutResult
```

### Input serialization

Axes are passed as JSON from TS to Rust:
- TS side: `JSON.stringify(req.axes)` (ffi.ts line 242) produces e.g. `{"wdth":75,"opsz":24}`
- Rust side: `parse_axes(axes_json, axis_quantization)` (line 932-969) deserializes via `serde_json::from_str::<Value>(json)`

---

## 7. cosmic-text-Only vs. Direct-swash Operations

### Operations that ONLY use cosmic-text (hard to replace)

| Operation | Lines | cosmic-text APIs |
|-----------|-------|-----------------|
| Font database management | 82-107 | `FontSystem`, `fontdb::Database`, `db_mut().load_font_file/source` |
| Text shaping + line breaking + wrapping | 147-180 | `Buffer.set_text`, `Buffer.shape_until_scroll` |
| Layout run iteration | 204 | `Buffer.layout_runs()` |
| Glyph physical positioning | 337/900-907 | `LayoutGlyph.physical()`, `CacheKey::new()` |
| Non-axis glyph rasterization | 415-417 | `SwashCache.get_image()` |
| Font face lookup for rasterization | 434-437 | `FontSystem.get_font()`, `.as_swash()` |

### Operations that use swash directly (already cosmic-text-free)

| Operation | Lines | swash APIs |
|-----------|-------|-----------|
| Axis-aware rasterization | 429-502 | `ScaleContext.builder()`, `Render::new()`, `Source::*`, `Format::Alpha` |
| Font metric measurement | 612-687 | `swash::FontRef`, `variations()`, `normalized_coords()`, `metrics()` |
| Glyph outline measurement | 689-889 | `ScaleContext.builder()`, `scaler.scale_outline()`, outline verb iteration |
| Font axis detection | 516-526 | `swash::FontRef`, `variations().find_by_tag()` |

### Operations that use harfrust directly (bypass cosmic-text's Buffer)

| Operation | Lines | harfrust APIs |
|-----------|-------|--------------|
| Variable-font advance measurement | 528-610 | `harfrust::FontRef`, `ShaperData`, `ShaperInstance`, `UnicodeBuffer`, `shaper.shape()` |

### Shared access pattern: `font_system.db().with_face_data`

All the direct-swash and direct-harfrust operations access the raw font bytes through cosmic-text's fontdb:

- Line 518-519: `self.font_system.db().with_face_data(font_id, |font_data, face_index| { ... })`
- Line 541-542: same pattern
- Line 623-624: same pattern
- Line 703-704: same pattern

This is the **primary coupling point** -- the font data is stored in cosmic-text's `fontdb::Database`, and all direct swash/harfrust operations reach through it. Replacing cosmic-text would require an alternative font storage mechanism that can serve raw `&[u8]` font data + face index.

---

## 8. Rasterization Path

### Entry point: `rasterize_mask_for_key` (lines 408-427)

```
rasterize_mask_for_key(key: u64) -> Option<RasterizedMask>
```

**Two paths diverge based on whether axes are present:**

### Path A: No axes -- through cosmic-text's SwashCache (lines 415-418)

```rust
if record.axes.is_empty() {
    self.swash_cache
        .get_image(&mut self.font_system, record.cache_key)
        .clone()
}
```

This uses `cosmic_text::SwashCache::get_image()` which internally:
1. Looks up the font via `FontSystem`
2. Uses swash to rasterize with the cache key's parameters
3. Returns a `SwashImage`

### Path B: With axes -- direct swash (lines 419-421)

```rust
else {
    self.rasterize_with_axes(record.cache_key, record.axes.as_slice())
}
```

`rasterize_with_axes` (lines 429-502) does everything manually:

1. **Font lookup:** `font_system.get_font(cache_key.font_id, cache_key.font_weight)` (line 434-436) -- still via cosmic-text
2. **Get swash font ref:** `font.as_swash()` (line 438) -- cosmic-text's Font wrapper method
3. **Build scaler with variations:** (lines 439-475)
   - `self.scale_context.builder(font_ref).size(...).hint(...)`
   - Iterates axes, creates `swash::Setting` entries
   - Applies `wght` from cache_key if not in axes
   - Calls `.variations(settings.into_iter())`
   - Calls `.build()`
4. **Compute subpixel offset:** (lines 477-484) using `CacheKeyFlags::PIXEL_FONT`, `x_bin`, `y_bin`
5. **Render:** (lines 486-501)
   ```rust
   Render::new(&[
       Source::ColorOutline(0),
       Source::ColorBitmap(StrikeWith::BestFit),
       Source::Outline,
   ])
   .format(Format::Alpha)
   .offset(offset)
   .transform(/* fake italic if flagged */)
   .render(&mut scaler, cache_key.glyph_id)
   ```

### Post-rasterization: `swash_to_mask` (lines 987-1025)

Both paths produce a `SwashImage` which is then converted to `RasterizedMask`:
- `SwashContent::Mask` -- direct alpha copy
- `SwashContent::Color` -- extracts alpha channel from RGBA
- `SwashContent::SubpixelMask` -- averages RGB channels

### Axis image caching

After rasterization, the result is cached in `axis_image_cache` (line 425):
```rust
self.axis_image_cache.insert(key, mask.clone());
```

And checked at the start (line 409-411):
```rust
if let Some(existing) = self.axis_image_cache.get(&key) {
    return Some(existing.clone());
}
```

---

## 9. Glyph Outline Measurement Path

### `measure_glyph_outline_x_bounds` (lines 689-889)

This is the **analytical curve-extrema code** used for computing `tight_width`. It does NOT go through cosmic-text at all -- it uses swash directly.

**Steps:**

1. **Get raw font data:** `font_system.db().with_face_data(font_id, ...)` (line 703-704)
2. **Create swash FontRef:** `swash::FontRef::from_index(font_data, face_index)` (line 705)
3. **Build variation settings:** (lines 706-740) -- same pattern as rasterization, applies `wght` and `opsz` defaults
4. **Build scaler:** `scale_context.builder(font_ref).size(font_size).hint(false).variations(...).build()` (lines 742-746)
5. **Get scaled outline:** `scaler.scale_outline(glyph_id)` (line 748)
6. **Walk outline verbs to find x-extrema:** (lines 749-886)

### Curve extrema math (the interesting part)

For each outline verb:

- **MoveTo** (line 773-780): Record point x as extremum.
- **LineTo** (line 782-791): Record start and end x.
- **QuadTo** (lines 793-815): Record endpoints, then find t where dx/dt = 0:
  ```
  denom = start.x - 2*ctrl.x + end.x
  t = (start.x - ctrl.x) / denom
  ```
  If `0 < t < 1`, evaluate `quad_x(start.x, ctrl.x, end.x, t)`.
- **CurveTo** (lines 817-872): Record endpoints, then find roots of quadratic `x'(t) = 0`:
  ```
  a = -start.x + 3*ctrl1.x - 3*ctrl2.x + end.x
  b = 3*start.x - 6*ctrl1.x + 3*ctrl2.x
  c = -3*start.x + 3*ctrl1.x
  qa = 3*a, qb = 2*b, qc = c
  discriminant = qb^2 - 4*qa*qc
  t0 = (-qb - sqrt(disc)) / (2*qa)
  t1 = (-qb + sqrt(disc)) / (2*qa)
  ```
  For each root in `(0,1)`, evaluate `cubic_x(start.x, ctrl1.x, ctrl2.x, end.x, t)`.
- **Close** (line 874-880): Record start and contour_start x.

### Where outline bounds are used

Called from `layout_to_json` at line 317-324:
```rust
let measured = self.measure_glyph_outline_x_bounds(
    &mut outline_scale_context,
    glyph.font_id, glyph.glyph_id,
    glyph.font_size, glyph.font_weight.0,
    axes_arc.as_slice(),
);
```

The results feed into `tight_width` calculation (lines 328-358):
- `line_ink_min_x` / `line_ink_max_x` track the ink bounds per line
- `tight_width = max(tight_width, line_ink_max_x - line_ink_min_x)`

### Outline bounds caching

Per-layout-call cache only (not persistent):
```rust
let mut outline_bounds_cache = HashMap::<GlyphOutlineBoundsKey, Option<(f32, f32)>>::new();
```
Key includes `font_id`, `glyph_id`, `font_size_bits`, `font_weight`, `axes_hash` (lines 37-44).

This cache is **local** to a single `layout_to_json` call and is discarded afterward. Since the double-layout pattern calls `layout_to_json` twice per logical request, this cache provides zero benefit across calls.

---

## 10. Caching and Lifecycle

### 10a. `glyph_records: HashMap<u64, GlyphRasterRecord>` (line 73)

**Purpose:** Maps glyph hash keys to `(CacheKey, axes)` pairs needed for rasterization.

**Lifecycle:**
- **Cleared and rebuilt** every `layout_to_json` call (lines 361-364):
  ```rust
  self.glyph_records.clear();
  for (key, record) in pending_records {
      self.glyph_records.insert(key, record);
  }
  ```
- **Read** during `rasterize_mask_for_key` (line 413) to look up the `CacheKey` + axes for a given hash.
- Since layout runs twice (Section 4), `glyph_records` is built, cleared, and rebuilt every logical text call.

### 10b. `axis_image_cache: HashMap<u64, RasterizedMask>` (line 74)

**Purpose:** Caches rasterized glyph masks for axis-aware glyphs.

**Lifecycle:**
- **Populated** on rasterization (line 425): `self.axis_image_cache.insert(key, mask.clone())`
- **Checked** before rasterization (lines 409-411)
- **Pruned** at the end of each `layout_to_json` call (lines 365-366):
  ```rust
  self.axis_image_cache.retain(|key, _| self.glyph_records.contains_key(key));
  ```
  This removes any cached masks for glyphs that are no longer in the current layout. Effectively, the cache only survives if the same glyphs appear in consecutive layout calls.

### 10c. `swash_cache: SwashCache` (line 71)

**Purpose:** cosmic-text's built-in glyph image cache (used for non-axis path).

**Lifecycle:**
- Created once at engine construction (line 90).
- Grows unboundedly over the engine's lifetime.
- Used only in the non-axis rasterization path (line 416-417).

### 10d. `scale_context: swash::scale::ScaleContext` (line 72)

**Purpose:** Reusable context for swash glyph scaling/rasterization.

**Lifecycle:**
- Created once at engine construction (line 91).
- Reused for all axis-aware rasterization calls.
- Note: a SECOND `ScaleContext` is created per `layout_to_json` call for outline measurement (line 201: `let mut outline_scale_context = swash::scale::ScaleContext::new()`). This is wasteful.

### 10e. `outline_bounds_cache` (line 202)

**Purpose:** Per-call cache for glyph outline x-bounds.

**Lifecycle:**
- Local variable in `layout_to_json`, created fresh each call.
- Discarded when `layout_to_json` returns.
- Provides no benefit across the double-layout calls.

### 10f. `font_system` internal caches

cosmic-text's `FontSystem` contains:
- `fontdb::Database` -- font file data, face metadata
- Shape cache -- internally caches shaped runs
- Font face cache -- caches parsed font faces

These are managed by cosmic-text and persist for the engine's lifetime.

---

## 11. TypeScript Consumption Pattern

### Architecture

```
p5gpu.ts (renderer)
  |
  +-- NativeTextEngine (ffi.ts)    -- Deno FFI wrapper
  |     |
  |     +-- text_engine_layout_json()  -> JSON string -> TextLayoutResult
  |     +-- text_engine_rasterize_glyph() -> RasterizedGlyph
  |
  +-- GlyphAtlas (atlas.ts)        -- GPU texture atlas
        |
        +-- ensureGlyph(key, engine)   -- rasterizes on cache miss
```

### Flow for `p5gpu.text()` (lines 1007-1090)

1. `_layoutText(source, width, height)` (line 1027) -- calls `engine.layoutText({...})`
   - This triggers the double-layout pattern (2 FFI calls)
2. For each glyph in `layout.glyphs`:
   - `atlas.ensureGlyph(glyph.key, engine)` (line 1069)
     - On cache miss: `engine.rasterizeGlyph(key)` (atlas.ts line 133)
     - Uploads pixel data to GPU texture
   - Emits text quad vertices with atlas UVs

### Flow for `p5gpu.textWidth()` (lines 1093-1106, approximate)

1. `_layoutText(text, null, null)` -- layout without width constraint
2. Returns `layout.fontWidth` or `layout.tightWidth`

### Flow for `_measureTextGlyphInkExtents()` (lines 2222-2259)

1. `_layoutText(text, null, null)` -- layout
2. For each glyph: `atlas.ensureGlyph(glyph.key, engine)` -- rasterize
3. Uses rasterized glyph's `left`, `top`, `width`, `height` for ink bounds

---

## 12. What Would Need Replacing and What the Replacement Looks Like

### Must-replace: cosmic-text core APIs

| Current API | Replacement needed |
|-------------|-------------------|
| `FontSystem` | Custom font storage wrapping `fontdb::Database` (or raw font data store) |
| `Buffer.set_text()` (shaping) | Direct `harfrust` shaping (already partially done in `measure_advance_with_axes`) |
| `Buffer.shape_until_scroll()` (layout) | Custom line-breaking + wrapping algorithm |
| `Buffer.layout_runs()` (iteration) | Custom layout run data structure |
| `SwashCache.get_image()` | Direct swash `Render` (already done in `rasterize_with_axes`) |
| `FontSystem.get_font()` / `.as_swash()` | Direct `swash::FontRef::from_index()` on stored font data |
| `LayoutGlyph.physical()` / `CacheKey::new()` | Custom pixel-snapping + cache key generation |

### Already replaceable (using swash/harfrust directly)

| Current code | Status |
|-------------|--------|
| `rasterize_with_axes()` | Already uses swash directly; just needs the font data access pattern changed |
| `measure_advance_with_axes()` | Already uses harfrust directly |
| `measure_font_box_metrics()` | Already uses swash directly |
| `measure_glyph_outline_x_bounds()` | Already uses swash directly |
| `font_has_axis()` | Already uses swash directly |

### Key insight

The only truly "cosmic-text-only" operations are:
1. **Font database** (fontdb -- but this is a standalone crate, can be used independently)
2. **Shaping orchestration** (`Buffer.set_text` which calls harfrust internally -- but the code already demonstrates how to call harfrust directly)
3. **Line breaking / wrapping / alignment** (`Buffer.shape_until_scroll` + `layout_runs` -- this is the hardest part to replace)
4. **CacheKey generation** (the subpixel binning logic in `CacheKey::new`)

Everything else already has a direct-swash or direct-harfrust equivalent in this codebase.

---

## 13. Summary Table: cosmic-text API Call Sites

| Line(s) | API | Function | Category |
|---------|-----|----------|----------|
| 82 | `fontdb::Database::new()` | TextEngine::new | Font DB |
| 83 | `FontSystem::new_with_locale_and_db()` | TextEngine::new | Font system |
| 84 | `Metrics::new()` | TextEngine::new | Layout config |
| 85 | `Buffer::new()` | TextEngine::new | Layout buffer |
| 90 | `SwashCache::new()` | TextEngine::new | Raster cache |
| 98 | `font_system.db_mut().load_font_file()` | load_font_file | Font DB |
| 104-106 | `font_system.db_mut().load_font_source()` | load_font_bytes | Font DB |
| 147-152 | `buffer.set_metrics_and_size()` | layout_to_json | Layout config |
| 153-154 | `buffer.set_wrap()` | layout_to_json | Layout config |
| 168-171 | `Attrs::new().family().weight().style()` | layout_to_json | Shaping attrs |
| 173-179 | `buffer.set_text(..., Shaping::Advanced, ...)` | layout_to_json | Shaping |
| 180 | `buffer.shape_until_scroll()` | layout_to_json | Layout |
| 204 | `buffer.layout_runs()` | layout_to_json | Layout iteration |
| 337 | `glyph.physical()` | layout_to_json | Glyph positioning |
| 416-417 | `swash_cache.get_image()` | rasterize_mask_for_key | Rasterization |
| 434-437 | `font_system.get_font()`, `.as_swash()` | rasterize_with_axes | Font access |
| 518-519 | `font_system.db().with_face_data()` | font_has_axis | Font data access |
| 541-542 | `font_system.db().with_face_data()` | measure_advance_with_axes | Font data access |
| 623-624 | `font_system.db().with_face_data()` | measure_font_box_metrics | Font data access |
| 703-704 | `font_system.db().with_face_data()` | measure_glyph_outline_x_bounds | Font data access |
| 893 | `cosmic_text::LayoutGlyph` (type) | physical_with_x | Type dependency |
| 896 | `cosmic_text::PhysicalGlyph` (type) | physical_with_x | Type dependency |
| 900-907 | `CacheKey::new()` | physical_with_x | Cache key |

---

## 14. Recommendations for Replacement Strategy

1. **Keep `fontdb`** as the font storage layer -- it is already a standalone crate used via cosmic-text's re-export. Import it directly instead.

2. **Replace `Buffer` + shaping** with direct harfrust calls (the `measure_advance_with_axes` function is a template for this). The main challenge is implementing line-breaking and word-wrapping.

3. **Replace `SwashCache`** by extending the existing `rasterize_with_axes` path to handle all glyphs (not just axis-aware ones). This is straightforward.

4. **Replace `CacheKey`** with a custom cache key struct. The subpixel binning logic in `CacheKey::new()` would need to be reimplemented.

5. **Eliminate the double-layout** by either:
   - Pre-allocating a generous output buffer and resizing only on overflow
   - Returning the JSON through an owned `Vec<u8>` that Deno can read via pointer+length

6. **Persist the outline bounds cache** across calls instead of recreating it each time.

7. **Reuse the `ScaleContext`** for outline measurement instead of creating a new one per call (line 201).


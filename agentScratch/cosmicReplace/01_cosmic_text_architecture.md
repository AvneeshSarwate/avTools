# cosmic-text v0.17.1 -- Comprehensive Architectural Analysis

## Table of Contents

1. [Overview](#1-overview)
2. [Dependency Map](#2-dependency-map)
3. [Source File Structure](#3-source-file-structure)
4. [What Each Dependency Provides](#4-what-each-dependency-provides)
5. [Core Data Flow](#5-core-data-flow)
6. [The Shaping Pipeline](#6-the-shaping-pipeline)
7. [The Layout Pipeline](#7-the-layout-pipeline)
8. [The Rasterization Layer](#8-the-rasterization-layer)
9. [Caching Architecture](#9-caching-architecture)
10. [Variable Font Axis Handling -- The Critical Gap](#10-variable-font-axis-handling----the-critical-gap)
11. [What cosmic-text Adds vs. Direct Dependency Use](#11-what-cosmic-text-adds-vs-direct-dependency-use)
12. [Summary of Limitations](#12-summary-of-limitations)

---

## 1. Overview

cosmic-text (from System76/Pop!_OS) describes itself as "Pure Rust multi-line text handling." It is a high-level text layout library that orchestrates several lower-level crates:

- **harfrust** for OpenType shaping (the Rust rewrite of HarfBuzz)
- **fontdb** for font discovery and database management
- **skrifa** for font metric extraction (from the Linebender ecosystem)
- **swash** (optional) for glyph rasterization and basic shaping fallback
- **unicode-bidi**, **unicode-linebreak**, **unicode-script**, **unicode-segmentation** for Unicode text processing

The library's main contribution is gluing these together into a complete pipeline: font loading with fallback -> bidirectional text analysis -> word segmentation -> shaping with font fallback -> line wrapping -> layout with alignment -> optional rasterization.

**Source file**: `Cargo.toml` lines 1-88
**Source file**: `src/lib.rs` lines 1-154

---

## 2. Dependency Map

### Core Dependencies (always included)

| Crate | Version | Purpose |
|-------|---------|---------|
| `harfrust` | 0.5.0 | OpenType text shaping (Rust HarfBuzz port) |
| `fontdb` | 0.23 | Font database, discovery, system font loading |
| `skrifa` | 0.40.0 | Font metric extraction (Linebender `read-fonts` ecosystem) |
| `unicode-bidi` | 0.3.18 | Bidirectional text algorithm (UAX #9) |
| `unicode-linebreak` | 0.1.5 | Line break opportunities (UAX #14) |
| `unicode-script` | 0.5.8 | Script detection per character |
| `unicode-segmentation` | 1.12.0 | Grapheme cluster / word boundaries |
| `rangemap` | 1.7.1 | Range-based attribute spans |
| `smol_str` | 0.3.2 | Small string optimization for font family names |
| `self_cell` | 1.2.2 | Self-referential struct for `Font` (owns data + borrows `Shaper`) |
| `rustc-hash` | 2.1.1 | Fast hashing (FxHasher) for caches |
| `bitflags` | 2.10.0 | `CacheKeyFlags` (FAKE_ITALIC, DISABLE_HINTING, PIXEL_FONT) |
| `linebender_resource_handle` | 0.1.1 | `FontData` / `Blob` for font data sharing |
| `log` | 0.4.29 | Logging |

**Source**: `Cargo.toml` lines 12-32

### Optional Dependencies

| Crate | Version | Feature gate | Purpose |
|-------|---------|-------------|---------|
| `swash` | 0.2.6 | `swash` (default) | Glyph rasterization + `Basic` shaping mode |
| `sys-locale` | 0.3.2 | `std` | System locale detection |
| `syntect` | 5.3.0 | `vi` | Syntax highlighting for editor |
| `cosmic_undo_2` | 0.2.0 | `vi` | Undo/redo for editor |
| `modit` | 0.1.5 | `vi` | Vi modal editing |
| `hashbrown` | 0.16 | `no_std` | HashMap for no_std environments |
| `libm` | 0.2.16 | `no_std` | Math functions for no_std |
| `core_maths` | 0.1.1 | `no_std` | Float methods for no_std |

**Source**: `Cargo.toml` lines 34-63

### Important note: "rustybuzz" is gone

cosmic-text v0.17.1 uses **`harfrust`** (version 0.5.0), not `rustybuzz`. `harfrust` is the pure-Rust rewrite of HarfBuzz that was formerly known as `rustybuzz`. The API is similar but not identical -- it uses `harfrust::Shaper`, `harfrust::ShaperData`, `harfrust::ShaperInstance`, `harfrust::ShapePlan`, `harfrust::UnicodeBuffer`, etc.

---

## 3. Source File Structure

```
src/
  lib.rs              -- Crate root, re-exports everything
  attrs.rs            -- Attrs, AttrsList, AttrsOwned, Color, FontFeatures, LetterSpacing
  bidi_para.rs        -- BidiParagraphs iterator (optimized paragraph splitting)
  buffer.rs           -- Buffer, Metrics, LayoutRun, LayoutRunIter, cursor/scroll/rendering
  buffer_line.rs      -- BufferLine (text + attrs + cached shape + cached layout)
  cached.rs           -- Cached<T> helper (Empty/Unused/Used tri-state)
  cursor.rs           -- Cursor, Affinity, LayoutCursor, Motion, Scroll
  glyph_cache.rs      -- CacheKey, CacheKeyFlags, SubpixelBin, PhysicalGlyph
  layout.rs           -- LayoutGlyph, LayoutLine, Wrap, Align, Hinting
  line_ending.rs      -- LineEnding enum, LineIter
  math.rs             -- floorf, roundf, truncf (std vs libm)
  render.rs           -- Renderer trait, LegacyRenderer
  shape.rs            -- Shaping, ShapeBuffer, ShapeGlyph, ShapeWord, ShapeSpan, ShapeLine
  shape_run_cache.rs  -- ShapeRunKey, ShapeRunCache
  swash.rs            -- SwashCache, swash_image(), swash_outline_commands()
  font/
    mod.rs            -- Font struct, OwnedFace/OwnedFaceData
    system.rs         -- FontSystem, FontMatchKey, BorrowedWithFontSystem
    fallback/
      mod.rs          -- Fallback trait, Fallbacks, FontFallbackIter
      macos.rs        -- macOS platform fallback lists
      unix.rs         -- Linux/Unix platform fallback lists
      windows.rs      -- Windows platform fallback lists
      other.rs        -- Other platform fallback lists
  edit/
    mod.rs            -- Edit trait, Action, Selection, Change, ChangeItem
    editor.rs         -- Editor implementation
    syntect.rs        -- Syntax highlighting editor
    vi.rs             -- Vi modal editor
```

---

## 4. What Each Dependency Provides

### 4.1 harfrust (formerly rustybuzz) -- OpenType Shaping

**What cosmic-text gets**: Complex text shaping -- the process of converting Unicode codepoints into positioned glyph IDs respecting OpenType features (ligatures, kerning, contextual alternates, etc.).

**Key types used**:
- `harfrust::Shaper` -- The main shaping engine, constructed from font data. Stored in `OwnedFace` via `self_cell`.
  - **File**: `src/font/mod.rs` lines 34-41 (`self_cell!` macro creating `OwnedFace`)
  - **File**: `src/font/mod.rs` lines 93-95 (`fn shaper()` returns `&harfrust::Shaper<'_>`)
- `harfrust::ShaperData` -- Pre-parsed shaping tables from the font.
  - **File**: `src/font/mod.rs` lines 200-204 (constructed in `Font::new()`)
- `harfrust::ShaperInstance` -- Variation instance for the shaper (carries font variation coordinates).
  - **File**: `src/font/mod.rs` lines 97-99 (`fn shaper_instance()`)
  - **File**: `src/font/mod.rs` lines 201 (created from `font_ref.axes().location()`)
- `harfrust::UnicodeBuffer` -- Input buffer for text to be shaped. Set direction, push text.
  - **File**: `src/shape.rs` lines 95-96 (stored in `ShapeBuffer`)
  - **File**: `src/shape.rs` lines 136-151 (configured with direction, text pushed)
- `harfrust::ShapePlan` -- Cached shaping plan for a given script/direction/features combination.
  - **File**: `src/shape.rs` lines 92 (cached in `ShapeBuffer.shape_plan_cache`)
  - **File**: `src/shape.rs` lines 169-198 (plan lookup/creation)
- `harfrust::Feature` -- OpenType feature specification (tag + value + range).
  - **File**: `src/shape.rs` lines 160-166 (converted from cosmic-text's `attrs.font_features`)
- `harfrust::Direction` -- LTR/RTL direction setting.
  - **File**: `src/shape.rs` lines 137-141
- `harfrust::GlyphBuffer` -- Output of shaping, contains glyph infos and positions.
  - **File**: `src/shape.rs` lines 200-204 (result of `shaper.shape_with_plan()`)

**The shaping call chain**:
1. `shape_fallback()` in `src/shape.rs` line 120 is the core shaping function
2. It creates/reuses a `harfrust::UnicodeBuffer`, sets direction, pushes text
3. It looks up or creates a `harfrust::ShapePlan` (cached in `ShapeBuffer.shape_plan_cache`, max 6 plans)
4. It calls `font.shaper().shape_with_plan(shape_plan, buffer, &features)` at line 200-202
5. Results are extracted from `glyph_infos` and `glyph_positions` at lines 203-204

### 4.2 fontdb -- Font Database and Discovery

**What cosmic-text gets**: System font enumeration, font face metadata (family, weight, stretch, style, monospaced flag), font data access, font querying by attributes.

**Key types used**:
- `fontdb::Database` -- The font database. Stored inside `FontSystem`.
  - **File**: `src/font/system.rs` line 127 (`db: fontdb::Database`)
  - **File**: `src/font/system.rs` lines 190-191 (`db.load_system_fonts()`)
- `fontdb::ID` -- Unique font face identifier. Used pervasively as the font key.
  - **File**: `src/font/mod.rs` line 55 (`id: fontdb::ID`)
  - **File**: `src/shape.rs` line 570 (`font_id: fontdb::ID` in ShapeGlyph)
  - **File**: `src/layout.rs` line 26 (`font_id: fontdb::ID` in LayoutGlyph)
  - **File**: `src/glyph_cache.rs` line 21 (`font_id: fontdb::ID` in CacheKey)
- `fontdb::FaceInfo` -- Metadata about a font face (families, weight, stretch, style, monospaced).
  - **File**: `src/font/system.rs` lines 31-48 (`FontMatchKey::new()` reads from `FaceInfo`)
- `fontdb::Query` -- Used to find the best matching font for given attributes.
  - **File**: `src/font/system.rs` lines 373-378 (`Query { families, weight, stretch, style }`)
- `fontdb::Source` -- Font data source (Binary, File, SharedFile).
  - **File**: `src/font/mod.rs` lines 124-134 (data extraction in `Font::new()`)
- Re-exported types: `fontdb::Family`, `fontdb::Stretch`, `fontdb::Style`, `fontdb::Weight`
  - **File**: `src/attrs.rs` line 12

### 4.3 skrifa -- Font Metrics Extraction

**What cosmic-text gets**: Reading font metrics (ascent, descent, units_per_em), glyph metrics (advance widths), charmap access, and OpenType table access (GPOS, GSUB script lists for monospace fallback). Also provides `FontRef` for parsing font data and `Location` for variable font axis coordinates.

**Key types used**:
- `skrifa::FontRef` -- Parsed font reference for reading tables.
  - **File**: `src/font/mod.rs` line 140 (`FontRef::from_index()`)
- `skrifa::metrics::Metrics` -- Font-level metrics (ascent, descent, units_per_em).
  - **File**: `src/font/mod.rs` line 144 (`font_ref.metrics(Size::unscaled(), &location)`)
  - **File**: `src/font/mod.rs` line 101-103 (exposed via `fn metrics()`)
- `skrifa::prelude::*` -- `Size`, `Tag`, `LocationRef`, etc.
  - **File**: `src/font/mod.rs` lines 141-143 (axis location for variable fonts)
- `skrifa::raw::TableProvider` -- Access to raw OpenType tables (gpos, gsub).
  - **File**: `src/font/mod.rs` lines 163-180 (reading script lists for monospace fallback)
  - **File**: `src/font/system.rs` lines 223-237 (per-script monospace font ID mapping)
- Charmap access via `font_ref.charmap()`:
  - **File**: `src/font/mod.rs` lines 148-157 (monospace em width calculation)

**CRITICAL**: skrifa is used ONLY at `Font::new()` time (construction). The `Location` (variable font coordinates) is computed once and then passed to harfrust's `ShaperInstance`. After construction, skrifa's `FontRef` is not retained. Only the resulting `Metrics` are stored.

### 4.4 swash -- Glyph Rasterization (and Basic Shaping)

**What cosmic-text gets**: Two things:

1. **Glyph rasterization** (the main purpose): Converting glyph IDs into pixel images or outline paths.
2. **Basic shaping mode** (fallback): A simple 1:1 character-to-glyph mapping without complex shaping.

**For rasterization** (`src/swash.rs`):
- `swash::scale::ScaleContext` -- Scaler context for building glyph images.
  - **File**: `src/swash.rs` line 132 (stored in `SwashCache`)
- `swash::scale::Render` / `Source` / `StrikeWith` -- Rendering pipeline configuration.
  - **File**: `src/swash.rs` lines 56-63 (color outline -> color bitmap -> standard outline)
- `swash::zeno::Format`, `Vector`, `Transform`, `Angle` -- Subpixel positioning and transforms.
  - **File**: `src/swash.rs` lines 46-75 (offset calculation, fake italic transform)
- `swash::scale::image::Image` / `Content` -- The rasterized glyph image.
  - **File**: `src/swash.rs` lines 12-13 (re-exported as `SwashImage`, `SwashContent`)
- `swash::FontRef` -- Created from raw font data for the scaler.
  - **File**: `src/font/mod.rs` lines 111-118 (`fn as_swash()`)

**For Basic shaping** (`src/shape.rs` lines 477-544):
- `swash::FontRef::charmap()` -- Simple character-to-glyph mapping.
- `swash::FontRef::metrics()` -- Font metrics.
- `swash::FontRef::glyph_metrics()` -- Per-glyph advance widths.
- This path SKIPS harfrust entirely. No ligatures, no complex shaping.

**For ligature detection** (`src/shape.rs` lines 876-893):
- `swash::FontRef::charmap()` is used to detect whether glyphs were modified by the shaper (contextual alternates/ligatures), which prevents breaking ligatures at line break boundaries.

### 4.5 unicode-bidi -- Bidirectional Text

**What cosmic-text gets**: The Unicode Bidirectional Algorithm (UAX #9) for handling mixed LTR/RTL text.

**Key usage**:
- `unicode_bidi::BidiInfo::new()` -- Analyze text for bidirectional properties.
  - **File**: `src/shape.rs` line 1041 (in `ShapeLine::build()`)
  - **File**: `src/bidi_para.rs` line 51 (in `BidiParagraphs::new()` for complex text)
- `unicode_bidi::Level` -- Embedding level (even=LTR, odd=RTL). Used throughout layout.
  - **File**: `src/shape.rs` line 758 (`level: unicode_bidi::Level` in `ShapeSpan`)
  - **File**: `src/layout.rs` line 36 (`level: unicode_bidi::Level` in `LayoutGlyph`)
- `unicode_bidi::Paragraph` -- Paragraph info for level adjustment.
  - **File**: `src/shape.rs` lines 1124-1174 (`ShapeLine::adjust_levels()`)
- `unicode_bidi::BidiClass` -- Character classification for whitespace level resetting.
  - **File**: `src/bidi_para.rs` line 4 (paragraph boundary detection)

**Note**: cosmic-text has a custom `BidiParagraphs` iterator (`src/bidi_para.rs`) that fast-paths simple ASCII text to avoid `BidiInfo` allocation entirely.

### 4.6 unicode-linebreak -- Line Break Opportunities

**What cosmic-text gets**: UAX #14 line break opportunity detection.

- `unicode_linebreak::linebreaks()` -- Returns break opportunities in a string.
  - **File**: `src/shape.rs` line 830 (in `ShapeSpan::build()` -- splits spans into words at break points)

This is the primary word-boundary detection for line wrapping. Each break opportunity becomes a potential word boundary in the `ShapeWord` list.

### 4.7 unicode-script -- Script Detection

**What cosmic-text gets**: Per-character script identification, used for font fallback decisions.

- `unicode_script::Script` -- Script enum (Latin, Arabic, Han, etc.).
  - **File**: `src/shape.rs` lines 24, 98 (stored in `ShapeBuffer.scripts`)
  - **File**: `src/shape.rs` lines 290-299 (collecting scripts from run text)
  - **File**: `src/font/fallback/mod.rs` lines 9, 76 (script-based fallback lookup)
- `UnicodeScript` trait on `char` -- `.script()` method.
  - **File**: `src/shape.rs` line 291 (`c.script()`)

### 4.8 unicode-segmentation -- Grapheme Clusters

**What cosmic-text gets**: Grapheme cluster boundary detection for proper character handling and word boundary detection.

- `UnicodeSegmentation::grapheme_indices()` -- Used for attribute boundary splitting in word shaping.
  - **File**: `src/shape.rs` line 710 (in `ShapeWord::build()` -- iterating graphemes within words)
- `UnicodeSegmentation::unicode_word_indices()` -- Used for word-boundary cursor movement.
  - **File**: `src/buffer.rs` lines 1268, 1282 (`Motion::PreviousWord`, `Motion::NextWord`)

---

## 5. Core Data Flow

The complete pipeline, traced through the source:

### Stage 1: Font Loading

```
FontSystem::new()                          [src/font/system.rs:181]
  -> fontdb::Database::load_system_fonts() [src/font/system.rs:428]
  -> Collect monospace font IDs            [src/font/system.rs:208-215]
  -> Build per-script monospace map        [src/font/system.rs:220-239]
  -> Initialize Fallbacks                  [src/font/system.rs:246]

FontSystem::get_font(id, weight)           [src/font/system.rs:292]
  -> Font::new(db, id, weight)             [src/font/mod.rs:122]
    -> fontdb: Get face data               [src/font/mod.rs:123-134]
    -> skrifa: Parse FontRef               [src/font/mod.rs:140]
    -> skrifa: Compute location with wght  [src/font/mod.rs:141-143]
    -> skrifa: Extract metrics             [src/font/mod.rs:144]
    -> harfrust: Create ShaperInstance     [src/font/mod.rs:201-202]
    -> harfrust: Create ShaperData         [src/font/mod.rs:203]
    -> harfrust: Build Shaper              [src/font/mod.rs:228-233]
    -> swash: Parse FontRef (optional)     [src/font/mod.rs:211-214]
  -> Arc::new(font) -> cache               [src/font/system.rs:301]
```

**CRITICAL OBSERVATION**: The `wght` axis location is set at `Font::new()` time using the `weight` parameter passed in. This means the harfrust `ShaperInstance` is baked with a specific weight coordinate. See Section 10 for the implications.

### Stage 2: Text Shaping

```
Buffer::set_text() / set_rich_text()       [src/buffer.rs:692-886]
  -> Creates BufferLine(s)                 [src/buffer_line.rs:27-43]
  -> shape_until_scroll()                  [src/buffer.rs:413-489]
    -> line_layout() for each visible line [src/buffer.rs:534-549]
      -> BufferLine::shape()               [src/buffer_line.rs:213-230]
        -> ShapeLine::build()              [src/shape.rs:1026-1121]
          -> BidiInfo::new() for bidi      [src/shape.rs:1041]
          -> adjust_levels()               [src/shape.rs:1055, 1124-1174]
          -> For each bidi span:
            ShapeSpan::build()             [src/shape.rs:799-961]
              -> unicode_linebreak()       [src/shape.rs:830]
              -> For each word:
                ShapeWord::build()         [src/shape.rs:662-743]
                  -> grapheme iteration    [src/shape.rs:710]
                  -> Shaping::run()        [src/shape.rs:48-82]
                    -> shape_run()         [src/shape.rs:275-415]
                      -> Script detection  [src/shape.rs:290-299]
                      -> Font matching     [src/shape.rs:305]
                      -> FontFallbackIter  [src/shape.rs:308-315]
                      -> shape_fallback()  [src/shape.rs:120-273]
                        -> harfrust buffer setup  [src/shape.rs:136-151]
                        -> ShapePlan lookup/create [src/shape.rs:169-198]
                        -> shaper.shape_with_plan() [src/shape.rs:200-202]
                        -> Extract glyphs  [src/shape.rs:209-242]
                      -> Fallback loop for missing glyphs [src/shape.rs:328-401]
```

### Stage 3: Layout

```
BufferLine::layout()                       [src/buffer_line.rs:239-269]
  -> ShapeLine::layout_to_buffer()         [src/shape.rs:1263-1808]
    -> Word wrapping (None/Glyph/Word/WordOrGlyph) [src/shape.rs:1316-1594]
    -> Visual line construction            [src/shape.rs:1293-1601]
    -> BiDi reordering                     [src/shape.rs:1177-1238, 1624]
    -> Alignment/justification             [src/shape.rs:1632-1675]
    -> Glyph positioning (x,y coords)      [src/shape.rs:1692-1753]
    -> Produce LayoutLine(s)               [src/shape.rs:1777-1789]
```

### Stage 4: Rendering (optional, requires `swash` feature)

```
Buffer::draw() / Buffer::render()          [src/buffer.rs:1364-1389]
  -> For each LayoutRun:
    -> For each LayoutGlyph:
      -> glyph.physical(offset, scale)     [src/layout.rs:74-91]
        -> CacheKey::new()                 [src/glyph_cache.rs:37-61]
      -> SwashCache::with_pixels()         [src/swash.rs:195-245]
        -> swash_image()                   [src/swash.rs:15-78]
          -> font.as_swash()               [src/font/mod.rs:111-118]
          -> Scaler with wght variation     [src/swash.rs:25-42]
          -> Render pipeline               [src/swash.rs:56-78]
```

---

## 6. The Shaping Pipeline

### 6.1 ShapeBuffer (`src/shape.rs` lines 88-112)

The central scratch space for shaping operations. Contains:

- `shape_plan_cache: VecDeque<(fontdb::ID, harfrust::ShapePlan)>` -- LRU cache of up to 6 shape plans
- `harfrust_buffer: Option<harfrust::UnicodeBuffer>` -- Reusable harfrust buffer (avoids reallocation)
- `scripts: Vec<Script>` -- Temporary buffer for detected scripts
- `spans: Vec<ShapeSpan>` -- Temporary buffer for shape spans
- `words: Vec<ShapeWord>` -- Temporary buffer for shape words
- `visual_lines: Vec<VisualLine>` -- Temporary buffer for visual line computation
- `glyph_sets: Vec<Vec<LayoutGlyph>>` -- Reusable glyph vectors for layout lines

ShapeBuffer is stored on `FontSystem` (line `src/font/system.rs:147`) and passed through the pipeline. All temporary buffers are aggressively reused via `mem::take()` and restoration patterns to minimize allocation.

### 6.2 ShapeGlyph (`src/shape.rs` lines 559-577)

The output of shaping for a single glyph:

```rust
pub struct ShapeGlyph {
    pub start: usize,           // byte index in original text
    pub end: usize,             // byte index end in original text
    pub x_advance: f32,         // horizontal advance (em units, normalized by units_per_em)
    pub y_advance: f32,         // vertical advance (em units)
    pub x_offset: f32,          // horizontal offset from baseline (em units)
    pub y_offset: f32,          // vertical offset from baseline (em units)
    pub ascent: f32,            // font ascent (em units)
    pub descent: f32,           // font descent (em units)
    pub font_monospace_em_width: Option<f32>,  // monospace width if applicable
    pub font_id: fontdb::ID,    // which font this glyph came from
    pub font_weight: fontdb::Weight,  // weight used for this glyph
    pub glyph_id: u16,          // the shaped glyph ID
    pub color_opt: Option<Color>,     // optional color override
    pub metadata: usize,        // user metadata
    pub cache_key_flags: CacheKeyFlags,  // rendering flags
    pub metrics_opt: Option<Metrics>,    // per-glyph metrics override
}
```

**Key observation**: All advances/offsets are in **em units** (divided by `units_per_em` at line 132-133 and 217-221). They get multiplied by `font_size` during layout.

### 6.3 ShapeWord (`src/shape.rs` lines 617-753)

Groups ShapeGlyphs into words for line wrapping:

```rust
pub struct ShapeWord {
    pub blank: bool,            // true if this is a whitespace "word"
    pub glyphs: Vec<ShapeGlyph>,
}
```

`ShapeWord::build()` (line 662) handles attribute-boundary splitting within words. If the text within a word has different attributes (font, weight, etc.), it splits the word into multiple shaping runs at grapheme boundaries. There's a fast path for simple ASCII text (line 686-705).

### 6.4 ShapeSpan (`src/shape.rs` lines 756-961)

Groups ShapeWords into bidirectional spans:

```rust
pub struct ShapeSpan {
    pub level: unicode_bidi::Level,  // BiDi embedding level
    pub words: Vec<ShapeWord>,
}
```

`ShapeSpan::build()` (line 799) is where `unicode_linebreak::linebreaks()` is called to find word boundaries. It also handles:
- Ligature detection at line break boundaries (lines 831-893) -- probes whether splitting at a break point would destroy a ligature by test-shaping the boundary characters
- Whitespace word separation (lines 898-938)
- RTL glyph/word reversal (lines 943-956)

### 6.5 ShapeLine (`src/shape.rs` lines 964-1121)

The top-level shape result for one paragraph:

```rust
pub struct ShapeLine {
    pub rtl: bool,              // paragraph direction
    pub spans: Vec<ShapeSpan>,
    pub metrics_opt: Option<Metrics>,  // default metrics from attrs
}
```

`ShapeLine::build()` (line 1026):
1. Runs `unicode_bidi::BidiInfo::new()` to analyze bidirectional text
2. Calls `adjust_levels()` to handle whitespace level resetting per UAX #9 L1
3. Finds consecutive level runs and creates a `ShapeSpan` for each
4. Adjusts tab stop positions (lines 1099-1113)

### 6.6 ShapeRunCache (`src/shape_run_cache.rs`)

Optional caching of shaped runs (feature `shape-run-cache`):

```rust
pub struct ShapeRunKey {
    pub text: String,
    pub default_attrs: AttrsOwned,
    pub attrs_spans: Vec<(Range<usize>, AttrsOwned)>,
}
```

Keyed by text content + attributes. Has age-based eviction via `trim()`.

---

## 7. The Layout Pipeline

### 7.1 LayoutGlyph (`src/layout.rs` lines 14-61)

The positioned glyph for rendering:

```rust
pub struct LayoutGlyph {
    pub start: usize,            // byte index in original text
    pub end: usize,              // byte index end
    pub font_size: f32,          // pixel font size
    pub font_weight: fontdb::Weight, // font weight
    pub line_height_opt: Option<f32>, // line height override
    pub font_id: fontdb::ID,     // font ID
    pub glyph_id: u16,           // glyph ID
    pub x: f32,                  // X position (pixels)
    pub y: f32,                  // Y position (pixels)
    pub w: f32,                  // Width (pixels) -- the hitbox width
    pub level: unicode_bidi::Level,  // BiDi level
    pub x_offset: f32,           // X offset (em units, multiply by font_size for pixels)
    pub y_offset: f32,           // Y offset (em units)
    pub color_opt: Option<Color>,
    pub metadata: usize,
    pub cache_key_flags: CacheKeyFlags,
}
```

**Conversion from ShapeGlyph**: `ShapeGlyph::layout()` at line 580-607 converts to LayoutGlyph with pixel coordinates.

### 7.2 LayoutLine (`src/layout.rs` lines 96-107)

```rust
pub struct LayoutLine {
    pub w: f32,                  // total width of the line
    pub max_ascent: f32,         // maximum ascent in pixels
    pub max_descent: f32,        // maximum descent in pixels
    pub line_height_opt: Option<f32>,  // line height override
    pub glyphs: Vec<LayoutGlyph>,
}
```

### 7.3 Layout Process (`src/shape.rs` lines 1240-1808)

`ShapeLine::layout_to_buffer()` is the main layout function. It:

1. **Word wrapping** (lines 1316-1594): Iterates over spans and words, fitting them into visual lines respecting `width_opt` and the `Wrap` mode:
   - `Wrap::None` -- No wrapping, all spans on one line
   - `Wrap::Word` -- Break at word boundaries only
   - `Wrap::Glyph` -- Break at any glyph
   - `Wrap::WordOrGlyph` -- Try word first, fall back to glyph if word won't fit

2. **BiDi reordering** (lines 1177-1238, called at 1624): Reorders visual line segments according to UAX #9 L2 algorithm.

3. **Alignment** (lines 1632-1675): Applies text alignment:
   - `Align::Left`, `Align::Right`, `Align::Center`, `Align::End`
   - `Align::Justified` -- Distributes extra space among blank words

4. **Glyph positioning** (lines 1692-1753): For each glyph in the reordered line:
   - Multiplies em-unit advances by font_size to get pixel positions
   - Handles monospace width matching
   - Applies hinting (rounding to integer coordinates)
   - Handles justification expansion
   - Tracks max ascent/descent

5. **Produces `LayoutLine`s** (lines 1777-1789)

### 7.4 Wrap Enum (`src/layout.rs` lines 110-120)

```rust
pub enum Wrap {
    None,
    Glyph,
    Word,
    WordOrGlyph,
}
```

### 7.5 Align Enum (`src/layout.rs` lines 134-141)

```rust
pub enum Align {
    Left, Right, Center, Justified, End,
}
```

### 7.6 Hinting (`src/layout.rs` lines 157-178)

```rust
pub enum Hinting {
    Disabled,  // default -- subpixel coordinates
    Enabled,   // snap X-axis to integers during layout
}
```

---

## 8. The Rasterization Layer

### 8.1 SwashCache (`src/swash.rs` lines 131-246)

Provides cached glyph rasterization:

```rust
pub struct SwashCache {
    context: ScaleContext,       // swash scaling context
    pub image_cache: HashMap<CacheKey, Option<SwashImage>>,
    pub outline_command_cache: HashMap<CacheKey, Option<Box<[Command]>>>,
}
```

**Key methods**:
- `get_image(font_system, cache_key)` -- Returns rasterized glyph image (cached)
- `get_outline_commands(font_system, cache_key)` -- Returns outline path commands (cached)
- `with_pixels(font_system, cache_key, base_color, callback)` -- Iterates over pixels with blending

### 8.2 CacheKey (`src/glyph_cache.rs` lines 18-61)

```rust
pub struct CacheKey {
    pub font_id: fontdb::ID,
    pub glyph_id: u16,
    pub font_size_bits: u32,     // f32 as bits for exact comparison
    pub x_bin: SubpixelBin,      // subpixel X position (4 bins: 0, 0.25, 0.5, 0.75)
    pub y_bin: SubpixelBin,      // subpixel Y position
    pub font_weight: fontdb::Weight,  // weight for variable fonts
    pub flags: CacheKeyFlags,
}
```

### 8.3 The swash Rasterization Path (`src/swash.rs` lines 15-78)

`swash_image()` function:
1. Gets the font from FontSystem
2. Creates `swash::FontRef` via `font.as_swash()`
3. **Checks for `wght` variation axis** (lines 25-28)
4. **Sets weight variation** if found (lines 36-41) -- this is where variable font weight is applied for rasterization
5. Builds scaler with size and hinting
6. Configures render pipeline: ColorOutline -> ColorBitmap -> Outline
7. Applies fake italic transform if flagged
8. Renders the glyph

---

## 9. Caching Architecture

### 9.1 FontSystem Caches (`src/font/system.rs` lines 122-161)

```
FontSystem {
    font_cache: HashMap<(fontdb::ID, Weight), Option<Arc<Font>>>  // Loaded fonts
    font_matches_cache: HashMap<FontMatchAttrs, Arc<Vec<FontMatchKey>>>  // Font matching results (max 256)
    font_codepoint_support_info_cache: HashMap<fontdb::ID, ...>   // Codepoint support (for monospace fallback)
    shape_buffer: ShapeBuffer    // Reusable shaping scratch space
    shape_run_cache: ShapeRunCache  // Optional shaped run cache
}
```

**Font cache key**: `(fontdb::ID, fontdb::Weight)` -- This means the same font face at different weights gets separate cache entries and separate `Font` objects with different harfrust `ShaperInstance`s.

### 9.2 BufferLine Caches (`src/buffer_line.rs` lines 12-21)

```
BufferLine {
    shape_opt: Cached<ShapeLine>,       // Cached shaping result
    layout_opt: Cached<Vec<LayoutLine>>, // Cached layout result
}
```

Uses the `Cached<T>` tri-state (Empty/Unused/Used) to enable buffer reuse without reallocation:
- `Unused` means the value's memory is available for reuse but the data is stale
- `Used` means the data is current and valid
- Transitioning from Used -> Unused via `set_unused()` preserves the allocation

### 9.3 ShapeBuffer Allocation Reuse (`src/shape.rs`)

The `ShapeBuffer` employs an aggressive allocation-reuse strategy:
- `harfrust_buffer` is taken, used, cleared, and restored (lines 136, 270)
- `scripts`, `spans`, `words` vectors are taken via `mem::take()` and restored
- `visual_lines` and `glyph_sets` are drained and cached for reuse
- Shape plan cache is a bounded `VecDeque` (max 6 entries, FIFO eviction)

### 9.4 SwashCache (`src/swash.rs` lines 131-135)

Two HashMaps keyed by `CacheKey`:
- `image_cache` for rasterized glyph images
- `outline_command_cache` for vector outline paths

No eviction policy -- grows unbounded. User is expected to create one per application.

---

## 10. Variable Font Axis Handling -- The Critical Gap

This is the most important section for understanding cosmic-text's limitations.

### 10.1 Where Weight is Set

**At Font::new() time** (`src/font/mod.rs` lines 122-241):

```rust
pub fn new(db: &fontdb::Database, id: fontdb::ID, weight: fontdb::Weight) -> Option<Self> {
    // ...
    let font_ref = FontRef::from_index((*data).as_ref(), info.index).ok()?;
    let location = font_ref
        .axes()
        .location([(Tag::new(b"wght"), weight.0 as f32)]);  // LINE 141-143
    let metrics = font_ref.metrics(Size::unscaled(), &location);  // LINE 144
    // ...
    let (shaper_instance, shaper_data) = {
        (
            harfrust::ShaperInstance::from_coords(
                &font_ref,
                location.coords().iter().copied()   // LINE 202
            ),
            harfrust::ShaperData::new(&font_ref),
        )
    };
```

The `weight` parameter flows to:
1. `skrifa::FontRef::axes().location()` -- sets the `wght` axis coordinate
2. `skrifa::FontRef::metrics()` -- extracts metrics AT that coordinate
3. `harfrust::ShaperInstance::from_coords()` -- bakes the coordinate into the shaper

### 10.2 How Font::new() is Called

From `FontSystem::get_font()` (`src/font/system.rs` lines 292-311):
```rust
pub fn get_font(&mut self, id: fontdb::ID, weight: fontdb::Weight) -> Option<Arc<Font>> {
    self.font_cache
        .entry((id, weight))
        .or_insert_with(|| {
            // ...
            Font::new(&self.db, id, weight)
            // ...
        })
        .clone()
}
```

And from `FontFallbackIter` (`src/font/fallback/mod.rs`), where the `ideal_weight` is passed:
```rust
self.font_system.get_font(m_key.id, self.ideal_weight)  // lines 293, 336, 350, 414, 429, 470
```

The `ideal_weight` comes from `FontFallbackIter::new()`:
```rust
pub fn new(
    font_system: &'a mut FontSystem,
    // ...
    ideal_weight: fontdb::Weight,
) -> Self {
```

Which is called in `shape_run()` (`src/shape.rs` lines 308-315):
```rust
let mut font_iter = FontFallbackIter::new(
    font_system,
    &fonts,
    &default_families,
    &scripts,
    &line[start_run..end_run],
    attrs.weight,     // <-- THIS IS THE WEIGHT FROM ATTRS
);
```

### 10.3 What This Means

The weight flows as: **Attrs.weight -> FontFallbackIter -> FontSystem::get_font() -> Font::new() -> skrifa location -> harfrust ShaperInstance**.

This means:
- **Shaping IS weight-aware**: The harfrust `ShaperInstance` carries the weight coordinate, so OpenType features that depend on the weight axis (GPOS kerning variations, etc.) are correctly applied for the requested weight.
- **Metrics ARE weight-aware**: `skrifa::Metrics` are extracted at the correct weight location.
- **Font cache keys include weight**: `(fontdb::ID, fontdb::Weight)` means different weights create different `Font` instances.

### 10.4 Only `wght` is Handled

Looking at `Font::new()` line 141-143:
```rust
let location = font_ref
    .axes()
    .location([(Tag::new(b"wght"), weight.0 as f32)]);
```

**ONLY the `wght` (weight) axis is set.** No other variable font axes are configured:
- `wdth` (width/stretch) -- NOT passed through, even though `Attrs` has a `stretch` field
- `slnt` (slant) -- NOT passed through
- `ital` (italic) -- NOT passed through (fake italic is used instead via `CacheKeyFlags::FAKE_ITALIC`)
- Custom axes -- NOT supported at all

The `Attrs.stretch` field (`fontdb::Stretch`) is used ONLY for font matching/selection (finding which font face to use), not for setting variable font coordinates.

### 10.5 The Rasterization Path is Different

In `swash_image()` (`src/swash.rs` lines 25-41):
```rust
let variable_width = font
    .as_swash()
    .variations()
    .find_by_tag(swash::Tag::from_be_bytes(*b"wght"));

let mut scaler = context
    .builder(font.as_swash())
    .size(f32::from_bits(cache_key.font_size_bits))
    .hint(!cache_key.flags.contains(CacheKeyFlags::DISABLE_HINTING));
if let Some(variation) = variable_width {
    scaler = scaler.variations(std::iter::once(swash::Setting {
        tag: swash::Tag::from_be_bytes(*b"wght"),
        value: f32::from(cache_key.font_weight.0)
            .clamp(variation.min_value(), variation.max_value()),
    }));
}
```

Swash rasterization ALSO only handles `wght`. But it does it independently from harfrust -- it reads `cache_key.font_weight` and applies it as a swash variation setting. This means:

1. **Harfrust shapes** with weight from the `ShaperInstance` (set at Font::new time)
2. **Swash rasterizes** with weight from the `CacheKey.font_weight` (set at layout time from `LayoutGlyph.font_weight`)

These SHOULD be the same weight, since `ShapeGlyph.font_weight` is set from `attrs.weight` at line 234.

### 10.6 The Double-Shaping Concern

There is a potential mismatch pathway:

1. `Font::new(db, id, weight_A)` creates a Font with harfrust `ShaperInstance` at weight A
2. If the same font is later requested at weight B, `FontSystem::get_font(id, weight_B)` creates a NEW Font with a different `ShaperInstance`

This is correct behavior -- each weight gets its own `ShaperInstance`. The concern would be if harfrust's `ShapePlan` cache (in `ShapeBuffer`) confused plans from different weight instances, but it doesn't because the plan cache key includes the font ID AND the plan is matched against the instance via `key.instance(Some(font.shaper_instance()))` at `src/shape.rs` line 171.

### 10.7 What About ShapePlan Caching?

The `ShapeBuffer.shape_plan_cache` (line 92) stores `(fontdb::ID, harfrust::ShapePlan)` pairs. The lookup at lines 174-178 checks both font ID and plan key matching:

```rust
let key = harfrust::ShapePlanKey::new(Some(buffer.script()), buffer.direction())
    .features(&rb_font_features)
    .instance(Some(font.shaper_instance()))  // <-- includes variation coordinates
    .language(language.as_ref());

let shape_plan = match scratch
    .shape_plan_cache
    .iter()
    .find(|(id, plan)| *id == font.id() && key.matches(plan))
```

The `key.instance()` includes the `ShaperInstance` which carries variation coordinates, so plans at different weights will NOT incorrectly match. This is correct.

---

## 11. What cosmic-text Adds vs. Direct Dependency Use

### 11.1 Things cosmic-text provides that you would NOT get from direct crate usage:

1. **Multi-level font fallback** (`src/font/fallback/`): Platform-specific fallback lists, script-based fallback, monospace fallback with codepoint coverage scoring. This is ~500 lines of complex logic in `FontFallbackIter`.

2. **Bidirectional text + word wrapping integration** (`src/shape.rs` ShapeLine/ShapeSpan): The combination of BiDi analysis -> level-run splitting -> word boundary detection -> shaping -> visual reordering is the core value-add.

3. **Line wrapping with multiple modes** (`src/shape.rs` layout_to_buffer): Word, Glyph, WordOrGlyph wrapping with proper BiDi handling.

4. **Text alignment and justification**: Left/Right/Center/End/Justified with BiDi-aware direction handling.

5. **Ligature preservation at line breaks** (`src/shape.rs` lines 831-893): Test-shaping boundary characters to avoid breaking ligatures.

6. **Per-span attribute system** (`src/attrs.rs`): RangeMap-based attribute spans for rich text (different fonts, weights, colors within a line).

7. **Aggressive allocation reuse** (`ShapeBuffer`, `Cached<T>`, buffer reuse patterns): Significant engineering to minimize allocations during reshaping.

8. **Editor infrastructure** (`src/edit/`): Cursor management, selection, undo/redo, vi mode.

9. **Monospace width matching** (layout_to_buffer lines 1696-1729): Adjusting glyph sizes to match a target monospace width.

10. **Tab stop handling** (ShapeLine::build lines 1099-1113): Converting tab characters to appropriate widths.

### 11.2 Things you could get directly from the dependencies:

| Capability | Direct crate | cosmic-text adds |
|-----------|-------------|-----------------|
| Font parsing | skrifa/swash | Caching, lazy loading, data sharing |
| OpenType shaping | harfrust | Font fallback, plan caching, feature conversion |
| Font metrics | skrifa | Weight-aware extraction, caching |
| Glyph rasterization | swash | CacheKey system, image/outline caching |
| BiDi algorithm | unicode-bidi | Integration with shaping spans |
| Line breaks | unicode-linebreak | Integration with word wrapping |
| Script detection | unicode-script | Integration with font fallback |
| Grapheme boundaries | unicode-segmentation | Integration with attribute splitting |
| Font database | fontdb | System font loading, matching, caching |

### 11.3 Things cosmic-text does NOT do:

1. **Arbitrary variable font axis control** -- Only `wght` axis is exposed
2. **Text decoration** (underline, strikethrough) -- Not built in
3. **Inline objects** (images in text flow) -- Not supported
4. **Paragraph-level line breaking optimization** (Knuth-Plass) -- Uses greedy word wrapping
5. **OpenType color font rendering** (COLR v1, SVG) -- Only through swash's basic support
6. **Subpixel anti-aliasing** -- Logged as TODO (`SubpixelMask`)
7. **Shaped text caching across frames** -- BufferLine cache is per-line, not cross-buffer

---

## 12. Summary of Limitations

### Variable Font Axes
- **Only `wght` is supported** at the shaping and rasterization levels
- `wdth`, `slnt`, `ital`, and custom axes are ignored
- `Attrs.stretch` is used for font face selection only, not axis setting
- Fake italic is synthesized via 14-degree skew transform rather than using variable font `ital`/`slnt` axes

### Architecture Constraints
- `Font` objects are immutable after construction -- changing variable font coordinates requires creating a new `Font`
- The font cache key `(fontdb::ID, Weight)` means each unique weight creates a new Font with new harfrust data structures
- `ShapeGlyph.glyph_id` is `u16`, limiting to 65535 glyphs per font
- The `ShapeBuffer.shape_plan_cache` holds only 6 plans (FIFO eviction), which may cause thrashing with many fonts/scripts

### Performance Characteristics
- ShapeBuffer reuse is very well optimized
- FontSystem should be created once per application (system font loading is expensive)
- SwashCache grows unbounded -- no eviction policy
- Font matching cache is cleared entirely when it reaches 256 entries

### API Surface
- No way to pass arbitrary variation coordinates through `Attrs`
- No way to access the underlying harfrust `Shaper` or swash `ScaleContext` directly (Font exposes `shaper()` but not the full pipeline)
- The `Basic` shaping mode (swash-based) is feature-gated and has no font fallback


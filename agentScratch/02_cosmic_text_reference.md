# cosmic_text Library Reference

Location: `clonedCompanions/cosmic-text`
Version: 0.17.1 (Jan 2026)
Maintained by System76 (COSMIC desktop)

---

## Overview

Pure Rust multi-line text handling: font discovery, shaping, layout, and rasterization.
No native text library dependencies. Supports bidirectional text, complex scripts, color emoji, variable fonts.

---

## Core Architecture

```
FontSystem (singleton)
  ├── fontdb::Database (system font discovery)
  ├── Font cache (loaded fonts + HarfRust shapers)
  ├── Fallback system (script/locale aware)
  └── ShapeBuffer (reusable allocations)

Buffer (text container)
  ├── BufferLine[] (paragraphs)
  │   ├── ShapeLine (shaped glyphs, spans, words)
  │   └── LayoutLine[] (positioned glyphs)
  └── Metrics (font_size, line_height)

SwashCache (rendering)
  ├── Image cache (rasterized glyph bitmaps)
  └── Outline cache (vector paths)
```

---

## Key Types

| Type | Purpose |
|------|---------|
| `FontSystem` | Central font database + cache. Create once per app. |
| `Buffer` | Text container with shaping & layout |
| `Metrics` | Font size + line height pair |
| `Attrs` | Text attributes (family, weight, style, color) |
| `AttrsList` | Efficient span management for rich text |
| `LayoutRun` | Renderable text line with positioned glyphs |
| `LayoutGlyph` | Single positioned glyph ready to render |
| `SwashCache` | Glyph rasterization cache |
| `CacheKey` | Unique glyph identifier (font + glyph + size + subpixel bin) |
| `PhysicalGlyph` | Integer-pixel glyph position + cache key |
| `SwashImage` | Rasterized glyph bitmap (placement + pixel data) |

---

## Pipeline

### 1. Font Loading
```rust
let mut font_system = FontSystem::new(); // auto-discovers system fonts
// Or load specific fonts:
font_system.db_mut().load_font_file("path/to/font.ttf")?;
```

### 2. Buffer Setup
```rust
let metrics = Metrics::new(14.0, 20.0); // font_size, line_height
let mut buffer = Buffer::new(&mut font_system, metrics);
buffer.set_size(Some(800.0), Some(600.0)); // width, height constraints
```

### 3. Set Text
```rust
// Plain text
buffer.set_text("Hello, World!", &Attrs::new(), Shaping::Advanced, None);

// Rich text
buffer.set_rich_text(vec![
    ("Bold ", attrs.weight(Weight::BOLD)),
    ("Red", attrs.color(Color::rgb(0xFF, 0, 0))),
]);
```

### 4. Shape & Layout
```rust
buffer.shape_until_scroll(true); // shapes all visible lines
```

### 5. Render
```rust
for run in buffer.layout_runs() {
    for glyph in run.glyphs.iter() {
        let physical = glyph.physical((offset_x, offset_y), scale);
        let image = swash_cache.get_image(&mut font_system, physical.cache_key);
        // image.data = pixel bytes, image.placement = {left, top, width, height}
        // image.content = Mask (1 byte/px) or Color (4 bytes/px, for emoji)
    }
}

// Or use convenience method:
buffer.draw(&mut swash_cache, Color::rgb(255, 255, 255), |x, y, w, h, color| {
    // fill rectangle
});
```

---

## Layout Features

**Wrap modes:** None, Glyph, Word, WordOrGlyph
**Alignment:** Left, Right, Center, Justified, End
**BiDi:** Full bidirectional text support (Arabic, Hebrew)
**Tab expansion:** Configurable tab width (default 8)

---

## Glyph Rasterization

- **Subpixel binning:** Quantizes to 4 bins (0.0, 0.25, 0.5, 0.75) per axis
- **Content types:** Mask (alpha only, 1 byte/px) or Color (RGBA, 4 bytes/px for emoji)
- **Hinting:** Y-axis hinting for crisp horizontal alignment
- **Fake italic:** 14-degree skew transform
- **Variable fonts:** Weight axis adjustment via skrifa

---

## Key Dependencies

- `fontdb` (0.23) -- font discovery
- `harfrust` (0.5.0) -- text shaping (HarfBuzz in Rust)
- `swash` (0.2.6) -- glyph rasterization
- `skrifa` (0.40.0) -- font metrics
- `unicode-bidi`, `unicode-linebreak`, `unicode-script`, `unicode-segmentation`

---

## FFI Considerations

- `FontSystem`, `Buffer`, `SwashCache` must be persistent (opaque pointers)
- Export layout results as flat arrays of positioned glyphs
- Image data owned by SwashCache, must be copied out for FFI
- Color is packed u32 ARGB
- CacheKey is a struct with font_id, glyph_id, size, subpixel bins, flags

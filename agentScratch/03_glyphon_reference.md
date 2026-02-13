# glyphon Library Reference

Location: `clonedCompanions/glyphon`
Purpose: GPU-accelerated 2D text renderer on top of wgpu + cosmic-text

---

## Overview

Glyphon bridges cosmic-text (CPU shaping/rasterization) to wgpu (GPU rendering).
It manages glyph texture atlases, handles caching, and renders all text in a single draw call.

---

## Architecture

```
cosmic-text (shaping + rasterization)
  ↓ glyph images
glyphon TextAtlas (GPU texture atlas packing via etagere)
  ↓ atlas UV coords + glyph positions
glyphon TextRenderer (vertex buffer of glyph quads)
  ↓ single draw call
wgpu RenderPass (TriangleStrip, 4 verts per instance)
```

---

## Core Types

| Type | Purpose |
|------|---------|
| `Cache` | Shared shader, sampler, bind group layouts, pipeline cache |
| `TextAtlas` | GPU texture atlas (separate color + mask atlases) |
| `TextRenderer` | Prepares vertex buffer + issues draw calls |
| `Viewport` | Screen resolution uniform buffer |
| `TextArea` | Input: buffer + position + scale + bounds + color |

---

## Rendering Flow

### Setup (once)
```rust
let cache = Cache::new(&device);
let mut atlas = TextAtlas::new(&device, &queue, &cache, format, ColorMode::Accurate);
let mut renderer = TextRenderer::new(&mut atlas, &device, multisample, depth_stencil);
let mut viewport = Viewport::new(&device, &cache);
```

### Per Frame
```rust
// 1. Update viewport
viewport.update(&queue, Resolution { width, height });

// 2. Prepare (CPU: layout iteration + glyph upload)
renderer.prepare(
    &device, &queue, &mut font_system, &mut atlas, &viewport,
    [TextArea {
        buffer: &buffer,
        left: 10.0, top: 10.0,
        scale: 1.0,
        bounds: TextBounds { left: 0, top: 0, right: w as i32, bottom: h as i32 },
        default_color: Color::rgb(255, 255, 255),
        custom_glyphs: &[],
    }],
    &mut swash_cache,
)?;

// 3. Render (GPU: single draw call)
renderer.render(&atlas, &viewport, &mut render_pass)?;

// 4. Trim LRU cache
atlas.trim();
```

---

## Atlas Details

**Two separate atlases:**
- **Color atlas** (`Rgba8UnormSrgb` or `Rgba8Unorm`): colored glyphs, emoji
- **Mask atlas** (`R8Unorm`): monochrome glyphs (normal text)

**Dynamic growth:** 256 → 512 → 1024 → 2048 → 4096 (device limit)
**Packing:** etagere bucketed atlas allocator
**Eviction:** Unbounded LRU cache, evicts least-recently-used when space needed

---

## Shader (WGSL)

**Vertex shader:**
- Instance-driven: 1 instance per glyph quad, 4 vertices per instance (TriangleStrip)
- Unpacks compact `GlyphToRender` data
- Converts screen coords → NDC
- Optional sRGB → linear conversion (ColorMode::Accurate)

**Fragment shader:**
- Color glyphs: samples color atlas directly
- Mask glyphs: samples R8 mask, multiplies by vertex color (tinting)

**GlyphToRender struct:**
```rust
#[repr(C)]
struct GlyphToRender {
    pos: [i32; 2],           // screen position
    dim: [u16; 2],           // pixel dimensions
    uv: [u16; 2],            // atlas coordinates
    color: u32,              // ARGB packed
    content_type: [u16; 2],  // flags + sRGB indicator
    depth: f32,              // z-order
}
```

---

## Color Modes

| Mode | Atlas Format | Use Case |
|------|-------------|----------|
| `ColorMode::Accurate` | `Rgba8UnormSrgb` | sRGB targets, physically accurate blending |
| `ColorMode::Web` | `Rgba8Unorm` | Linear targets, web-like color behavior |

---

## Blending

Standard alpha blending:
```
srcFactor: SrcAlpha
dstFactor: OneMinusSrcAlpha
```

---

## Custom Glyphs

Supports user-provided rasterization via closure:
```rust
CustomGlyph {
    id: CustomGlyphId(0),
    left: 100.0, top: 100.0,
    width: 64.0, height: 64.0,
    color: None,  // or Some(Color)
    snap_to_physical_pixel: true,
    metadata: 0,
}
```

Rasterizer closure called during `prepare()` when glyph not in cache.

---

## Key Dependencies

- `wgpu` 28.0.0
- `cosmic-text` 0.15
- `etagere` 0.2.15 (rectangle packing)
- `lru` 0.16.2 (LRU cache)

---

## Integration Notes for P5GPU

**Advantages:**
- Single draw call per frame (very efficient)
- Handles atlas management, LRU eviction, dynamic growth
- Supports both text and emoji
- Built for wgpu (same GPU API as P5GPU's WebGPU)

**Challenges for Deno FFI integration:**
- glyphon is deeply coupled to wgpu Rust types (Device, Queue, RenderPass)
- Cannot easily pass wgpu handles across FFI boundary
- Would need to either:
  a) Build a monolithic Rust FFI lib that owns the wgpu device AND does text rendering
  b) Extract just the atlas/layout logic and reimplement the GPU parts in TypeScript
  c) Use cosmic-text directly (without glyphon) and manage atlases in TypeScript

**Option (c) is most viable** -- cosmic-text provides everything needed (shaping, layout, rasterization) and the atlas management + GPU quad rendering can be done in TypeScript to match the existing P5GPU architecture.

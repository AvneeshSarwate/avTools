# Design Decisions

## Confirmed Decisions

1. **Render order: Interleaved**
   - Text draws at the point it's called, just like geometry
   - Requires extending batch system to handle both flat-color and textured pipelines
   - Implementation: text quads go into the same batch stream as geometry, with a different pipeline key

2. **Default font: Bundled**
   - Include Noto Sans (~300KB TTF) so `text()` works out of the box
   - No `loadFont()` required for basic usage
   - Matches p5.js "just works" experience

3. **Emoji: Deferred**
   - MVP with monochrome mask atlas only (R8 format)
   - Color emoji can be added later with separate RGBA atlas
   - Simplifies shader (single texture type) and reduces bundle size

4. **Text stroke: Rasterize outlines in Rust**
   - When stroke is enabled on text, cosmic-text's outline path commands used to
     rasterize stroked glyph variants as separate atlas entries
   - Doubles cache entries for stroked glyphs but provides accurate results
   - Cache key includes stroke weight to differentiate variants

## Architecture: cosmic-text FFI + TypeScript atlas

### Approach
- New Rust FFI module at `native/text_engine/`
- cosmic-text handles: font loading, text shaping, layout, wrapping, alignment, glyph rasterization
- TypeScript handles: GPU atlas management, vertex buffer creation, rendering
- P5GPU extended with textured quad pipeline (interleaved with geometry batches)

### FFI Module Exports (Rust → C ABI)

```
// Lifecycle
text_engine_create() -> *mut TextEngine
text_engine_destroy(engine: *mut TextEngine)

// Font loading
text_engine_load_font_file(engine, path_ptr, path_len) -> font_id
text_engine_load_font_bytes(engine, data_ptr, data_len) -> font_id

// Buffer management
text_engine_create_buffer(engine, font_size, line_height) -> buffer_id
text_engine_destroy_buffer(engine, buffer_id)
text_engine_set_buffer_size(engine, buffer_id, width, height)
text_engine_set_buffer_text(engine, buffer_id, text_ptr, text_len, font_family_ptr, font_family_len, weight, style)
text_engine_set_buffer_wrap(engine, buffer_id, wrap_mode)
text_engine_set_buffer_align(engine, buffer_id, align)

// Layout query
text_engine_layout_runs(engine, buffer_id, out_ptr, out_cap) -> count
  // Writes array of LayoutGlyphResult { x, y, w, h, cache_key_hash, font_size_bits, glyph_id, font_id }

// Glyph rasterization
text_engine_rasterize_glyph(engine, cache_key_hash, out_width, out_height, out_left, out_top, out_data_ptr) -> data_len
  // Returns glyph bitmap (R8 mask)

text_engine_rasterize_glyph_stroke(engine, cache_key_hash, stroke_width, out_...) -> data_len
  // Returns stroked glyph bitmap

// Metrics
text_engine_font_metrics(engine, font_family_ptr, len, font_size) -> { ascent, descent, line_height }
text_engine_text_width(engine, buffer_id) -> f32
text_engine_text_bounds(engine, buffer_id) -> { x, y, w, h }
```

### P5GPU Extensions

**New DrawState fields:**
```typescript
textFont: string;           // font family name, default "Noto Sans"
textSize: number;           // default 12
textAlignH: number;         // LEFT/CENTER/RIGHT, default LEFT
textAlignV: number;         // TOP/CENTER/BOTTOM/BASELINE, default BASELINE
textLeading: number;        // line spacing, default textSize * 1.275
textStyle: number;          // NORMAL/BOLD/ITALIC/BOLDITALIC
textWrap: number;           // WORD/CHAR, default WORD
```

**New batch type:**
```typescript
type DrawBatch = {
  startVertex: number;
  vertexCount: number;
  blendMode: number;
  isText: boolean;          // NEW: switches pipeline
};
```

**Shader extension:**
```wgsl
// Bind group 1: text atlas
@group(1) @binding(0) var glyphAtlas: texture_2d<f32>;
@group(1) @binding(1) var glyphSampler: sampler;

// Text vertex: position + UV + color
struct TextVertexIn {
  @location(0) position: vec2f,
  @location(1) texCoord: vec2f,
  @location(2) color: vec4f,
}

@fragment fn fsText(v: TextVertexOut) -> @location(0) vec4f {
  let alpha = textureSample(glyphAtlas, glyphSampler, v.texCoord).r;
  return vec4f(v.color.rgb, v.color.a * alpha);
}
```

**Interleaving approach:**
- Both geometry and text batches go into `_batches[]` in submission order
- Each batch has `isText` flag
- During `endFrame()`, iterate batches sequentially:
  - Geometry batch → use flat-color pipeline
  - Text batch → use textured pipeline, bind atlas
- All share same render pass (same MSAA resolve target)

### Atlas Manager (TypeScript)

```typescript
class GlyphAtlas {
  texture: GPUTexture;          // R8Unorm, starts at 512x512
  packer: RectanglePacker;      // simple shelf/skyline packer
  cache: Map<bigint, GlyphEntry>; // cache_key_hash → { u, v, w, h }
  lru: bigint[];                // for eviction

  ensureGlyph(cacheKeyHash: bigint, engine: TextEngine): GlyphEntry
  grow(): void                  // double texture size, re-upload all
  trim(): void                  // evict LRU entries
}
```

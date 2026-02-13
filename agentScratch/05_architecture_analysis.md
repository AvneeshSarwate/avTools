# Architecture Analysis: Text Rendering for P5GPU

---

## The Problem

P5GPU needs text rendering with p5.js 2.0 API parity. The current system has no texture
support -- it only renders solid-color triangles. Text requires either:
- Rasterized glyph bitmaps (atlas-based)
- Vector glyph evaluation (SDF or curve-based)

---

## Approach Options

### Option A: cosmic-text via Rust FFI + TypeScript atlas management

**How it works:**
1. New Rust FFI module wraps cosmic-text
2. FFI calls: create font system, set text, shape, get layout runs, rasterize glyphs
3. TypeScript manages the GPU glyph atlas (packing, uploading, UV tracking)
4. P5GPU extended with textured quad pipeline for glyph rendering

**Pros:**
- cosmic-text provides best-in-class shaping (HarfRust/HarfBuzz in Rust)
- Full Unicode support, BiDi, complex scripts, emoji
- System font discovery via fontdb
- Variable font support
- All layout logic (wrapping, alignment) handled in Rust -- fast
- Glyph rasterization in Rust via swash -- high quality with hinting

**Cons:**
- New FFI module to build + maintain
- Need to design FFI boundary carefully (what crosses the boundary?)
- cosmic-text v0.17 vs glyphon's v0.15 dependency -- version mismatch if mixing
- Build complexity: additional Rust compilation step

### Option B: glyphon via Rust FFI (monolithic approach)

**How it works:**
1. Rust FFI module owns wgpu device AND does text rendering
2. TypeScript passes text parameters, Rust renders directly to GPU texture
3. Result composited with P5GPU's output

**Pros:**
- glyphon handles everything: atlas, caching, rendering
- Single draw call for all text
- Proven production system

**Cons:**
- Cannot share wgpu device across FFI boundary (Deno creates its own)
- Would need a completely separate GPU context for text
- Compositing two GPU outputs is complex
- Very coupled architecture
- **Not viable** without significant wgpu interop work

### Option C: cosmic-text WASM (no FFI)

**How it works:**
1. Compile cosmic-text to WASM
2. Call from TypeScript directly
3. TypeScript manages atlas + GPU rendering

**Pros:**
- No native compilation step
- Portable across platforms
- Direct integration, no FFI boundary design

**Cons:**
- WASM compilation of cosmic-text may be complex (fontdb, system font discovery won't work)
- Performance overhead for WASM vs native
- Would need to bundle fonts (no system font discovery)
- cosmic-text's `no_std` support is limited

### Option D: Pure TypeScript with Canvas 2D fallback

**How it works:**
1. Create an offscreen Canvas 2D context (via `@gfx/canvas` or `@gfx/canvas-wasm`)
2. Use Canvas 2D `measureText()` and `fillText()` to rasterize text to bitmap
3. Upload bitmap to GPU texture
4. Render as textured quad in P5GPU

**Pros:**
- Simplest to implement
- Canvas 2D handles all shaping, layout, rendering
- Already have `@gfx/canvas` infrastructure from pixi text work

**Cons:**
- Whole-text rasterization (not per-glyph caching)
- Re-rasterizes on every text change (expensive for dynamic text)
- Quality limited by bitmap resolution
- Can't efficiently cache individual glyphs
- `@gfx/canvas` requires Skia FFI (already a native dep)
- `@gfx/canvas-wasm` has limited text metrics

---

## Recommended Approach: Option A (cosmic-text FFI + TypeScript atlas)

### Why?

1. **Best quality**: HarfRust shaping + swash rasterization with hinting
2. **Best performance**: Per-glyph caching in GPU atlas, single draw call for text
3. **Matches existing patterns**: Similar to other FFI modules (opaque pointer lifecycle)
4. **p5 API parity**: cosmic-text provides all needed primitives (wrapping, alignment, metrics)
5. **Future-proof**: Can add rich text, emoji, BiDi later

### FFI Boundary Design

The key question is: what data crosses the FFI boundary?

**Opaque state (lives in Rust, managed by pointer):**
- `FontSystem` -- font database + cache
- `Buffer` -- text container with layout state
- `SwashCache` -- rasterized glyph cache

**Data crossing FFI (Rust → TypeScript):**
- Layout results: array of `{ x, y, width, height, cache_key_hash, content_type }` per glyph
- Glyph images: `{ width, height, left, top, pixel_data, content_type }` per unique glyph
- Font metrics: `{ ascent, descent, line_height }` per font/size combo
- Text measurement: width, bounds

**Commands crossing FFI (TypeScript → Rust):**
- Set text + attributes
- Set buffer size (for wrapping)
- Set wrap mode, alignment
- Load font from file/bytes
- Request glyph image by cache key
- Query text metrics

### P5GPU Changes Needed

1. **New shader entry points** for textured quads:
   ```wgsl
   @group(1) @binding(0) var glyphAtlas: texture_2d<f32>;
   @group(1) @binding(1) var glyphSampler: sampler;

   // Vertex: position + UV + color
   // Fragment: sample atlas, multiply by color (mask) or passthrough (color)
   ```

2. **New vertex format** for text (8 floats, 32 bytes):
   ```
   position: vec2f
   texCoord: vec2f
   color:    vec4f
   ```

3. **Atlas texture management** in TypeScript:
   - Simple rectangle packer (or bin from npm)
   - Dynamic growth (256 → 4096)
   - LRU eviction
   - Separate mask (R8) and color (RGBA8) atlases

4. **Text state** added to DrawState:
   ```typescript
   textFont: string | FontHandle;
   textSize: number;       // default 12
   textAlignH: number;     // LEFT/CENTER/RIGHT
   textAlignV: number;     // TOP/CENTER/BOTTOM/BASELINE
   textLeading: number;    // line spacing
   textStyle: number;      // NORMAL/BOLD/ITALIC/BOLDITALIC
   textWrap: number;       // WORD/CHAR
   ```

5. **New methods** on P5GPU class:
   - Core: `text()`, `textFont()`, `textSize()`, `textAlign()`, `textLeading()`
   - Measurement: `textWidth()`, `textAscent()`, `textDescent()`
   - Style: `textStyle()`, `textWrap()`
   - Loading: `loadFont()` (async)

---

## Implementation Phases

### Phase 1: FFI Module (Rust)
- Create `native/text_engine/` with cosmic-text dependency
- Implement: font system init, font loading, buffer creation, text setting
- Implement: layout query (returns glyph positions), glyph rasterization
- Implement: text measurement (width, ascent, descent, bounds)
- TypeScript bindings in `text/ffi.ts`

### Phase 2: GPU Atlas (TypeScript)
- Glyph atlas manager (rectangle packing, GPU texture, LRU cache)
- Upload glyph images from FFI to GPU texture
- Track UV coordinates per cached glyph

### Phase 3: P5GPU Text Pipeline
- Extend shader with textured quad support
- Add text vertex buffer and batching
- Implement `text()` method:
  1. Set text on cosmic-text buffer via FFI
  2. Get layout run positions
  3. For each glyph: ensure cached in atlas, emit textured quad
- Implement text state methods
- Implement measurement methods

### Phase 4: Polish
- Font loading (`loadFont()`)
- Text wrapping (WORD/CHAR)
- Vertical alignment
- Stroke text (outline)
- `textBounds()`
- Handle `rectMode` for text positioning

---

## Performance Considerations

- **Glyph caching**: Once rasterized, glyphs stay in GPU atlas. Only new glyphs cross FFI.
- **Layout caching**: cosmic-text caches shaped text. Only reshapes on text/size changes.
- **Batch rendering**: All text quads in single draw call (separate from geometry).
- **Atlas size**: Start at 512x512, grow to 4096x4096 as needed.
- **Subpixel rendering**: cosmic-text uses 4-bin subpixel positioning for quality.

---

## Open Questions for User

1. **Font discovery**: Should we support system fonts (requires fontdb platform integration) or only loaded fonts?
2. **Default font**: p5 defaults to 'sans-serif'. Do we bundle a default font or require explicit loading?
3. **Emoji**: Support color emoji (requires RGBA atlas, more complex)? Or defer?
4. **Text stroke**: p5 supports stroke() on text. Implement via cosmic-text outline rendering or thick outline expansion?
5. **Render order**: Should text respect draw order with geometry (interleaved) or always render on top?

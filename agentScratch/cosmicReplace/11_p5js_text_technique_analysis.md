# p5.js Text Rendering Technique Analysis

## Executive Summary

p5.js uses **two completely different text rendering pipelines** depending on the renderer mode:

- **2D Canvas mode**: Simple `ctx.fillText()` / `ctx.strokeText()` -- delegates entirely to the browser's native text rasterization.
- **WebGL mode**: Analytical quadratic bezier rendering in a fragment shader. Font outlines are parsed from raw font files using a bundled library called **Typr.js** (NOT opentype.js), converted to quadratic bezier curves, packed into textures, and then evaluated per-pixel in the fragment shader using a grid-accelerated inside/outside test.

The WebGL technique is resolution-independent, requires no bitmap atlas, and naturally supports variable fonts. However, it has significant complexity and performance characteristics that make direct adoption into our WebGPU pipeline a non-trivial undertaking.

---

## 1. How p5.js Renders Text in WebGL Mode

### 1.1 The Full Pipeline

**Step 1: Font Parsing (Typr.js)**

p5.js bundles a library called `Typr.js` (`src/type/lib/Typr.js`, ~2970 lines), which is a pure-JavaScript font parser that reads raw `.ttf`, `.otf`, and `.woff` files. It is NOT opentype.js -- it is a distinct, more compact library.

Typr.js parses the binary font tables directly:
- `glyf` table for TrueType outlines (quadratic bezier curves)
- `CFF ` table for PostScript/CFF outlines (cubic bezier curves)
- `fvar` table for variable font axis definitions
- `gvar` table for variable font glyph variation data
- `avar` table for axis value normalization
- `COLR`/`CPAL` for color fonts
- `SVG ` for SVG color fonts
- Standard tables: `head`, `hhea`, `hmtx`, `cmap`, `kern`, `GPOS`, `GSUB`

The key function is `Typr.U.glyphToPath(font, glyphId, noColor, axs)` which returns `{cmds: string[], crds: number[]}` -- a list of path commands (M, L, Q, C, Z) and their coordinate arrays.

For variable fonts, `Typr.U.shape(font, text, {axs})` takes an array of axis values and applies gvar/avar interpolation to produce glyph outlines at the specified axis positions. The interpolation modifies control point coordinates directly using the tuple variation algorithm from the OpenType spec.

**Key files:**
- `/clonedCompanionRepos/p5.js/src/type/lib/Typr.js` -- font parser
- `/clonedCompanionRepos/p5.js/src/type/p5.Font.js` -- Font class, axis handling
- `/clonedCompanionRepos/p5.js/src/webgl/text.js` -- WebGL text rendering

**Step 2: Glyph to Bezier Curve Processing**

When a glyph is needed for WebGL rendering, p5.js calls `font._singleShapeToPath(glyph.shape, {axs})` which in turn calls `Typr.U.glyphToPath()` to get raw path commands.

The path commands are then processed in `FontInfo.getGlyphInfo()`:

1. **All coordinates are normalized** to the range [0, 1] relative to the glyph bounding box.

2. **Lines** are converted to degenerate quadratics (control point = midpoint).

3. **Quadratic beziers** are stored directly.

4. **Cubic beziers** are converted to quadratics via an adaptive subdivision algorithm:
   - Split cubics at their inflection points first
   - For each non-inflecting piece, iteratively split into start/middle/end segments
   - Use the quadratic error metric `|P1-P0 - 3*(C1-C0)| / 2` to determine precision
   - Continue splitting until error < threshold (precision ~30/sqrt(3))
   - Each resulting cubic piece produces one quadratic approximation via `toQuadratic()`

5. **Grid acceleration**: Each glyph is divided into a 9x9 grid. For each quadratic curve, the code determines which grid cells it overlaps and adds the curve's index to those cells' row and column lists. This is the spatial acceleration structure that makes the fragment shader efficient.

**Step 3: Packing Curve Data into Textures**

The bezier data is packed into multiple textures (ImageData objects uploaded as WebGL textures):

- **Stroke texture** (`uSamplerStrokes`): 64x64 RGBA. Each pixel stores one curve segment: `(startX, startY, controlX, controlY)` as bytes (0-255 mapping to 0.0-1.0). The endpoint of each curve is the start point of the next curve in the stroke list.

- **Row/Column grid textures** (`uSamplerRows`, `uSamplerCols`): 64x64 RGBA. Each pixel stores the offset and count of curve indices for one grid row or column: `(offset_hi, offset_lo, count_hi, count_lo)` -- 14-bit integer encoding.

- **Row/Column cell textures** (`uSamplerRowStrokes`, `uSamplerColStrokes`): 64x64 RGBA. These store the actual curve indices that intersect each grid cell.

This multi-texture lookup scheme is essentially an indirection table: the shader first determines which grid cell the fragment is in, then looks up which curves affect that cell, then evaluates only those curves.

**Step 4: Vertex Setup**

For each glyph, p5.js draws a single quad (two triangles). The vertex shader:
- Scales the quad by the glyph's bounding box (`uGlyphRect`)
- Offsets it to the glyph's position in the text line (`uGlyphOffset`)
- Applies the standard model-view-projection matrix
- Expands the bounding box by 1 pixel for antialiasing
- Passes texture coordinates (0-1) to the fragment shader

**Step 5: Fragment Shader -- The Core Algorithm**

The fragment shader (`font.frag`) performs an **analytical inside/outside test** for each pixel:

1. Determine which grid cell this pixel falls in.
2. Look up the list of quadratic curves that intersect this cell's row and column.
3. For each curve, compute where the curve crosses horizontal and vertical lines through the pixel using the quadratic formula:
   - Given curve `P(t) = (1-t)^2 * P0 + 2t(1-t) * P1 + t^2 * P2`
   - Solve for t where `P(t).y = pixel.y` (horizontal crossings)
   - Solve for t where `P(t).x = pixel.x` (vertical crossings)
4. Accumulate winding-number-based coverage:
   - Track crossings in X direction (for row curves) and Y direction (for column curves)
   - Use `saturate(crossing + 0.5)` for sub-pixel coverage computation
5. Combine X and Y coverage into a final alpha value with antialiasing:
   - `weight = saturate(1.0 - weight * 2.0)` where weight is the minimum crossing distance
   - `antialias = |dot(coverage, weight) / distance|`
   - `cover = min(|coverage.x|, |coverage.y|)`
   - Final alpha = `saturate(max(antialias, cover))`

This is conceptually similar to loop-blinn quadratic curve rendering but uses a different coverage accumulation strategy. It computes exact inside/outside at any zoom level with smooth antialiasing.

### 1.2 Variable Font Handling

Variable fonts are handled entirely in the CPU-side font parsing:

1. `Font._currentAxes(renderer)` reads the current axis values from renderer state. It maps `wght` to `renderer.states.fontWeight`, `wdth` to a fixed 100 (TODO in their code), and other axes from `fontVariationSettings`.

2. `font._getFontInfo(axs)` caches a `FontInfo` per unique axis configuration. The cache key is `JSON.stringify(axs)`.

3. Inside `FontInfo.getGlyphInfo()`, Typr.js is called with the axes array, which applies `gvar` deltas to the control points before extracting the path.

4. Each unique (glyphId, axisConfig) combination generates a separate set of texture data.

**Impact on cache**: Continuous axis animation (e.g., animating weight from 100 to 900) generates one FontInfo cache per distinct axis value. If the user animates weight smoothly with floating-point values, this creates many cache entries. p5.js mitigates this with an LRU cache (`maxCachedGlyphs = 200`) that evicts old glyph textures from GPU memory.

### 1.3 Performance Characteristics

**Pros:**
- Resolution-independent -- text looks sharp at any size or zoom
- No bitmap atlas needed -- no texture memory scaling with font count/size
- Per-glyph work is O(curves in cell) per pixel, not O(total curves)
- Variable fonts work natively (just reparse the glyph)

**Cons:**
- Fragment shader is computationally expensive (texture lookups + quadratic solvers per pixel per curve)
- One draw call per glyph (not batched)
- Each glyph requires 5 texture uniform bindings + 1 draw call
- Variable font axis changes require re-processing glyph outlines on CPU
- Grid structure limits to 64x64 textures = limited curve complexity per glyph
- Cubic-to-quadratic conversion adds more curves for CFF fonts
- No text stroke support in WebGL mode

---

## 2. How p5.js Renders Text in 2D Canvas Mode

The 2D renderer is straightforward:

```javascript
// p5.Renderer2D._renderText():
if (states.strokeColor && states.strokeSet) {
  context.strokeText(text, x, y);
}
if (!this._clipping && states.fillColor) {
  context.fillText(text, x, y);
}
```

It is literally just `ctx.fillText()` and `ctx.strokeText()`. All font selection, sizing, weight, etc. are handled by setting the canvas 2D context's `font` property string (constructed from the renderer state in `_applyFontString()`).

Text measurement uses `ctx.measureText()` to get `actualBoundingBoxLeft/Right/Ascent/Descent` and `fontBoundingBoxAscent/Descent`.

Variable font weight is set via:
1. The `font` CSS shorthand string on the drawing context
2. `canvas.style.fontVariationSettings = '"wght" ${weight}'` for the canvas element

---

## 3. What Does p5.js Use for Font Parsing?

### Typr.js (NOT opentype.js)

p5.js v2 uses **Typr.js** (`src/type/lib/Typr.js`), a compact (~2970 lines) pure-JavaScript OpenType/TrueType font parser. Key capabilities:

- Parses `glyf` (TrueType quadratic outlines), `CFF ` (PostScript cubic outlines)
- Full variable font support: `fvar` (axes), `gvar` (glyph variations), `avar` (axis normalization)
- Glyph shaping via `Typr.U.shape()` -- applies `GSUB`/`GPOS` for ligatures, kerning, etc.
- Optional HarfBuzz integration via `Typr.U.shapeHB()` for complex scripts
- Color font support: `COLR`/`CPAL`, `SVG `, `CBLC`/`CBDT`
- Output format: `{cmds: string[], crds: number[]}` -- flat arrays of commands and coordinates

### Variable Font Support

Typr.js has full variable font support:
- Reads `fvar` table for axis definitions (min, default, max, name)
- Reads `gvar` table for per-glyph variation tuples
- Applies `avar` for axis normalization
- `_normalizeAxis()` maps user-facing axis values to normalized -1..+1 coordinates
- `_interpolate()` computes the scalar influence for each tuple given axis coordinates
- `_simpleGlyph()` applies `gvar` deltas to control point coordinates: `xs[i] += S * dfs[i]`
- `_compoGlyph()` applies `gvar` deltas to component offsets in composite glyphs

This means continuous axis animation IS supported -- you can pass any floating-point value for any axis and get the correct interpolated outline. However, each unique axis configuration produces a separate glyph outline that must be converted to texture data.

---

## 4. Feasibility: Adopting p5.js's Technique for Our WebGPU Pipeline

### 4.1 What Would Need to Change

Our current pipeline:
```
text() --> FFI: cosmic-text layout (Rust) --> glyph keys
--> FFI: swash rasterize glyph (Rust) --> alpha bitmaps
--> GlyphAtlas (GPU texture, r8unorm)
--> text shader (sample atlas, multiply by fill color)
```

p5.js WebGL pipeline:
```
text() --> Typr.js: shape + glyphToPath (JS) --> bezier curves
--> FontInfo.getGlyphInfo() (JS) --> grid-accelerated curve data
--> 5 textures per glyph (RGBA ImageData)
--> font shader (analytical bezier evaluation per pixel)
```

To adopt p5.js's approach, we would need:

1. **Replace our Rust FFI text engine** with a JavaScript/TypeScript font parser (Typr.js or a Deno-compatible equivalent) for outline extraction. We could still use cosmic-text for layout (line breaking, shaping, kerning) but would need to extract the raw bezier outlines ourselves.

2. **Replace the glyph atlas** with a multi-texture curve data system. Instead of one big R8 atlas texture, we need per-glyph sets of small RGBA textures (or pack multiple glyphs into shared textures as p5.js does).

3. **Write a new WGSL fragment shader** that implements the quadratic bezier coverage algorithm. This is the most significant piece of work -- the p5.js GLSL shader is ~216 lines of non-trivial math.

4. **Replace the text vertex/draw call pipeline**: Instead of batching many glyph quads into one draw call with atlas UVs, we would draw one quad per glyph with per-glyph uniform updates.

### 4.2 Would It Solve the Cache Key Explosion Problem?

**Partially.**

The cache key explosion in our current system comes from the fact that each unique (glyphId, fontSize, weight, style) combination requires a separate rasterized bitmap. When you animate weight continuously, you get one bitmap per weight value per visible glyph.

p5.js's approach also has a caching problem, but it manifests differently:
- Each unique axis configuration creates a new `FontInfo` cache entry
- Each `FontInfo` caches per-glyph texture data
- p5.js caps this at `maxCachedGlyphs = 200` and uses LRU eviction

The fundamental problem remains: **changing variable font axes requires recomputing glyph outlines on the CPU**. Whether you turn those outlines into bitmaps (our approach) or pack them into bezier textures (p5.js's approach), you still need to redo the work when axes change.

However, p5.js's approach has some advantages for this case:
- The CPU work to pack bezier data into textures is lighter than full rasterization
- The texture data per glyph is smaller (a few hundred bytes vs. a full alpha bitmap)
- Resolution independence means no cache entries per font size

### 4.3 Tradeoffs

| Dimension | Our Current Pipeline (Bitmap Atlas) | p5.js Analytical Beziers |
|-----------|-------------------------------------|--------------------------|
| **Quality** | Excellent (subpixel antialiasing from swash) | Excellent (resolution-independent, clean at all sizes) |
| **Font size scaling** | Requires re-rasterization per size | Free (resolution-independent) |
| **Variable axis animation** | Requires re-rasterization per axis value | Requires re-extraction of bezier curves per axis value |
| **Draw call batching** | All text in one instanced draw | One draw call per glyph |
| **GPU cost per pixel** | Single texture sample | Multiple texture lookups + quadratic solving |
| **CPU cost per glyph** | Heavy (full rasterization via Rust FFI) | Medium (bezier extraction + grid binning in JS) |
| **Memory** | O(glyphs * fontSize^2) bitmap data | O(glyphs * curves) curve data |
| **Font loading** | Handled by Rust cosmic-text | Needs JS-side font parser (Typr.js) |
| **Shaping/layout** | Full cosmic-text (HarfBuzz-grade) | Typr.js basic shaping (good but not HarfBuzz-grade) |
| **Stroke text** | Supported via multiple offset renders | Not supported in p5.js WebGL mode |
| **CFF/PostScript fonts** | Handled natively by swash | Requires cubic-to-quadratic conversion (quality loss) |
| **Emoji/color fonts** | Handled by Rust rasterizer | Would need separate handling |
| **Code complexity** | Medium (Rust FFI + atlas management) | High (font parser + curve processing + complex shader) |
| **Deno compatibility** | Works (Rust FFI) | Typr.js uses `window`, `document`, `DOMParser` -- needs shimming |

### 4.4 Draw Call Overhead

This is the biggest concern. p5.js draws each glyph with a separate draw call, binding 5 textures per glyph. For a string like "Hello World" (11 characters), that is 11 draw calls with 55 texture bindings.

Our current system batches all text into a single instanced draw call. For performance-sensitive creative coding (drawing hundreds or thousands of text strings per frame), the draw call overhead of the p5.js approach could be prohibitive.

WebGPU could potentially mitigate this with:
- Packing all glyph curve data into shared textures (as p5.js already does with ImageInfos)
- Using instanced rendering with per-instance glyph uniforms via storage buffers
- Reducing the 5-texture scheme to fewer texture lookups

But this would require significant re-engineering beyond just porting the p5.js code.

### 4.5 Effort Estimate

| Task | Effort |
|------|--------|
| Port Typr.js to Deno (remove DOM dependencies, shim ImageData) | 2-3 days |
| Implement FontInfo / glyph processing in TypeScript | 2-3 days |
| Write WGSL fragment shader (port from GLSL) | 2-3 days |
| Texture packing and GPU upload system | 1-2 days |
| Integrate with existing text layout (keep cosmic-text for shaping?) | 2-3 days |
| Handle variable fonts, axis animation, caching | 1-2 days |
| Testing, debugging, performance tuning | 3-5 days |
| **Total** | **~13-21 days** |

### 4.6 Alternative: Hybrid Approach

Rather than a full switch, consider a hybrid:

1. **Keep cosmic-text for layout/shaping** -- it is superior to Typr.js's built-in shaping
2. **Keep the bitmap atlas for most text** -- it works well and is batched
3. **Add analytical bezier rendering as an option** for variable font animation -- only switch to the analytical path when axes are being animated, avoiding the cache explosion
4. **Use Typr.js (or a Rust equivalent) only for extracting bezier outlines** when the analytical path is active

This would give us the best of both worlds: fast batched rendering for static text, and resolution-independent rendering for animated variable fonts.

---

## 5. Recommendation

**Do NOT do a wholesale replacement** of our current pipeline with p5.js's approach. The per-glyph draw call overhead is a serious regression for creative coding workloads, and the complexity is high.

**Instead, consider these targeted improvements:**

1. **Font size independence**: Add a quantization tier for font sizes in the atlas cache key. If the user renders text at size 12.3 and 12.5, round to the nearest integer for the atlas key. This is simpler than bezier rendering and solves most practical size-scaling cache issues.

2. **Variable font axis animation**: This is where p5.js's approach genuinely shines. For the specific case of animating variable font axes, consider:
   - Implementing axis quantization (which we already have via `axisQuantization`) more aggressively
   - Or: extracting bezier outlines from cosmic-text/swash and using them in a second shader path specifically for animated text

3. **If bezier rendering is desired**, port only the shader math (the WGSL fragment shader) and the curve-to-texture packing, but:
   - Use cosmic-text for all text shaping/layout (keep the Rust FFI)
   - Use storage buffers + instanced draws for batching (not per-glyph draw calls)
   - Pack curve data into a single large texture (not 5 separate ones per glyph)
   - This would be the hybrid approach above

4. **For matching p5.js feature parity**: Our current pipeline already exceeds p5.js's text quality in most dimensions (subpixel rendering, full HarfBuzz shaping, emoji support, stroke text). The only area where p5.js genuinely outperforms us is resolution-independent rendering, which matters for 3D text (rotated, scaled) but not for typical 2D canvas text.

---

## 6. Key Source Files Referenced

### p5.js
- `/clonedCompanionRepos/p5.js/src/webgl/text.js` -- WebGL text rendering (FontInfo, curve processing, _renderText)
- `/clonedCompanionRepos/p5.js/src/webgl/shaders/font.frag` -- Fragment shader (analytical bezier evaluation)
- `/clonedCompanionRepos/p5.js/src/webgl/shaders/font.vert` -- Vertex shader (glyph quad positioning)
- `/clonedCompanionRepos/p5.js/src/type/p5.Font.js` -- Font class (parsing, axes, shaping)
- `/clonedCompanionRepos/p5.js/src/type/lib/Typr.js` -- Font parser (glyph outlines, variable fonts)
- `/clonedCompanionRepos/p5.js/src/type/textCore.js` -- Text API (alignment, sizing, wrapping)
- `/clonedCompanionRepos/p5.js/src/core/p5.Renderer2D.js` -- 2D text (_renderText -> fillText/strokeText)

### Our Pipeline
- `/apps/deno-notebooks/tools/p5gpu.ts` -- P5GPU renderer, text() method, _layoutText()
- `/apps/deno-notebooks/tools/p5gpu_text/ffi.ts` -- Rust FFI text engine (layout, rasterization)
- `/apps/deno-notebooks/tools/p5gpu_text/atlas.ts` -- Glyph atlas (GPU texture packing, LRU eviction)

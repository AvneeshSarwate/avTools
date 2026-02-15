Consolidated Deep-Dive Report: p5.js WebGPU Text Rendering
7 opus subagents processed: ~4000-line chat summary, 8 planning docs, 31K-line compact session structural map, full source code analysis (3081+352+372+1207 lines), performance deep-dive, atlas architecture analysis, and web research on alternatives.

Executive Summary
The current bitmap-atlas approach is architecturally sound for the creative-coding-with-variable-fonts use case. The issues are operational, not architectural -- the iterative compatibility work created several layers of technical debt that hurt performance without needing to. The highest-impact improvements are: eliminating the double-layout FFI pattern, replacing JSON with binary across the FFI boundary, adding LRU eviction to the atlas, and cleaning up dead code from iterative patches.

I. PERFORMANCE BOTTLENECKS (Priority-Ranked)
P0: Double-Layout FFI Pattern (~40-60% of layout cost)
Files: ffi.ts:244-305, lib.rs:110-406

Every layoutText() call crosses the FFI boundary twice -- once to query the needed buffer size, once to actually fill it. The Rust side runs the full cosmic-text shaping pipeline twice per logical call. In the LFO benchmark with 100 characters, that is ~200 FFI crossings/frame just for layout. Additionally, glyph_records.clear() (lib.rs:361) destroys all glyph record state on every call.

Fix: Pre-allocate a reusable 64KB Uint8Array in NativeTextEngine. Only re-call on overflow (rare -- a single char layout is ~60 bytes). Stop clearing glyph_records and instead merge/append.

P0: JSON Serialization Across FFI (~900 JSON round-trips/frame)
Files: ffi.ts:146-188, lib.rs:403

Layout results are serialized as JSON (serde_json::to_string), transmitted as UTF-8, then parsed (JSON.parse) plus per-glyph hex-string-to-BigInt conversion (BigInt("0x" + glyph.key)). For 100 single-char layouts, this is ~25-50KB of JSON parsed per frame.

Fix: Binary struct protocol. Per glyph: u64 key + i32 x + i32 y = 16 bytes (vs ~40-50 bytes JSON). Header: 10 f32 metrics + 1 u32 count = 44 bytes. Use DataView on the JS side.

P0: Atlas dynamicScratchMode Full Clear
Files: atlas.ts:91-105

When enabled, the atlas is cleared every frame and every glyph is re-rasterized + re-uploaded. With weight quantization (25-unit steps), a character cycles through ~24 distinct weights. Once all 24 are cached, there should be zero rasterization cost -- but the full clear throws the cache away.

Fix: Replace with LRU eviction. The lastUsedFrame field already exists on GlyphAtlasEntry (atlas.ts:28) but is never consulted for eviction. Evict entries unused for 3+ frames when allocation fails.

P1: No Layout Caching (3-4x redundant FFI calls)
Files: p5gpu.ts:1098-1329

For the same text, textWidth("M"), textAscent("M"), textDescent("M"), then text("M", x, y) each independently trigger a full FFI layout call. That is 4 layouts for one logical text operation. The _textLastLayout field (p5gpu.ts:531-549) is only written to, never used as a lookup cache.

Fix: Add a per-frame layout cache keyed on text + font + size + weight + axes + alignment. Same text with same params returns cached result. Clear cache each frame in beginFrame().

P1: number[] Vertex Arrays + Frame-End Copy
Files: p5gpu.ts:514-516, p5gpu.ts:696-705

Vertices accumulated as number[] (boxed floats in V8), then new Float32Array(this._textVertices) copies everything at frame end. For 100 chars x 6 verts x 8 floats = 4,800 individually pushed values.

Fix: Pre-allocated Float32Array with manual cursor. Reset cursor in beginFrame(). Pass subarray directly to writeBuffer().

P2: HarfRust Double-Shaping Bridge
Files: lib.rs:268-283

For variable fonts, every layout call runs a second full shaping pass via HarfRust with full axis settings, then computes an x_scale ratio to correct cosmic-text's positions. This effectively doubles the CPU cost for variable font text. Estimated +0.3-1.5ms per layout call for variable fonts.

Fix (long-term): Fork cosmic-text to accept arbitrary variation axes directly, eliminating the second shaping pass. The underlying libraries already support this -- the limitation is only in cosmic-text's cache layer. Fix (short-term): Cache the x_scale ratio per (font + size + axes) combination rather than recomputing for every layout.

P2: Text Stroke via 8-Offset Redraw
Files: p5gpu.ts:2065-2101

Text stroke draws each glyph 8 times at cardinal + diagonal offsets. This is 8x vertex count for any stroked text.

Fix: CPU-side dilation in Rust: after rasterizing the fill mask, apply a max-filter with configurable radius to produce a stroke mask as a separate atlas entry. Eliminates 8x overdraw and produces smoother strokes.

Combined estimated savings for P0+P1 fixes: 1.5-4.5ms/frame for the 100-character LFO benchmark.

II. ACCURACY ISSUES
Remaining Antialiasing/Rasterization Differences
The final diff images show consistent ~1-2px differences between cosmic-text/swash rasterization and Chrome canvas rendering. This is inherent to using different rasterizers (swash hinting vs. CoreText/FreeType). Not fixable without matching the exact OS text rasterizer.

textWidth() Semantic Mismatch (Mostly Fixed)
Browser p5 uses measureText().actualBoundingBoxRight + actualBoundingBoxLeft (fractional), while the original implementation used integer atlas pixel extents. The analytical curve-extrema fix (lib.rs:700-889) brought RMSE from 59 to 21. The remaining gap is rasterizer-level AA differences.

Generic Font Family Resolution (Not Fixed)
The native text engine treats "monospace", "sans-serif" as literal font names, not CSS generic families. This was sidestepped by using explicit font names. Low priority but worth fixing for API completeness.

Latent Atlas UV Bug
Calling textWidth() between text() calls within the same frame can trigger atlas growth via _measureTextGlyphInkExtents without rescaling already-buffered vertex UVs. This is a latent correctness bug that surfaces in specific call patterns.

III. DEAD CODE & TECHNICAL DEBT
Dead Measurement Pipeline
_measureTextBlockTightWidth() and _measureTextGlyphInkExtents() (p5gpu.ts:2222-2298) are now effectively dead code. All callers switched to layout.tightWidth from the Rust analytical bounds. The _computeInkXRange() pixel-scanning in atlas.ts:305-328 and inkX0/inkX1 fields can be removed.

9 Duplicated _textLastLayout Assignment Blocks
The identical 8-field assignment pattern is repeated in text(), textWidth(), fontWidth(), textAscent() (2x), textDescent() (2x), fontAscent(), fontDescent(). Should be a single helper.

4 Duplicated Axis-Settings Construction in Rust
The pattern of iterating axes, checking for wght/opsz, and building settings vectors appears in 4 places: rasterize_with_axes, measure_advance_with_axes, measure_font_box_metrics, measure_glyph_outline_x_bounds. Should be a single helper.

Debug Env Flags Accumulated
~15 environment variable debug flags accumulated during iterative development: P5_TEXT_ATLAS_GROW_DEBUG, P5_TEXT_METRICS_DEBUG, P5_TEXT_METRICS_DEBUG_VERBOSE, P5_BROWSER_DEBUG_LFO_METRICS, etc. Some may still be useful, but many add dead conditional branches.

textureView() Creates New View Every Call
atlas.ts:117 calls texture.createView() on every access. Should cache.

IV. ARCHITECTURAL RECOMMENDATIONS
Keep the Bitmap Atlas Approach
The research agent confirmed that for variable font axis animation (your primary use case), bitmap atlas is superior to SDF/MSDF. SDF/MSDF must regenerate the distance field for each axis position, which is computationally expensive and negates its main advantage. The current approach where swash rasterizes per-axis-position bitmaps is well-matched to the creative coding workload.

Implement a Staging/Commit Pattern for Atlas
Currently, measurement and rendering both mutate the atlas as side effects. A cleaner architecture:

Phase 1: Layout (pure, no atlas mutation) -- already goes through Rust FFI
Phase 2: Batch-ensure all glyphs needed for this frame's text() calls
Phase 3: Emit vertices (atlas is frozen, UVs are stable)
This eliminates the UV rescaling entirely and the latent bug of atlas growth during measurement.

Consider Two-Tier Atlas for Mixed Use Cases
Persistent tier: Glyphs appearing in 3+ consecutive frames stay cached
Scratch tier: Glyphs for one-off frames, cleared with LRU eviction
Glyphs auto-promote from scratch to persistent
V. RECOMMENDED IMPLEMENTATION ORDER
Phase	Changes	Effort	Impact
Quick wins	Remove dead code (pixel scanning, dead measurement methods), cache textureView(), extract duplicated helpers	2-3h	Code clarity
FFI overhaul	Pre-allocated buffer (eliminate double-layout), binary protocol for glyph positions	4-6h	40-60% layout speedup
Atlas v2	LRU eviction, remove dynamicScratchMode full-clear, staging pattern	4-8h	Eliminate frame stutters
Layout cache	Per-frame cache keyed on text+style params, fix glyph_records.clear()	3-4h	3-4x fewer FFI calls
Vertex system	Float32Array with cursor, eliminate frame-end copy	2-3h	Reduced GC pressure
Stroke v2	CPU dilation in Rust, stroke atlas entries	4-8h	8x fewer vertices for stroked text
Cosmic-text axes	Fork cosmic-text or replace with direct harfbuzz+swash pipeline	2-3 days	Eliminate double-shaping

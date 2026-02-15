# Rust FFI Text Engine Profiling Results

## Test Configuration

- **Benchmark**: P5GPU rendering 900 single characters per frame with per-character variable weight
- **Font**: Inter Variable, size 40
- **Grid**: 80 columns x 12 rows = 960 positions (900 chars used)
- **Weight range**: 300-900 (sinusoidal LFO), quantized to integer values (~24 unique weights per frame)
- **Frames**: 300 total, analysis focused on frames 260-300 (late/steady-state)
- **Platform**: macOS (Darwin 22.5.0)

## Summary

The Rust text engine with caches takes **~2.0ms per frame** in steady state for 901 layout calls (900 single-character layouts + 1 title text layout). Caches are working correctly with near-100% hit rates after warmup.

However, the **total draw time is ~63ms per frame**, meaning the Rust engine is only ~3% of the total. The remaining ~60ms is spent in TypeScript-side overhead (FFI marshalling, glyph atlas rasterization, vertex buffer construction, etc.).

## Cache Hit Rates (Steady State, frames 260-300)

| Cache | Hit Rate | Hits/20f | Misses/20f | Notes |
|-------|----------|----------|------------|-------|
| Shape | 99.8% | 17,987-17,991 | 29-38 | ~24 unique weight variants per frame; misses come from LFO phase drift creating new weight values |
| Metrics | 100.0% | 18,020 | 0 | Fully cached after first frame (same font_id + size + weight combos) |
| Font Resolve | 100.0% | 18,020 | 0 | All resolve lookups cached (same family + weight combos) |
| Outline Bounds | 99.8% | 19,222-19,231 | 29-38 | Mirrors shape cache misses (new weight = new outline bounds) |

The shape cache misses (~30 per 20 frames, i.e. ~1.5 per frame) are expected: the sinusoidal LFO continuously sweeps through weight values, and as time advances, new weight values appear that were not previously cached. The shape cache has 16,384 entry capacity and is not evicting.

## Rust-Side Time Breakdown (Steady State, frames 260-300)

Per-frame averages from the last 60 frames:

| Phase | Time/Frame | % of Rust Total | Description |
|-------|-----------|-----------------|-------------|
| **Total Layout** | 2.07ms | 100% | Full layout_to_binary call |
| Emit loop | 0.90ms | 44% | Main glyph loop (shape + outline + key hashing + record building) |
| Shape | 0.41ms | 20% | shape_text() calls (includes cache lookup + rare miss computation) |
| Resolve | 0.21ms | 10% | resolve_font_id() (HashMap lookup, always cache hit) |
| Outline | 0.21ms | 10% | outline bounds cache lookup in emit_line_glyphs_from_refs |
| Metrics | 0.10ms | 5% | measure_font_box_metrics() (always cache hit) |
| Serialize | 0.06ms | 3% | Binary protocol encoding (44-byte header + 16 bytes/glyph) |
| Unattributed | ~0.18ms | ~9% | Overhead: axes parsing, axis hashing, context swapping, HashMap operations |

### Notes on "emit" vs. individual timers

The "emit" timer covers the entire for-loop over hard_lines (which calls shape_text and emit_line_glyphs_from_refs). The individual shape/outline timers are subsets of the emit time. The emit percentage (44%) is the total loop time including all sub-phases plus the loop overhead itself (CacheKey construction, hashing, Vec push, etc.).

## Warmup Behavior

| Frame Range | Rust Layout/f | Shape Hit Rate | Notes |
|-------------|--------------|----------------|-------|
| 0-20 | 12.2ms | 55.5% | Cold start, all caches empty |
| 20-40 | 5.7ms | 85.6% | Rapid warmup |
| 40-60 | 3.0ms | 96.3% | Most shapes cached |
| 60-80 | 3.1ms | 97.1% | Approaching steady state |
| 80-100 | 2.9ms | 97.4% | Near steady state |
| 200-220 | 2.0ms | 99.8% | Steady state reached |
| 260-300 | 2.0ms | 99.8% | Stable steady state |

The engine stabilizes around frame 200. The 5-second warmup requirement (250+ frames at 16fps) is reasonable; at 300 frames the numbers are fully stable.

## Total Draw Time Breakdown (TS Side)

| Component | Time/Frame | Notes |
|-----------|-----------|-------|
| **Total drawFrame** | ~63ms | Everything including GPU submit |
| TS text loop (900 p.text calls) | ~60ms | 901 FFI round-trips + atlas + vertex construction |
| Rust layout engine (inside text loop) | ~2ms | ~3% of text loop time |
| endFrame (GPU submit) | ~1.8ms | WebGPU command encoding + submission |
| beginFrame | ~0.07ms | Vertex buffer reset |
| **TS overhead (text loop - Rust)** | ~58ms | FFI marshalling + atlas rasterization + vertex construction |

### Where the 58ms TS overhead goes (estimated)

Each of the 901 `p.text()` calls performs:
1. String encoding for FFI (text, family, axes JSON) -- ~900 allocations per frame
2. FFI call to `text_engine_layout_json` -- 901 round-trips
3. Binary layout result parsing (DataView reads)
4. For each glyph: `atlas.ensureGlyph()` which may call `text_engine_rasterize_glyph` FFI
5. Vertex buffer construction (6 vertices x 8 floats per glyph quad)
6. TS-side text state management (textWeight, textFont, textStyle calls)

The dominant cost is likely the 901 FFI round-trips per frame (each requiring string encoding + Uint8Array allocation + pointer marshalling + result parsing), plus atlas glyph lookup/rasterization.

## Recommendations

1. **Batch layout calls**: Instead of 901 individual `text_engine_layout_json` FFI calls per frame, batch all characters into a single call (or small number of calls) with position data. This would dramatically reduce FFI overhead.

2. **Reduce FFI string encoding**: The family name ("Inter Variable") and axes JSON are re-encoded 901 times per frame. These could be cached on the TS side as pre-encoded Uint8Arrays.

3. **Atlas rasterization**: After initial warmup, atlas rasterization should be cached. Verify that the glyph atlas is not re-rasterizing glyphs every frame.

4. **Consider a batch text API**: A single FFI call that accepts multiple text+position+weight tuples and returns all layout results at once would eliminate 900 FFI round-trips.

5. **The Rust engine itself is fast**: At ~2ms/frame for 901 layouts with all caches warm, the Rust side is not the bottleneck. Optimization effort should focus on the TS<->Rust boundary and the TS-side processing.

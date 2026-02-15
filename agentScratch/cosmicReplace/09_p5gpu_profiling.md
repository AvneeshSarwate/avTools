# P5GPU Text Rendering Per-Frame Profiling Report

## Test Configuration

- **Benchmark**: `p5gpu_text_lfo_perf.ts`
- **Characters**: 900 single characters laid out in a grid
- **Font**: Inter Variable, size 40px
- **Animation**: Per-character weight modulation via sinusoidal LFO (weights 300-900)
- **Resolution**: 1280x720
- **Frames**: 400 total, profiling data captured from frame 260+
- **Steady-state frame time**: ~19-20ms

## Summary: Where Does Each Frame Go?

Using the final profiling windows (frames 380-400) as the most representative steady-state data:

| Component | Time (ms) | % of Frame |
|-----------|-----------|------------|
| **Atlas operations (ensureGlyph)** | **11.4** | **58%** |
| Layout (layoutText) | 2.2 | 11% |
| endFrame (GPU submit) | 1.5 | 8% |
| Text call overhead | 0.4 | 2% |
| Vertex construction | 0.3 | 1% |
| beginFrame | 0.1 | <1% |
| Blit + present + JS overhead | ~3.6 | 18% |
| **Total frame** | **~19.5** | **100%** |

## Detailed Breakdown

### 1. Atlas Operations -- 58% of frame (11.4ms)

This is by far the dominant cost. The atlas `ensureGlyph()` is called 971 times per frame (900 grid characters + title text). In steady state:

| Sub-component | Time (ms) | Notes |
|---------------|-----------|-------|
| **Rasterize (FFI)** | **5.4-5.6** | ~650-700 rasterize calls per frame |
| **GPU upload (writeTexture)** | **4.7-4.9** | ~520-540 uploads, ~220KB/frame |
| Ink X-range compute | 0.4 | CPU pixel scan for each rasterized glyph |
| Atlas hit path | 0.08 | ~300 cache hits, negligible |
| Allocate | 0.02 | Trivial cursor-bump allocator |

**Key finding**: ~650-700 atlas misses per frame in steady state. Only ~300 atlas hits out of 971 calls. This means **69% of glyphs miss the atlas cache every frame**.

**Root cause**: The glyph key incorporates the font weight. Since each character's weight changes every frame (continuous sinusoidal LFO producing integer weights 300-900), the glyph keys change constantly. The atlas LRU eviction threshold is 3 frames, so glyphs not re-requested within 3 frames are evicted. With 900 characters x 601 possible weight values, the working set vastly exceeds what the atlas retains.

The eviction cascade works like this:
1. Frame N: Character "L" rendered at weight 456, glyph key K456 inserted into atlas
2. Frame N+1: Character "L" rendered at weight 458, glyph key K458 is a miss, K456 starts aging
3. Frame N+3: K456 is evicted (not used for 3 frames)
4. Next atlas beginFrame: eviction triggers full atlas clear + repack

### 2. Layout (FFI layoutText) -- 11% of frame (2.2ms)

The TS-side layout cache in `NativeTextEngine.layoutText()` has **high hit rate in late steady state** (881 hits / 901 calls = 97.8% at frame 400). This is because the cache key includes the weight, and with 900 unique (char, weight) pairs, the 16384-entry cache retains most of them across frames.

| Sub-component | Time (ms) | Notes |
|---------------|-----------|-------|
| Cache key construction | 0.37 | String interpolation for every call |
| FFI call (cache miss only) | 0.77 | ~20 misses per frame in late steady state |
| String encoding | 0.07 | `TextEncoder.encode()` for cache misses |
| Binary parse | 0.01 | `parseBinaryLayout()`, very fast |
| **Total** | **2.1** | |

**Observation**: The layout cache is working well. By frame 380+, only ~20-25 layout cache misses occur per frame. The 0.37ms overhead for cache key construction on every call is notable but not dominant.

### 3. endFrame (GPU submit) -- 8% of frame (1.5ms)

This covers:
- Creating Float32Array from vertex data arrays
- Uploading vertex buffers to GPU
- Recording render pass commands
- `device.queue.submit()`

At 971 glyphs x 6 vertices x 8 floats = 46,608 floats per frame for text alone.

### 4. Vertex Construction -- 1.5% of frame (0.3ms)

Building 6 textured quad vertices per glyph (transform point, push to array). This is very fast.

### 5. beginFrame -- <1% (0.06-0.1ms)

Array clearing and atlas `beginFrame()` (LRU eviction scan). Negligible.

## Profiling Data: Frame-by-Frame Progression

```
Frame 260: draw=28.6ms  layout=8.4ms(699hit/202miss)  atlas=10.7ms(324hit/647miss)  raster=4.9ms  upload=4.7ms
Frame 280: draw=24.4ms  layout=4.9ms(800hit/101miss)  atlas=11.8ms(319hit/652miss)  raster=5.8ms  upload=4.7ms
Frame 300: draw=21.5ms  layout=3.7ms(837hit/64miss)   atlas=11.4ms(293hit/678miss)  raster=5.2ms  upload=4.8ms
Frame 320: draw=20.0ms  layout=3.1ms(850hit/51miss)   atlas=11.8ms(270hit/701miss)  raster=5.5ms  upload=4.9ms
Frame 340: draw=20.4ms  layout=3.3ms(867hit/34miss)   atlas=13.6ms(279hit/692miss)  raster=7.1ms  upload=5.0ms
Frame 360: draw=20.0ms  layout=2.9ms(876hit/25miss)   atlas=13.3ms(320hit/651miss)  raster=6.7ms  upload=5.2ms
Frame 380: draw=20.4ms  layout=2.2ms(878hit/23miss)   atlas=11.4ms(303hit/668miss)  raster=5.4ms  upload=4.7ms
Frame 400: draw=19.5ms  layout=2.2ms(881hit/20miss)   atlas=11.6ms(316hit/655miss)  raster=5.5ms  upload=4.8ms
```

**Key observations**:
- Layout cache warms up nicely: misses drop from 202 to 20 over 140 frames
- Atlas miss rate stays stubbornly at ~650-700/frame -- it never improves because weight keeps changing
- Atlas rasterization cost varies 4.9-7.1ms depending on which glyphs are evicted/re-rasterized
- Atlas upload cost is remarkably stable at 4.7-5.2ms (~215-225KB per frame)

## Where Is the Biggest Optimization Opportunity?

### #1: Atlas miss rate (HIGH IMPACT -- could save ~10ms/frame)

The atlas is effectively useless for this workload. With continuous weight modulation, ~70% of glyph lookups miss the atlas every frame, triggering re-rasterization and re-upload.

**Potential solutions**:
1. **Weight quantization**: Round weights to nearest 10 or 25 before computing glyph keys. Weight 456 and 458 would both become 460 (or 450/475). This would dramatically reduce unique glyph keys and improve atlas hit rate. The visual difference at 40px size between weight 456 and 460 is imperceptible.
   - With quantization=25, only 25 unique weights instead of 601
   - Atlas working set: ~900 chars * 25 weights = much more cacheable

2. **Increase eviction threshold**: From 3 to e.g. 10-20 frames. Would help if the LFO period is short enough for glyphs to recur.

3. **Pre-warm atlas**: For known weight ranges, pre-rasterize common (glyph, weight) combinations.

### #2: GPU texture upload (MEDIUM IMPACT -- 4.7-5.0ms/frame)

Even if atlas misses are reduced, uploading ~215KB of glyph data per frame via `queue.writeTexture()` is inherently costly. Each upload is a separate API call.

**Potential solutions**:
1. **Batch uploads**: Accumulate all new glyph pixels into a single staging buffer, then do one `writeTexture` or `copyBufferToTexture` call.
2. **Persistent mapped buffer**: Use a ring buffer that stays mapped for writes.

### #3: Rasterization FFI calls (MEDIUM IMPACT -- 5.4ms/frame)

Each atlas miss triggers two FFI calls to `text_engine_rasterize_glyph` (probe size + actual rasterize). With ~650 misses, that is ~1300 FFI boundary crossings per frame.

**Potential solutions**:
1. **Batch rasterization API**: A single FFI call that rasterizes multiple glyphs and returns all pixels in one buffer.
2. **Pre-allocated pixel buffers**: Avoid re-allocating `Uint8Array(needed)` for every rasterize call.

### #4: Cache key construction (LOW IMPACT -- 0.37ms/frame)

String interpolation for 901 calls. Could be replaced with a numeric hash.

## Conclusion

The dominant bottleneck is the **atlas cache miss rate** caused by continuously varying font weights. Each frame, ~650-700 glyphs must be re-rasterized (~5.5ms) and re-uploaded to GPU (~4.8ms), totaling ~10.3ms or **53% of the total frame time**.

The most impactful single optimization would be **weight quantization** (snapping weights to a coarser grid). This would:
- Dramatically reduce unique glyph keys per frame
- Increase atlas cache hit rate from ~30% to potentially 90%+
- Save ~8-10ms per frame, bringing frame times down to potentially ~10-12ms

The layout cache is already effective (97.8% hit rate). Vertex construction and GPU command recording are efficient. The problem is almost entirely in the atlas rasterize-and-upload cycle driven by cache misses from weight variation.

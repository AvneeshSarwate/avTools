#pragma once
#include <cstdint>

// Matches apps/deno-notebooks/native/text_engine/src/lib.rs. The Rust engine
// owns all internal storage. Output bytes are copied into caller-owned buffers.
extern "C" {
struct TextEngine;
TextEngine* text_engine_create();
void text_engine_destroy(TextEngine*);
uint32_t text_engine_load_font_bytes(TextEngine*, const uint8_t*, uint32_t);
uint32_t text_engine_layout_json(TextEngine*, const uint8_t*, uint32_t,
    const uint8_t*, uint32_t, float, float, float, float, uint32_t, uint32_t,
    uint16_t, uint32_t, float, const uint8_t*, uint32_t, uint32_t, uint8_t*, uint32_t);
uint32_t text_engine_rasterize_glyph(TextEngine*, uint64_t, uint8_t*, uint32_t,
    uint32_t*, uint32_t*, int32_t*, int32_t*, uint32_t*);
}

use serde_json::Value;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use swash::scale::{Render, Source, StrikeWith};
use swash::zeno::{Angle, Format, Transform, Vector, Verb};

// ---------------------------------------------------------------------------
// Custom CacheKey / SubpixelBin / CacheKeyFlags (replaces cosmic-text's types)
// ---------------------------------------------------------------------------

bitflags::bitflags! {
    #[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
    #[repr(transparent)]
    pub struct CacheKeyFlags: u32 {
        const FAKE_ITALIC = 1;
        const DISABLE_HINTING = 2;
        const PIXEL_FONT = 4;
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum SubpixelBin {
    Zero,
    One,
    Two,
    Three,
}

impl SubpixelBin {
    pub fn new(pos: f32) -> (i32, Self) {
        let trunc = pos as i32;
        let fract = pos - trunc as f32;

        if pos.is_sign_negative() {
            if fract > -0.125 {
                (trunc, Self::Zero)
            } else if fract > -0.375 {
                (trunc - 1, Self::Three)
            } else if fract > -0.625 {
                (trunc - 1, Self::Two)
            } else if fract > -0.875 {
                (trunc - 1, Self::One)
            } else {
                (trunc - 1, Self::Zero)
            }
        } else {
            #[allow(clippy::collapsible_else_if)]
            if fract < 0.125 {
                (trunc, Self::Zero)
            } else if fract < 0.375 {
                (trunc, Self::One)
            } else if fract < 0.625 {
                (trunc, Self::Two)
            } else if fract < 0.875 {
                (trunc, Self::Three)
            } else {
                (trunc + 1, Self::Zero)
            }
        }
    }

    pub const fn as_float(&self) -> f32 {
        match self {
            Self::Zero => 0.0,
            Self::One => 0.25,
            Self::Two => 0.5,
            Self::Three => 0.75,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct CacheKey {
    pub font_id: fontdb::ID,
    pub glyph_id: u16,
    pub font_size_bits: u32,
    pub x_bin: SubpixelBin,
    pub y_bin: SubpixelBin,
    pub font_weight: u16,
    pub flags: CacheKeyFlags,
}

impl CacheKey {
    pub fn new(
        font_id: fontdb::ID,
        glyph_id: u16,
        font_size: f32,
        pos: (f32, f32),
        weight: u16,
        flags: CacheKeyFlags,
    ) -> (Self, i32, i32) {
        let (x, x_bin) = SubpixelBin::new(pos.0);
        let (y, y_bin) = SubpixelBin::new(pos.1);
        (
            Self {
                font_id,
                glyph_id,
                font_size_bits: font_size.to_bits(),
                x_bin,
                y_bin,
                flags,
                font_weight: weight,
            },
            x,
            y,
        )
    }
}

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
struct AxisSetting {
    tag: [u8; 4],
    value: f32,
}

#[derive(Clone, Debug)]
struct GlyphRasterRecord {
    cache_key: CacheKey,
    axes: Arc<Vec<AxisSetting>>,
}

#[derive(Clone, Debug)]
struct RasterizedMask {
    width: u32,
    height: u32,
    left: i32,
    top: i32,
    content_type: u32,
    data: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
struct GlyphOutlineBoundsKey {
    font_id: fontdb::ID,
    glyph_id: u16,
    font_size_bits: u32,
    font_weight: u16,
    axes_hash: u64,
}

struct LayoutGlyphOut {
    key: u64,
    x: i32,
    y: i32,
}

/// A shaped glyph ready for positioning.
#[derive(Clone, Copy)]
struct ShapedGlyph {
    glyph_id: u16,
    x_advance: f32,  // in pixels
    x_offset: f32,   // in pixels
    y_offset: f32,   // in pixels
}

// ---------------------------------------------------------------------------
// Cache key types
// ---------------------------------------------------------------------------

#[derive(Clone, Hash, PartialEq, Eq)]
struct FontResolveKey {
    family: String,
    weight: u16,
    style: u32,
}

#[derive(Clone, Copy, Hash, PartialEq, Eq)]
struct FontMetricsKey {
    font_id: fontdb::ID,
    font_size_bits: u32,
    weight: u16,
    axes_hash: u64,
}

#[derive(Clone, Hash, PartialEq, Eq)]
struct ShapeCacheKey {
    font_id: fontdb::ID,
    text: String,
    font_size_bits: u32,
    weight: u16,
    style: u32,
    axes_hash: u64,
}

const SHAPE_CACHE_MAX_ENTRIES: usize = 16384;

// ---------------------------------------------------------------------------
// TextEngine
// ---------------------------------------------------------------------------

pub struct TextEngine {
    db: fontdb::Database,
    scale_context: swash::scale::ScaleContext,
    outline_scale_context: swash::scale::ScaleContext,
    outline_bounds_cache: HashMap<GlyphOutlineBoundsKey, Option<(f32, f32)>>,
    glyph_records: HashMap<u64, GlyphRasterRecord>,
    axis_image_cache: HashMap<u64, RasterizedMask>,
    // --- Performance caches ---
    font_resolve_cache: HashMap<FontResolveKey, Option<fontdb::ID>>,
    font_metrics_cache: HashMap<FontMetricsKey, (f32, f32, f32)>,
    shape_cache: HashMap<ShapeCacheKey, Vec<ShapedGlyph>>,
    font_data_cache: HashMap<fontdb::ID, (Vec<u8>, u32)>,
}

impl TextEngine {
    fn new() -> Self {
        let db = fontdb::Database::new();
        Self {
            db,
            scale_context: swash::scale::ScaleContext::new(),
            outline_scale_context: swash::scale::ScaleContext::new(),
            outline_bounds_cache: HashMap::new(),
            glyph_records: HashMap::new(),
            axis_image_cache: HashMap::new(),
            font_resolve_cache: HashMap::new(),
            font_metrics_cache: HashMap::new(),
            shape_cache: HashMap::new(),
            font_data_cache: HashMap::new(),
        }
    }

    fn load_font_file(&mut self, path: &str) -> bool {
        self.db.load_font_file(path).is_ok()
    }

    fn load_font_bytes(&mut self, bytes: &[u8]) {
        let data: Arc<Vec<u8>> = Arc::new(bytes.to_vec());
        let source: Arc<dyn AsRef<[u8]> + Send + Sync> = data;
        self.db.load_font_source(fontdb::Source::Binary(source));
    }

    // ------------------------------------------------------------------
    // Font resolution: family name + weight + style -> fontdb::ID
    // ------------------------------------------------------------------

    fn resolve_font_id(&mut self, family: &str, weight: u16, style: u32) -> Option<fontdb::ID> {
        let key = FontResolveKey {
            family: family.to_string(),
            weight,
            style,
        };

        if let Some(cached) = self.font_resolve_cache.get(&key) {
            return *cached;
        }

        let families = if family.trim().is_empty() {
            vec![fontdb::Family::SansSerif]
        } else {
            vec![fontdb::Family::Name(family)]
        };

        let db_style = match style {
            1 => fontdb::Style::Italic,
            2 => fontdb::Style::Oblique,
            _ => fontdb::Style::Normal,
        };

        let query = fontdb::Query {
            families: &families,
            weight: fontdb::Weight(weight),
            stretch: fontdb::Stretch::Normal,
            style: db_style,
        };

        let result = self.db.query(&query);
        self.font_resolve_cache.insert(key, result);
        result
    }

    // ------------------------------------------------------------------
    // Font data cache: avoids db.with_face_data() closure on every call
    // ------------------------------------------------------------------

    fn ensure_font_data_cached(&mut self, font_id: fontdb::ID) {
        if self.font_data_cache.contains_key(&font_id) {
            return;
        }
        self.db.with_face_data(font_id, |font_data, face_index| {
            self.font_data_cache
                .insert(font_id, (font_data.to_vec(), face_index));
        });
    }

    // ------------------------------------------------------------------
    // Shaping: text -> Vec<ShapedGlyph> using harfrust directly
    // ------------------------------------------------------------------

    fn shape_text(
        &mut self,
        font_id: fontdb::ID,
        text: &str,
        font_size: f32,
        weight: u16,
        style: u32,
        axes: &[AxisSetting],
        axes_hash: u64,
    ) -> Vec<ShapedGlyph> {
        if text.is_empty() || !font_size.is_finite() || font_size <= 0.0 {
            return Vec::new();
        }

        // Check shape cache first
        let cache_key = ShapeCacheKey {
            font_id,
            text: text.to_string(),
            font_size_bits: font_size.to_bits(),
            weight,
            style,
            axes_hash,
        };
        if let Some(cached) = self.shape_cache.get(&cache_key) {
            return cached.clone();
        }

        // Ensure font data is cached
        self.ensure_font_data_cached(font_id);

        let result = if let Some((font_data, face_index)) = self.font_data_cache.get(&font_id) {
            let font_data = font_data.as_slice();
            let face_index = *face_index;

            let font_ref_opt = harfrust::FontRef::from_index(font_data, face_index).ok();
            if let Some(font_ref) = font_ref_opt {
                let shaper_data = harfrust::ShaperData::new(&font_ref);

                let mut settings = Vec::<harfrust::Variation>::new();
                let mut has_wght = false;
                let mut has_opsz = false;

                for axis in axes {
                    if axis.tag == *b"wght" {
                        has_wght = true;
                    } else if axis.tag == *b"opsz" {
                        has_opsz = true;
                    }
                    settings.push(harfrust::Variation {
                        tag: harfrust::Tag::new(&axis.tag),
                        value: axis.value,
                    });
                }

                if !has_wght {
                    settings.push(harfrust::Variation {
                        tag: harfrust::Tag::new(b"wght"),
                        value: f32::from(weight),
                    });
                }

                if !has_opsz {
                    if let Some(swash_ref) =
                        swash::FontRef::from_index(font_data, face_index as usize)
                    {
                        let opsz_tag = swash::Tag::from_be_bytes(*b"opsz");
                        if let Some(axis) = swash_ref.variations().find_by_tag(opsz_tag) {
                            settings.push(harfrust::Variation {
                                tag: harfrust::Tag::new(b"opsz"),
                                value: font_size.clamp(axis.min_value(), axis.max_value()),
                            });
                        }
                    }
                }

                let instance = harfrust::ShaperInstance::from_variations(&font_ref, settings);
                let shaper = shaper_data
                    .shaper(&font_ref)
                    .instance(Some(&instance))
                    .point_size(Some(font_size))
                    .build();

                let mut buffer = harfrust::UnicodeBuffer::new();
                buffer.push_str(text);

                buffer.set_direction(harfrust::Direction::LeftToRight);
                buffer.guess_segment_properties();

                let glyph_buffer = shaper.shape(buffer, &[]);
                let upem = shaper.units_per_em().max(1) as f32;
                let scale = font_size / upem;

                let positions = glyph_buffer.glyph_positions();
                let infos = glyph_buffer.glyph_infos();

                let mut glyphs = Vec::with_capacity(positions.len());
                for (pos, info) in positions.iter().zip(infos.iter()) {
                    glyphs.push(ShapedGlyph {
                        glyph_id: info.glyph_id as u16,
                        x_advance: pos.x_advance as f32 * scale,
                        x_offset: pos.x_offset as f32 * scale,
                        y_offset: pos.y_offset as f32 * scale,
                    });
                }
                glyphs
            } else {
                Vec::new()
            }
        } else {
            Vec::new()
        };

        // Bounded eviction: clear entirely if over limit
        if self.shape_cache.len() >= SHAPE_CACHE_MAX_ENTRIES {
            self.shape_cache.clear();
        }
        self.shape_cache.insert(cache_key, result.clone());
        result
    }

    // ------------------------------------------------------------------
    // Layout: the main method replacing cosmic-text Buffer layout
    // ------------------------------------------------------------------

    #[allow(clippy::too_many_arguments)]
    fn layout_to_binary(
        &mut self,
        text: &str,
        family: &str,
        font_size: f32,
        line_height: f32,
        width: f32,
        _height: f32,
        align_h: u32,
        wrap_mode: u32,
        weight: u16,
        style: u32,
        axis_quantization: f32,
        axes_json: &str,
    ) -> Vec<u8> {
        let size = if font_size.is_finite() {
            font_size.max(1.0)
        } else {
            12.0
        };
        let leading = if line_height.is_finite() {
            line_height.max(1.0)
        } else {
            size * 1.275
        };

        let max_width = if width.is_finite() && width > 0.0 {
            Some(width)
        } else {
            None
        };

        let axes = parse_axes(axes_json, axis_quantization);
        let axes_hash = hash_axes(&axes);
        let axes_arc = Arc::new(axes);

        // Resolve font
        let font_id = match self.resolve_font_id(family, weight, style) {
            Some(id) => id,
            None => {
                // No font found, return empty layout
                return self.emit_empty_layout(leading);
            }
        };

        // Determine CacheKeyFlags
        let is_italic = style == 1;
        let face_is_italic = self.db.face(font_id)
            .map(|f| f.style == fontdb::Style::Italic)
            .unwrap_or(false);
        let cache_flags = if is_italic && !face_is_italic {
            CacheKeyFlags::FAKE_ITALIC
        } else {
            CacheKeyFlags::empty()
        };

        // Get font metrics (ascent, descent, cap_height)
        let (font_ascent, font_descent, font_cap_height) =
            self.measure_font_box_metrics(font_id, size, weight, &axes_arc, axes_hash)
                .unwrap_or((0.0, 0.0, 0.0));

        // The baseline position within each line: place baseline so that
        // ascent sits at the top. cosmic-text uses: line_top + (leading - size) / 2 + ascent_from_metrics
        // We replicate: ascent portion of the line_height
        let ascent_ratio = if (font_ascent + font_descent) > 0.0 {
            font_ascent / (font_ascent + font_descent)
        } else {
            0.8
        };

        // Wrap mode: 0=word, 1=glyph, 2=none
        let do_wrap = wrap_mode != 2;
        let word_wrap = wrap_mode == 0;

        // Split text into lines by newline first
        let hard_lines: Vec<&str> = text.split('\n').collect();

        let mut glyphs_out = Vec::<LayoutGlyphOut>::new();
        let mut pending_records = Vec::<(u64, GlyphRasterRecord)>::new();

        let mut line_count = 0usize;
        let mut font_width = 0.0f32;
        let mut tight_width = 0.0f32;
        let mut first_baseline = 0.0f32;
        let mut have_first_line = false;
        let mut total_height = 0.0f32;
        let mut first_line_top = 0.0f32;

        // Take outline contexts out of self to avoid borrow conflicts
        let mut outline_scale_context = std::mem::replace(
            &mut self.outline_scale_context,
            swash::scale::ScaleContext::new(),
        );
        let mut outline_bounds_cache = std::mem::take(&mut self.outline_bounds_cache);

        let mut current_y = 0.0f32;

        for hard_line in &hard_lines {
            if do_wrap && max_width.is_some() {
                let max_w = max_width.unwrap();

                if word_wrap {
                    // Word wrapping
                    self.layout_word_wrapped(
                        hard_line,
                        font_id,
                        size,
                        leading,
                        weight,
                        style,
                        &axes_arc,
                        axes_hash,
                        cache_flags,
                        max_w,
                        align_h,
                        ascent_ratio,
                        &mut current_y,
                        &mut line_count,
                        &mut font_width,
                        &mut tight_width,
                        &mut first_baseline,
                        &mut have_first_line,
                        &mut first_line_top,
                        &mut total_height,
                        &mut glyphs_out,
                        &mut pending_records,
                        &mut outline_scale_context,
                        &mut outline_bounds_cache,
                    );
                } else {
                    // Glyph wrapping
                    self.layout_glyph_wrapped(
                        hard_line,
                        font_id,
                        size,
                        leading,
                        weight,
                        style,
                        &axes_arc,
                        axes_hash,
                        cache_flags,
                        max_w,
                        align_h,
                        ascent_ratio,
                        &mut current_y,
                        &mut line_count,
                        &mut font_width,
                        &mut tight_width,
                        &mut first_baseline,
                        &mut have_first_line,
                        &mut first_line_top,
                        &mut total_height,
                        &mut glyphs_out,
                        &mut pending_records,
                        &mut outline_scale_context,
                        &mut outline_bounds_cache,
                    );
                }
            } else {
                // No wrapping (or no width set)
                let shaped = self.shape_text(font_id, hard_line, size, weight, style, &axes_arc, axes_hash);

                let line_y = current_y + leading * ascent_ratio;
                let line_top = current_y;

                if !have_first_line {
                    first_line_top = line_top;
                    first_baseline = line_y;
                    have_first_line = true;
                }

                let line_w = shaped.iter().map(|g| g.x_advance).sum::<f32>();
                let x_offset = self.compute_align_offset(line_w, max_width, align_h);

                self.emit_line_glyphs(
                    &shaped,
                    font_id,
                    size,
                    weight,
                    &axes_arc,
                    axes_hash,
                    cache_flags,
                    x_offset,
                    line_y,
                    &mut font_width,
                    &mut tight_width,
                    &mut glyphs_out,
                    &mut pending_records,
                    &mut outline_scale_context,
                    &mut outline_bounds_cache,
                );

                line_count += 1;
                total_height = total_height.max(current_y + leading - first_line_top);
                current_y += leading;
            }
        }

        // Restore outline contexts
        self.outline_scale_context = outline_scale_context;
        self.outline_bounds_cache = outline_bounds_cache;

        // Merge pending records into persistent glyph_records (don't clear existing).
        for (key, record) in pending_records {
            self.glyph_records.insert(key, record);
        }
        // Bounded eviction: if glyph_records exceeds limit, clear and re-populate from this call.
        if self.glyph_records.len() > 32768 {
            self.glyph_records.clear();
            self.axis_image_cache.clear();
        }

        let ascent = if have_first_line {
            (first_baseline - first_line_top).max(0.0)
        } else {
            0.0
        };
        let descent = if have_first_line {
            (leading - ascent).max(0.0)
        } else {
            0.0
        };

        let actual_total_height = if total_height > 0.0 {
            total_height
        } else {
            leading
        };

        // Binary protocol: 44-byte header + 16 bytes per glyph
        let glyph_count = glyphs_out.len() as u32;
        let total_size = 44 + (glyph_count as usize) * 16;
        let mut buf = Vec::with_capacity(total_size);

        // Header: 10 x f32 + 1 x u32 = 44 bytes
        buf.extend_from_slice(&tight_width.to_le_bytes());         // offset 0
        buf.extend_from_slice(&font_width.to_le_bytes());          // offset 4
        buf.extend_from_slice(&ascent.to_le_bytes());              // offset 8
        buf.extend_from_slice(&descent.to_le_bytes());             // offset 12
        buf.extend_from_slice(&font_ascent.to_le_bytes());         // offset 16
        buf.extend_from_slice(&font_descent.to_le_bytes());        // offset 20
        buf.extend_from_slice(&font_cap_height.to_le_bytes());     // offset 24
        buf.extend_from_slice(&first_baseline.to_le_bytes());      // offset 28
        buf.extend_from_slice(&actual_total_height.to_le_bytes()); // offset 32
        buf.extend_from_slice(&(line_count as f32).to_le_bytes()); // offset 36
        buf.extend_from_slice(&glyph_count.to_le_bytes());         // offset 40

        // Per-glyph records: 16 bytes each (u64 key + i32 x + i32 y)
        for glyph in &glyphs_out {
            buf.extend_from_slice(&glyph.key.to_le_bytes());  // offset +0: u64
            buf.extend_from_slice(&glyph.x.to_le_bytes());    // offset +8: i32
            buf.extend_from_slice(&glyph.y.to_le_bytes());    // offset +12: i32
        }

        buf
    }

    // ------------------------------------------------------------------
    // Word wrapping layout
    // ------------------------------------------------------------------

    #[allow(clippy::too_many_arguments)]
    fn layout_word_wrapped(
        &mut self,
        text: &str,
        font_id: fontdb::ID,
        font_size: f32,
        line_height: f32,
        weight: u16,
        style: u32,
        axes: &Arc<Vec<AxisSetting>>,
        axes_hash: u64,
        cache_flags: CacheKeyFlags,
        max_width: f32,
        align_h: u32,
        ascent_ratio: f32,
        current_y: &mut f32,
        line_count: &mut usize,
        font_width: &mut f32,
        tight_width: &mut f32,
        first_baseline: &mut f32,
        have_first_line: &mut bool,
        first_line_top: &mut f32,
        total_height: &mut f32,
        glyphs_out: &mut Vec<LayoutGlyphOut>,
        pending_records: &mut Vec<(u64, GlyphRasterRecord)>,
        outline_scale_context: &mut swash::scale::ScaleContext,
        outline_bounds_cache: &mut HashMap<GlyphOutlineBoundsKey, Option<(f32, f32)>>,
    ) {
        if text.is_empty() {
            // Empty line still counts as a line
            let line_y = *current_y + line_height * ascent_ratio;
            if !*have_first_line {
                *first_line_top = *current_y;
                *first_baseline = line_y;
                *have_first_line = true;
            }
            *line_count += 1;
            *total_height = total_height.max(*current_y + line_height - *first_line_top);
            *current_y += line_height;
            return;
        }

        // Split into word segments. Each segment is either whitespace or non-whitespace.
        // We shape each segment separately so we can break between words.
        let segments = split_into_segments(text);

        // Shape all segments
        let mut shaped_segments: Vec<(Vec<ShapedGlyph>, f32, bool)> = Vec::new(); // (glyphs, total_advance, is_whitespace)
        for (seg_text, is_ws) in &segments {
            let shaped = self.shape_text(font_id, seg_text, font_size, weight, style, axes, axes_hash);
            let advance: f32 = shaped.iter().map(|g| g.x_advance).sum();
            shaped_segments.push((shaped, advance, *is_ws));
        }

        // Greedy line-breaking
        let mut line_segments: Vec<(usize, usize)> = Vec::new(); // (start_seg_idx, end_seg_idx exclusive)
        let mut line_start = 0usize;
        let mut line_advance = 0.0f32;

        for (i, (_glyphs, advance, is_ws)) in shaped_segments.iter().enumerate() {
            let candidate = line_advance + advance;
            if !is_ws && candidate > max_width && line_advance > 0.0 {
                // Break before this word
                line_segments.push((line_start, i));
                line_start = i;
                line_advance = *advance;
            } else {
                line_advance += advance;
            }
        }
        // Final line
        if line_start < shaped_segments.len() {
            line_segments.push((line_start, shaped_segments.len()));
        }

        // Now emit glyphs for each wrapped line
        for (seg_start, seg_end) in &line_segments {
            let line_y = *current_y + line_height * ascent_ratio;
            let line_top = *current_y;

            if !*have_first_line {
                *first_line_top = line_top;
                *first_baseline = line_y;
                *have_first_line = true;
            }

            // Collect all glyphs for this line, compute total advance
            let mut line_glyphs = Vec::new();
            let mut line_w = 0.0f32;
            for seg_idx in *seg_start..*seg_end {
                let (ref glyphs, _advance, _is_ws) = shaped_segments[seg_idx];
                for g in glyphs {
                    line_glyphs.push(g);
                }
                line_w += _advance;
            }

            // Strip trailing whitespace advance from line width for alignment
            let mut trimmed_w = line_w;
            // Walk backwards to find trailing whitespace segments
            for seg_idx in (*seg_start..*seg_end).rev() {
                let (_ref_glyphs, advance, is_ws) = &shaped_segments[seg_idx];
                if *is_ws {
                    trimmed_w -= advance;
                } else {
                    break;
                }
            }

            let x_offset = self.compute_align_offset(trimmed_w, Some(max_width), align_h);

            self.emit_line_glyphs_from_refs(
                &line_glyphs,
                font_id,
                font_size,
                weight,
                axes,
                axes_hash,
                cache_flags,
                x_offset,
                line_y,
                font_width,
                tight_width,
                glyphs_out,
                pending_records,
                outline_scale_context,
                outline_bounds_cache,
            );

            *font_width = font_width.max(trimmed_w);
            *line_count += 1;
            *total_height = total_height.max(*current_y + line_height - *first_line_top);
            *current_y += line_height;
        }
    }

    // ------------------------------------------------------------------
    // Glyph wrapping layout
    // ------------------------------------------------------------------

    #[allow(clippy::too_many_arguments)]
    fn layout_glyph_wrapped(
        &mut self,
        text: &str,
        font_id: fontdb::ID,
        font_size: f32,
        line_height: f32,
        weight: u16,
        style: u32,
        axes: &Arc<Vec<AxisSetting>>,
        axes_hash: u64,
        cache_flags: CacheKeyFlags,
        max_width: f32,
        align_h: u32,
        ascent_ratio: f32,
        current_y: &mut f32,
        line_count: &mut usize,
        font_width: &mut f32,
        tight_width: &mut f32,
        first_baseline: &mut f32,
        have_first_line: &mut bool,
        first_line_top: &mut f32,
        total_height: &mut f32,
        glyphs_out: &mut Vec<LayoutGlyphOut>,
        pending_records: &mut Vec<(u64, GlyphRasterRecord)>,
        outline_scale_context: &mut swash::scale::ScaleContext,
        outline_bounds_cache: &mut HashMap<GlyphOutlineBoundsKey, Option<(f32, f32)>>,
    ) {
        let shaped = self.shape_text(font_id, text, font_size, weight, style, axes, axes_hash);

        if shaped.is_empty() {
            // Empty line
            let line_y = *current_y + line_height * ascent_ratio;
            if !*have_first_line {
                *first_line_top = *current_y;
                *first_baseline = line_y;
                *have_first_line = true;
            }
            *line_count += 1;
            *total_height = total_height.max(*current_y + line_height - *first_line_top);
            *current_y += line_height;
            return;
        }

        // Break glyphs into lines at glyph boundaries
        let mut line_start = 0usize;
        let mut line_advance = 0.0f32;

        let mut line_ranges: Vec<(usize, usize)> = Vec::new();
        for (i, g) in shaped.iter().enumerate() {
            if line_advance + g.x_advance > max_width && line_advance > 0.0 {
                line_ranges.push((line_start, i));
                line_start = i;
                line_advance = g.x_advance;
            } else {
                line_advance += g.x_advance;
            }
        }
        if line_start < shaped.len() {
            line_ranges.push((line_start, shaped.len()));
        }

        for (start, end) in &line_ranges {
            let line_y = *current_y + line_height * ascent_ratio;
            let line_top = *current_y;

            if !*have_first_line {
                *first_line_top = line_top;
                *first_baseline = line_y;
                *have_first_line = true;
            }

            let line_glyphs: Vec<&ShapedGlyph> = shaped[*start..*end].iter().collect();
            let line_w: f32 = line_glyphs.iter().map(|g| g.x_advance).sum();

            let x_offset = self.compute_align_offset(line_w, Some(max_width), align_h);

            self.emit_line_glyphs_from_refs(
                &line_glyphs,
                font_id,
                font_size,
                weight,
                axes,
                axes_hash,
                cache_flags,
                x_offset,
                line_y,
                font_width,
                tight_width,
                glyphs_out,
                pending_records,
                outline_scale_context,
                outline_bounds_cache,
            );

            *font_width = font_width.max(line_w);
            *line_count += 1;
            *total_height = total_height.max(*current_y + line_height - *first_line_top);
            *current_y += line_height;
        }
    }

    // ------------------------------------------------------------------
    // Emit glyphs for a single line (owned ShapedGlyph slice)
    // ------------------------------------------------------------------

    #[allow(clippy::too_many_arguments)]
    fn emit_line_glyphs(
        &self,
        shaped: &[ShapedGlyph],
        font_id: fontdb::ID,
        font_size: f32,
        weight: u16,
        axes: &Arc<Vec<AxisSetting>>,
        axes_hash: u64,
        cache_flags: CacheKeyFlags,
        x_start: f32,
        line_y: f32,
        font_width: &mut f32,
        tight_width: &mut f32,
        glyphs_out: &mut Vec<LayoutGlyphOut>,
        pending_records: &mut Vec<(u64, GlyphRasterRecord)>,
        outline_scale_context: &mut swash::scale::ScaleContext,
        outline_bounds_cache: &mut HashMap<GlyphOutlineBoundsKey, Option<(f32, f32)>>,
    ) {
        let refs: Vec<&ShapedGlyph> = shaped.iter().collect();
        self.emit_line_glyphs_from_refs(
            &refs,
            font_id,
            font_size,
            weight,
            axes,
            axes_hash,
            cache_flags,
            x_start,
            line_y,
            font_width,
            tight_width,
            glyphs_out,
            pending_records,
            outline_scale_context,
            outline_bounds_cache,
        );
    }

    // ------------------------------------------------------------------
    // Emit glyphs for a single line (reference slice)
    // ------------------------------------------------------------------

    #[allow(clippy::too_many_arguments)]
    fn emit_line_glyphs_from_refs(
        &self,
        shaped: &[&ShapedGlyph],
        font_id: fontdb::ID,
        font_size: f32,
        weight: u16,
        axes: &Arc<Vec<AxisSetting>>,
        axes_hash: u64,
        cache_flags: CacheKeyFlags,
        x_start: f32,
        line_y: f32,
        font_width: &mut f32,
        tight_width: &mut f32,
        glyphs_out: &mut Vec<LayoutGlyphOut>,
        pending_records: &mut Vec<(u64, GlyphRasterRecord)>,
        outline_scale_context: &mut swash::scale::ScaleContext,
        outline_bounds_cache: &mut HashMap<GlyphOutlineBoundsKey, Option<(f32, f32)>>,
    ) {
        let mut cursor_x = x_start;
        let mut line_min_x = f32::INFINITY;
        let mut line_max_x = f32::NEG_INFINITY;
        let mut line_ink_min_x = f32::INFINITY;
        let mut line_ink_max_x = f32::NEG_INFINITY;

        for glyph in shaped {
            let glyph_x = cursor_x + glyph.x_offset;
            let glyph_y = line_y - glyph.y_offset;

            line_min_x = line_min_x.min(glyph_x);
            line_max_x = line_max_x.max(glyph_x + glyph.x_advance);

            // Outline bounds for tight_width
            let outline_key = GlyphOutlineBoundsKey {
                font_id,
                glyph_id: glyph.glyph_id,
                font_size_bits: font_size.to_bits(),
                font_weight: weight,
                axes_hash,
            };
            let outline_bounds = if let Some(cached) = outline_bounds_cache.get(&outline_key) {
                *cached
            } else {
                let measured = self.measure_glyph_outline_x_bounds(
                    outline_scale_context,
                    font_id,
                    glyph.glyph_id,
                    font_size,
                    weight,
                    axes.as_slice(),
                );
                outline_bounds_cache.insert(outline_key, measured);
                measured
            };
            if let Some((outline_min_x, outline_max_x)) = outline_bounds {
                line_ink_min_x = line_ink_min_x.min(glyph_x + outline_min_x);
                line_ink_max_x = line_ink_max_x.max(glyph_x + outline_max_x);
            }

            // Build CacheKey and physical position
            let (cache_key, px, py) = CacheKey::new(
                font_id,
                glyph.glyph_id,
                font_size,
                (glyph_x, glyph_y.trunc()),
                weight,
                cache_flags,
            );

            let key = hash_glyph_key(&cache_key, axes_hash);
            glyphs_out.push(LayoutGlyphOut {
                key,
                x: px,
                y: py,
            });
            pending_records.push((
                key,
                GlyphRasterRecord {
                    cache_key,
                    axes: Arc::clone(axes),
                },
            ));

            cursor_x += glyph.x_advance;
        }

        let line_w = cursor_x - x_start;
        *font_width = font_width.max(line_w);

        if line_ink_min_x.is_finite() && line_ink_max_x.is_finite() {
            *tight_width = tight_width.max((line_ink_max_x - line_ink_min_x).max(0.0));
        } else if line_min_x.is_finite() && line_max_x.is_finite() {
            *tight_width = tight_width.max((line_max_x - line_min_x).max(0.0));
        }
    }

    // ------------------------------------------------------------------
    // Alignment offset
    // ------------------------------------------------------------------

    fn compute_align_offset(&self, line_w: f32, max_width: Option<f32>, align_h: u32) -> f32 {
        match (align_h, max_width) {
            (1, Some(w)) => (w - line_w) / 2.0, // center
            (2, Some(w)) => w - line_w,          // right
            _ => 0.0,                            // left
        }
    }

    // ------------------------------------------------------------------
    // Empty layout helper
    // ------------------------------------------------------------------

    fn emit_empty_layout(&self, line_height: f32) -> Vec<u8> {
        let mut buf = Vec::with_capacity(44);
        buf.extend_from_slice(&0.0f32.to_le_bytes());           // tight_width
        buf.extend_from_slice(&0.0f32.to_le_bytes());           // font_width
        buf.extend_from_slice(&0.0f32.to_le_bytes());           // ascent
        buf.extend_from_slice(&0.0f32.to_le_bytes());           // descent
        buf.extend_from_slice(&0.0f32.to_le_bytes());           // font_ascent
        buf.extend_from_slice(&0.0f32.to_le_bytes());           // font_descent
        buf.extend_from_slice(&0.0f32.to_le_bytes());           // font_cap_height
        buf.extend_from_slice(&0.0f32.to_le_bytes());           // first_baseline
        buf.extend_from_slice(&line_height.to_le_bytes());      // total_height
        buf.extend_from_slice(&0.0f32.to_le_bytes());           // line_count
        buf.extend_from_slice(&0u32.to_le_bytes());             // glyph_count
        buf
    }

    // ------------------------------------------------------------------
    // Rasterization
    // ------------------------------------------------------------------

    fn rasterize_mask_for_key(&mut self, key: u64) -> Option<RasterizedMask> {
        if let Some(existing) = self.axis_image_cache.get(&key) {
            return Some(existing.clone());
        }

        let record = self.glyph_records.get(&key)?.clone();
        let image = self.rasterize_glyph(record.cache_key, record.axes.as_slice())?;
        let mask = swash_image_to_mask(&image);
        self.axis_image_cache.insert(key, mask.clone());
        Some(mask)
    }

    fn rasterize_glyph(
        &mut self,
        cache_key: CacheKey,
        axes: &[AxisSetting],
    ) -> Option<swash::scale::image::Image> {
        // Ensure font data is cached
        self.ensure_font_data_cached(cache_key.font_id);

        let (font_data, face_index) = self.font_data_cache.get(&cache_key.font_id)?;
        let font_data = font_data.as_slice();
        let face_index = *face_index;

        let font_ref = swash::FontRef::from_index(font_data, face_index as usize)?;

        let mut scaler = self
            .scale_context
            .builder(font_ref)
            .size(f32::from_bits(cache_key.font_size_bits))
            .hint(!cache_key.flags.contains(CacheKeyFlags::DISABLE_HINTING));

        let mut settings = Vec::new();
        let mut has_wght = false;

        for axis in axes {
            let tag = swash::Tag::from_be_bytes(axis.tag);
            has_wght |= axis.tag == *b"wght";

            let mut value = axis.value;
            if let Some(var_axis) = font_ref.variations().find_by_tag(tag) {
                value = value.clamp(var_axis.min_value(), var_axis.max_value());
            }

            settings.push(swash::Setting { tag, value });
        }

        if !has_wght {
            let weight_tag = swash::Tag::from_be_bytes(*b"wght");
            if let Some(var_axis) = font_ref.variations().find_by_tag(weight_tag) {
                settings.push(swash::Setting {
                    tag: weight_tag,
                    value: f32::from(cache_key.font_weight)
                        .clamp(var_axis.min_value(), var_axis.max_value()),
                });
            }
        }

        if !settings.is_empty() {
            scaler = scaler.variations(settings.into_iter());
        }

        let mut scaler = scaler.build();

        let offset = if cache_key.flags.contains(CacheKeyFlags::PIXEL_FONT) {
            Vector::new(
                cache_key.x_bin.as_float().round() + 1.0,
                cache_key.y_bin.as_float().round(),
            )
        } else {
            Vector::new(cache_key.x_bin.as_float(), cache_key.y_bin.as_float())
        };

        Render::new(&[
            Source::ColorOutline(0),
            Source::ColorBitmap(StrikeWith::BestFit),
            Source::Outline,
        ])
        .format(Format::Alpha)
        .offset(offset)
        .transform(if cache_key.flags.contains(CacheKeyFlags::FAKE_ITALIC) {
            Some(Transform::skew(
                Angle::from_degrees(14.0),
                Angle::from_degrees(0.0),
            ))
        } else {
            None
        })
        .render(&mut scaler, cache_key.glyph_id)
    }

    // ------------------------------------------------------------------
    // Font metrics (unchanged — already uses swash directly)
    // ------------------------------------------------------------------

    fn measure_font_box_metrics(
        &mut self,
        font_id: fontdb::ID,
        font_size: f32,
        weight: u16,
        axes: &[AxisSetting],
        axes_hash: u64,
    ) -> Option<(f32, f32, f32)> {
        if !font_size.is_finite() || font_size <= 0.0 {
            return None;
        }

        // Check metrics cache
        let metrics_key = FontMetricsKey {
            font_id,
            font_size_bits: font_size.to_bits(),
            weight,
            axes_hash,
        };
        if let Some(cached) = self.font_metrics_cache.get(&metrics_key) {
            return Some(*cached);
        }

        // Ensure font data is cached
        self.ensure_font_data_cached(font_id);

        let result = if let Some((font_data, face_index)) = self.font_data_cache.get(&font_id) {
            let font_data = font_data.as_slice();
            let face_index = *face_index;

            if let Some(font_ref) = swash::FontRef::from_index(font_data, face_index as usize) {
                let variations = font_ref.variations();
                let mut settings = Vec::<swash::Setting<f32>>::new();
                let mut has_wght = false;
                let mut has_opsz = false;

                for axis in axes {
                    let tag = swash::Tag::from_be_bytes(axis.tag);
                    let Some(var_axis) = variations.find_by_tag(tag) else {
                        continue;
                    };
                    let value = axis.value.clamp(var_axis.min_value(), var_axis.max_value());
                    settings.push((tag, value).into());
                    if axis.tag == *b"wght" {
                        has_wght = true;
                    } else if axis.tag == *b"opsz" {
                        has_opsz = true;
                    }
                }

                if !has_wght {
                    let wght_tag = swash::Tag::from_be_bytes(*b"wght");
                    if let Some(var_axis) = variations.find_by_tag(wght_tag) {
                        let value =
                            f32::from(weight).clamp(var_axis.min_value(), var_axis.max_value());
                        settings.push((wght_tag, value).into());
                    }
                }

                if !has_opsz {
                    let opsz_tag = swash::Tag::from_be_bytes(*b"opsz");
                    if let Some(var_axis) = variations.find_by_tag(opsz_tag) {
                        let value = font_size.clamp(var_axis.min_value(), var_axis.max_value());
                        settings.push((opsz_tag, value).into());
                    }
                }

                let coords: Vec<swash::NormalizedCoord> = variations
                    .normalized_coords(settings.iter().copied())
                    .collect();
                let metrics = font_ref.metrics(&coords);

                let units_per_em = f32::from(metrics.units_per_em.max(1));
                let ascent = (metrics.ascent / units_per_em) * font_size;
                let raw_descent = (metrics.descent / units_per_em) * font_size;
                let descent = if raw_descent.is_sign_negative() {
                    -raw_descent
                } else {
                    raw_descent
                };
                let cap_height = (metrics.cap_height / units_per_em) * font_size;
                let cap_height = if cap_height.is_finite() && cap_height > 0.0 {
                    cap_height
                } else {
                    ascent
                };

                Some((ascent.max(0.0), descent.max(0.0), cap_height.max(0.0)))
            } else {
                None
            }
        } else {
            None
        };

        if let Some(metrics) = result {
            self.font_metrics_cache.insert(metrics_key, metrics);
        }
        result
    }

    // ------------------------------------------------------------------
    // Glyph outline x-bounds (unchanged — already uses swash directly)
    // ------------------------------------------------------------------

    fn measure_glyph_outline_x_bounds(
        &self,
        scale_context: &mut swash::scale::ScaleContext,
        font_id: fontdb::ID,
        glyph_id: u16,
        font_size: f32,
        weight: u16,
        axes: &[AxisSetting],
    ) -> Option<(f32, f32)> {
        if !font_size.is_finite() || font_size <= 0.0 {
            return None;
        }

        // Use font data cache if available, fall back to db.with_face_data
        let (font_data_ref, face_index) = if let Some((data, idx)) = self.font_data_cache.get(&font_id) {
            (data.as_slice(), *idx as usize)
        } else {
            // Should not happen in normal flow since ensure_font_data_cached is called earlier,
            // but fall back to db query for safety
            return self.db
                .with_face_data(font_id, |font_data, face_index| {
                    Self::measure_outline_x_bounds_inner(
                        scale_context, font_data, face_index as usize, glyph_id,
                        font_size, weight, axes,
                    )
                })
                .flatten();
        };

        Self::measure_outline_x_bounds_inner(
            scale_context, font_data_ref, face_index, glyph_id,
            font_size, weight, axes,
        )
    }

    fn measure_outline_x_bounds_inner(
        scale_context: &mut swash::scale::ScaleContext,
        font_data: &[u8],
        face_index: usize,
        glyph_id: u16,
        font_size: f32,
        weight: u16,
        axes: &[AxisSetting],
    ) -> Option<(f32, f32)> {
        let font_ref = swash::FontRef::from_index(font_data, face_index)?;
        let variations = font_ref.variations();
        let mut settings = Vec::<swash::Setting<f32>>::new();
        let mut has_wght = false;
        let mut has_opsz = false;

        for axis in axes {
            let tag = swash::Tag::from_be_bytes(axis.tag);
            let Some(var_axis) = variations.find_by_tag(tag) else {
                continue;
            };
            let value = axis.value.clamp(var_axis.min_value(), var_axis.max_value());
            settings.push((tag, value).into());
            if axis.tag == *b"wght" {
                has_wght = true;
            } else if axis.tag == *b"opsz" {
                has_opsz = true;
            }
        }

        if !has_wght {
            let wght_tag = swash::Tag::from_be_bytes(*b"wght");
            if let Some(var_axis) = variations.find_by_tag(wght_tag) {
                let value =
                    f32::from(weight).clamp(var_axis.min_value(), var_axis.max_value());
                settings.push((wght_tag, value).into());
            }
        }

        if !has_opsz {
            let opsz_tag = swash::Tag::from_be_bytes(*b"opsz");
            if let Some(var_axis) = variations.find_by_tag(opsz_tag) {
                let value = font_size.clamp(var_axis.min_value(), var_axis.max_value());
                settings.push((opsz_tag, value).into());
            }
        }

        let mut scaler = scale_context.builder(font_ref).size(font_size).hint(false);
        if !settings.is_empty() {
            scaler = scaler.variations(settings.into_iter());
        }
        let mut scaler = scaler.build();

        let outline = scaler.scale_outline(glyph_id)?;
        let points = outline.points();
        let mut point_i = 0usize;
        let mut min_x = f32::INFINITY;
        let mut max_x = f32::NEG_INFINITY;
        let mut current = None::<swash::zeno::Point>;
        let mut contour_start = None::<swash::zeno::Point>;
        let mut include_x = |x: f32| {
            min_x = min_x.min(x);
            max_x = max_x.max(x);
        };

        let quad_x = |p0: f32, p1: f32, p2: f32, t: f32| {
            let omt = 1.0 - t;
            omt * omt * p0 + 2.0 * omt * t * p1 + t * t * p2
        };
        let cubic_x = |p0: f32, p1: f32, p2: f32, p3: f32, t: f32| {
            let omt = 1.0 - t;
            omt * omt * omt * p0
                + 3.0 * omt * omt * t * p1
                + 3.0 * omt * t * t * p2
                + t * t * t * p3
        };
        for verb in outline.verbs() {
            match verb {
                Verb::MoveTo => {
                    let Some(point) = points.get(point_i).copied() else {
                        break;
                    };
                    point_i += 1;
                    include_x(point.x);
                    current = Some(point);
                    contour_start = Some(point);
                }
                Verb::LineTo => {
                    let Some(end) = points.get(point_i).copied() else {
                        break;
                    };
                    point_i += 1;
                    if let Some(start) = current {
                        include_x(start.x);
                    }
                    include_x(end.x);
                    current = Some(end);
                }
                Verb::QuadTo => {
                    let Some(ctrl) = points.get(point_i).copied() else {
                        break;
                    };
                    let Some(end) = points.get(point_i + 1).copied() else {
                        break;
                    };
                    point_i += 2;
                    if let Some(start) = current {
                        include_x(start.x);
                        include_x(end.x);
                        let denom = start.x - 2.0 * ctrl.x + end.x;
                        if denom.abs() > 1e-6 {
                            let t = (start.x - ctrl.x) / denom;
                            if t.is_finite() && t > 0.0 && t < 1.0 {
                                include_x(quad_x(start.x, ctrl.x, end.x, t));
                            }
                        }
                    } else {
                        include_x(ctrl.x);
                        include_x(end.x);
                    }
                    current = Some(end);
                }
                Verb::CurveTo => {
                    let Some(ctrl1) = points.get(point_i).copied() else {
                        break;
                    };
                    let Some(ctrl2) = points.get(point_i + 1).copied() else {
                        break;
                    };
                    let Some(end) = points.get(point_i + 2).copied() else {
                        break;
                    };
                    point_i += 3;
                    if let Some(start) = current {
                        include_x(start.x);
                        include_x(end.x);

                        let a = -start.x + 3.0 * ctrl1.x - 3.0 * ctrl2.x + end.x;
                        let b = 3.0 * start.x - 6.0 * ctrl1.x + 3.0 * ctrl2.x;
                        let c = -3.0 * start.x + 3.0 * ctrl1.x;
                        let qa = 3.0 * a;
                        let qb = 2.0 * b;
                        let qc = c;
                        if qa.abs() <= 1e-6 {
                            if qb.abs() > 1e-6 {
                                let t = -qc / qb;
                                if t.is_finite() && t > 0.0 && t < 1.0 {
                                    include_x(cubic_x(
                                        start.x, ctrl1.x, ctrl2.x, end.x, t,
                                    ));
                                }
                            }
                        } else {
                            let disc = qb * qb - 4.0 * qa * qc;
                            if disc >= 0.0 {
                                let sqrt_disc = disc.sqrt();
                                let denom = 2.0 * qa;
                                let t0 = (-qb - sqrt_disc) / denom;
                                if t0.is_finite() && t0 > 0.0 && t0 < 1.0 {
                                    include_x(cubic_x(
                                        start.x, ctrl1.x, ctrl2.x, end.x, t0,
                                    ));
                                }
                                let t1 = (-qb + sqrt_disc) / denom;
                                if t1.is_finite() && t1 > 0.0 && t1 < 1.0 {
                                    include_x(cubic_x(
                                        start.x, ctrl1.x, ctrl2.x, end.x, t1,
                                    ));
                                }
                            }
                        }
                    } else {
                        include_x(ctrl1.x);
                        include_x(ctrl2.x);
                        include_x(end.x);
                    }
                    current = Some(end);
                }
                Verb::Close => {
                    if let (Some(start), Some(end)) = (current, contour_start) {
                        include_x(start.x);
                        include_x(end.x);
                    }
                    current = contour_start;
                }
            }
        }
        if !min_x.is_finite() || !max_x.is_finite() || max_x <= min_x {
            return None;
        }
        Some((min_x, max_x))
    }
}

// ---------------------------------------------------------------------------
// Free functions
// ---------------------------------------------------------------------------

/// Split text into alternating (text, is_whitespace) segments.
fn split_into_segments(text: &str) -> Vec<(String, bool)> {
    let mut segments = Vec::new();
    if text.is_empty() {
        return segments;
    }

    let mut chars = text.chars().peekable();
    while chars.peek().is_some() {
        let is_ws = chars.peek().unwrap().is_whitespace();
        let mut seg = String::new();
        while let Some(&ch) = chars.peek() {
            if ch.is_whitespace() == is_ws {
                seg.push(ch);
                chars.next();
            } else {
                break;
            }
        }
        segments.push((seg, is_ws));
    }
    segments
}

fn parse_axes(json: &str, quantization: f32) -> Vec<AxisSetting> {
    if json.trim().is_empty() {
        return Vec::new();
    }

    let parsed = serde_json::from_str::<Value>(json).unwrap_or(Value::Null);
    let mut out = Vec::<AxisSetting>::new();

    if let Value::Object(map) = parsed {
        for (tag, value) in map {
            if tag.len() != 4 {
                continue;
            }

            let Some(raw_value) = value.as_f64() else {
                continue;
            };
            let mut val = raw_value as f32;
            if !val.is_finite() {
                continue;
            }

            if quantization.is_finite() && quantization > 0.0 {
                val = (val / quantization).round() * quantization;
            }

            let mut bytes = [0u8; 4];
            bytes.copy_from_slice(tag.as_bytes());
            out.push(AxisSetting {
                tag: bytes,
                value: val,
            });
        }
    }

    out.sort_by_key(|axis| axis.tag);
    out
}

fn hash_axes(axes: &[AxisSetting]) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    for axis in axes {
        axis.tag.hash(&mut hasher);
        axis.value.to_bits().hash(&mut hasher);
    }
    hasher.finish()
}

fn hash_glyph_key(cache_key: &CacheKey, axes_hash: u64) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    cache_key.hash(&mut hasher);
    axes_hash.hash(&mut hasher);
    hasher.finish()
}

fn swash_image_to_mask(image: &swash::scale::image::Image) -> RasterizedMask {
    let width = image.placement.width;
    let height = image.placement.height;
    let pixel_count = width as usize * height as usize;

    let mut data = vec![0u8; pixel_count];
    let content_type = match image.content {
        swash::scale::image::Content::Mask => {
            let len = pixel_count.min(image.data.len());
            data[..len].copy_from_slice(&image.data[..len]);
            0
        }
        swash::scale::image::Content::Color => {
            for i in 0..pixel_count {
                data[i] = image.data.get(i * 4 + 3).copied().unwrap_or(0);
            }
            1
        }
        swash::scale::image::Content::SubpixelMask => {
            for i in 0..pixel_count {
                let base = i * 3;
                let r = image.data.get(base).copied().unwrap_or(0);
                let g = image.data.get(base + 1).copied().unwrap_or(0);
                let b = image.data.get(base + 2).copied().unwrap_or(0);
                data[i] = ((u16::from(r) + u16::from(g) + u16::from(b)) / 3) as u8;
            }
            2
        }
    };

    RasterizedMask {
        width,
        height,
        left: image.placement.left,
        top: image.placement.top,
        content_type,
        data,
    }
}

unsafe fn read_string(ptr: *const u8, len: u32) -> Option<String> {
    if len == 0 {
        return Some(String::new());
    }
    if ptr.is_null() {
        return None;
    }

    let slice = std::slice::from_raw_parts(ptr, len as usize);
    std::str::from_utf8(slice).ok().map(|s| s.to_string())
}

fn write_bytes(bytes: &[u8], out_ptr: *mut u8, out_cap: u32) -> u32 {
    let needed = bytes.len() as u32;
    if out_ptr.is_null() || out_cap == 0 {
        return needed;
    }
    if out_cap < needed {
        return needed;
    }

    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), out_ptr, bytes.len());
    }
    needed
}

unsafe fn write_u32(ptr: *mut u32, value: u32) {
    if !ptr.is_null() {
        *ptr = value;
    }
}

unsafe fn write_i32(ptr: *mut i32, value: i32) {
    if !ptr.is_null() {
        *ptr = value;
    }
}

// ---------------------------------------------------------------------------
// FFI exports (unchanged signatures)
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn text_engine_create() -> *mut TextEngine {
    Box::into_raw(Box::new(TextEngine::new()))
}

#[no_mangle]
pub unsafe extern "C" fn text_engine_destroy(engine: *mut TextEngine) {
    if engine.is_null() {
        return;
    }
    drop(Box::from_raw(engine));
}

#[no_mangle]
pub unsafe extern "C" fn text_engine_load_font_file(
    engine: *mut TextEngine,
    path_ptr: *const u8,
    path_len: u32,
) -> u32 {
    let Some(engine) = engine.as_mut() else {
        return 0;
    };

    let Some(path) = read_string(path_ptr, path_len) else {
        return 0;
    };

    if engine.load_font_file(&path) {
        1
    } else {
        0
    }
}

#[no_mangle]
pub unsafe extern "C" fn text_engine_load_font_bytes(
    engine: *mut TextEngine,
    data_ptr: *const u8,
    data_len: u32,
) -> u32 {
    let Some(engine) = engine.as_mut() else {
        return 0;
    };

    if data_len == 0 || data_ptr.is_null() {
        return 0;
    }

    let bytes = std::slice::from_raw_parts(data_ptr, data_len as usize);
    engine.load_font_bytes(bytes);
    1
}

#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn text_engine_layout_json(
    engine: *mut TextEngine,
    text_ptr: *const u8,
    text_len: u32,
    family_ptr: *const u8,
    family_len: u32,
    font_size: f32,
    line_height: f32,
    width: f32,
    height: f32,
    align_h: u32,
    wrap_mode: u32,
    weight: u16,
    style: u32,
    axis_quantization: f32,
    axes_json_ptr: *const u8,
    axes_json_len: u32,
    out_ptr: *mut u8,
    out_cap: u32,
) -> u32 {
    let Some(engine) = engine.as_mut() else {
        return 0;
    };

    let Some(text) = read_string(text_ptr, text_len) else {
        return 0;
    };
    let Some(family) = read_string(family_ptr, family_len) else {
        return 0;
    };
    let Some(axes_json) = read_string(axes_json_ptr, axes_json_len) else {
        return 0;
    };

    let binary = engine.layout_to_binary(
        &text,
        &family,
        font_size,
        line_height,
        width,
        height,
        align_h,
        wrap_mode,
        weight,
        style,
        axis_quantization,
        &axes_json,
    );

    write_bytes(&binary, out_ptr, out_cap)
}

#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn text_engine_rasterize_glyph(
    engine: *mut TextEngine,
    key: u64,
    out_ptr: *mut u8,
    out_cap: u32,
    out_width: *mut u32,
    out_height: *mut u32,
    out_left: *mut i32,
    out_top: *mut i32,
    out_content_type: *mut u32,
) -> u32 {
    let Some(engine) = engine.as_mut() else {
        return 0;
    };

    write_u32(out_width, 0);
    write_u32(out_height, 0);
    write_i32(out_left, 0);
    write_i32(out_top, 0);
    write_u32(out_content_type, 0);

    let Some(mask) = engine.rasterize_mask_for_key(key) else {
        return 0;
    };

    write_u32(out_width, mask.width);
    write_u32(out_height, mask.height);
    write_i32(out_left, mask.left);
    write_i32(out_top, mask.top);
    write_u32(out_content_type, mask.content_type);

    write_bytes(&mask.data, out_ptr, out_cap)
}


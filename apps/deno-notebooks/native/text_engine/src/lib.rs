use cosmic_text::fontdb;
use cosmic_text::harfrust;
use cosmic_text::{
    Align, Attrs, Buffer, CacheKey, CacheKeyFlags, Family, FontSystem, Metrics, Shaping, Style,
    SwashCache, SwashContent, SwashImage, Weight, Wrap,
};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use swash::scale::{Render, Source, StrikeWith};
use swash::zeno::{Angle, Format, Transform, Vector, Verb};

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

#[derive(Serialize)]
struct LayoutGlyphOut {
    key: String,
    x: i32,
    y: i32,
}

#[derive(Serialize)]
struct LayoutResponse {
    glyphs: Vec<LayoutGlyphOut>,
    tight_width: f32,
    font_width: f32,
    ascent: f32,
    descent: f32,
    font_ascent: f32,
    font_descent: f32,
    font_cap_height: f32,
    first_baseline: f32,
    total_height: f32,
    line_count: usize,
}

pub struct TextEngine {
    font_system: FontSystem,
    buffer: Buffer,
    swash_cache: SwashCache,
    scale_context: swash::scale::ScaleContext,
    outline_scale_context: swash::scale::ScaleContext,
    outline_bounds_cache: HashMap<GlyphOutlineBoundsKey, Option<(f32, f32)>>,
    glyph_records: HashMap<u64, GlyphRasterRecord>,
    axis_image_cache: HashMap<u64, RasterizedMask>,
}

impl TextEngine {
    fn new() -> Self {
        // Keep this engine deterministic by only using fonts explicitly loaded
        // through our API (bundled Noto + user-loaded fonts), instead of the
        // host system font set.
        let db = fontdb::Database::new();
        let mut font_system = FontSystem::new_with_locale_and_db(String::from("en-US"), db);
        let metrics = Metrics::new(12.0, 12.0 * 1.275);
        let buffer = Buffer::new(&mut font_system, metrics);

        Self {
            font_system,
            buffer,
            swash_cache: SwashCache::new(),
            scale_context: swash::scale::ScaleContext::new(),
            outline_scale_context: swash::scale::ScaleContext::new(),
            outline_bounds_cache: HashMap::new(),
            glyph_records: HashMap::new(),
            axis_image_cache: HashMap::new(),
        }
    }

    fn load_font_file(&mut self, path: &str) -> bool {
        self.font_system.db_mut().load_font_file(path).is_ok()
    }

    fn load_font_bytes(&mut self, bytes: &[u8]) {
        let data: Arc<Vec<u8>> = Arc::new(bytes.to_vec());
        let source: Arc<dyn AsRef<[u8]> + Send + Sync> = data;
        self.font_system
            .db_mut()
            .load_font_source(fontdb::Source::Binary(source));
    }

    #[allow(clippy::too_many_arguments)]
    fn layout_to_json(
        &mut self,
        text: &str,
        family: &str,
        font_size: f32,
        line_height: f32,
        width: f32,
        height: f32,
        align_h: u32,
        wrap_mode: u32,
        weight: u16,
        style: u32,
        axis_quantization: f32,
        axes_json: &str,
    ) -> String {
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

        let width_opt = if width.is_finite() && width > 0.0 {
            Some(width)
        } else {
            None
        };
        let height_opt = if height.is_finite() && height > 0.0 {
            Some(height)
        } else {
            None
        };

        self.buffer.set_metrics_and_size(
            &mut self.font_system,
            Metrics::new(size, leading),
            width_opt,
            height_opt,
        );
        self.buffer
            .set_wrap(&mut self.font_system, wrap_from_code(wrap_mode));

        let align = Some(match align_h {
            1 => Align::Center,
            2 => Align::Right,
            _ => Align::Left,
        });

        let family = if family.trim().is_empty() {
            Family::SansSerif
        } else {
            Family::Name(family)
        };

        let attrs = Attrs::new()
            .family(family)
            .weight(Weight(weight.clamp(1, 1000)))
            .style(style_from_code(style));

        self.buffer.set_text(
            &mut self.font_system,
            text,
            &attrs,
            Shaping::Advanced,
            align,
        );
        self.buffer.shape_until_scroll(&mut self.font_system, true);

        let axes = parse_axes(axes_json, axis_quantization);
        let axes_hash = hash_axes(&axes);
        let axes_arc = Arc::new(axes);

        let mut line_count = 0usize;
        let mut glyphs = Vec::<LayoutGlyphOut>::new();
        let mut pending_records = Vec::<(u64, GlyphRasterRecord)>::new();

        let mut first_line_top = 0.0f32;
        let mut first_baseline = 0.0f32;
        let mut have_first_line = false;

        let mut total_height = 0.0f32;
        let mut font_width = 0.0f32;
        let mut tight_width = 0.0f32;
        let mut font_ascent = 0.0f32;
        let mut font_descent = 0.0f32;
        let mut font_cap_height = 0.0f32;
        let mut have_font_metrics = false;
        // Take the outline scale context and bounds cache out of self to avoid
        // borrow conflicts with self.measure_glyph_outline_x_bounds().
        let mut outline_scale_context = std::mem::replace(
            &mut self.outline_scale_context,
            swash::scale::ScaleContext::new(),
        );
        let mut outline_bounds_cache = std::mem::take(&mut self.outline_bounds_cache);

        for run in self.buffer.layout_runs() {
            line_count += 1;

            if !have_first_line {
                first_line_top = run.line_top;
                first_baseline = run.line_y;
                have_first_line = true;
            }

            if !have_font_metrics {
                if let Some(first) = run.glyphs.first() {
                    if let Some((fa, fd, fcap)) = self.measure_font_box_metrics(
                        first.font_id,
                        first.font_size,
                        first.font_weight.0,
                        &axes_arc,
                    ) {
                        font_ascent = fa;
                        font_descent = fd;
                        font_cap_height = fcap;
                        have_font_metrics = true;
                    }
                }
            }

            total_height = total_height.max(run.line_top + run.line_height - first_line_top);

            let mut line_min_x = f32::INFINITY;
            let mut line_max_x = f32::NEG_INFINITY;
            let mut run_start = usize::MAX;
            let mut run_end = 0usize;

            for glyph in run.glyphs {
                line_min_x = line_min_x.min(glyph.x);
                line_max_x = line_max_x.max(glyph.x + glyph.w);
                run_start = run_start.min(glyph.start);
                run_end = run_end.max(glyph.end);
            }

            let mut run_x_scale = 1.0f32;
            let run_ink_width = (line_max_x - line_min_x).max(0.0);
            let run_advance_width = run.line_w.max(0.0);
            let run_scale_denom = if run_advance_width > 0.0 {
                run_advance_width
            } else {
                run_ink_width
            };
            if run_scale_denom > 0.0
                && run_start < run_end
                && run_end <= run.text.len()
                && run
                    .glyphs
                    .first()
                    .map(|first| {
                        run.glyphs.iter().all(|g| {
                            g.font_id == first.font_id
                                && g.font_size.to_bits() == first.font_size.to_bits()
                                && g.font_weight == first.font_weight
                        })
                    })
                    .unwrap_or(false)
            {
                let first = &run.glyphs[0];
                if self.run_requires_axis_advance_adjustment(first.font_id, &axes_arc) {
                    let run_text = &run.text[run_start..run_end];
                    if let Some(measured_width) = self.measure_advance_with_axes(
                        first.font_id,
                        run_text,
                        run.rtl,
                        first.font_size,
                        first.font_weight.0,
                        &axes_arc,
                    ) {
                        let ratio = measured_width / run_scale_denom;
                        if ratio.is_finite() && ratio > 0.0 {
                            run_x_scale = ratio.clamp(0.5, 1.5);
                        }
                    }
                }
            }

            font_width = font_width.max(run.line_w * run_x_scale);
            let run_origin_x = line_min_x;

            line_min_x = f32::INFINITY;
            line_max_x = f32::NEG_INFINITY;
            let mut line_ink_min_x = f32::INFINITY;
            let mut line_ink_max_x = f32::NEG_INFINITY;

            for glyph in run.glyphs {
                let scaled_x = if (run_x_scale - 1.0).abs() > 0.001 {
                    run_origin_x + (glyph.x - run_origin_x) * run_x_scale
                } else {
                    glyph.x
                };
                let scaled_w = if (run_x_scale - 1.0).abs() > 0.001 {
                    glyph.w * run_x_scale
                } else {
                    glyph.w
                };
                line_min_x = line_min_x.min(scaled_x);
                line_max_x = line_max_x.max(scaled_x + scaled_w);

                let outline_key = GlyphOutlineBoundsKey {
                    font_id: glyph.font_id,
                    glyph_id: glyph.glyph_id,
                    font_size_bits: glyph.font_size.to_bits(),
                    font_weight: glyph.font_weight.0,
                    axes_hash,
                };
                let outline_bounds = if let Some(cached) = outline_bounds_cache.get(&outline_key) {
                    *cached
                } else {
                    let measured = self.measure_glyph_outline_x_bounds(
                        &mut outline_scale_context,
                        glyph.font_id,
                        glyph.glyph_id,
                        glyph.font_size,
                        glyph.font_weight.0,
                        axes_arc.as_slice(),
                    );
                    outline_bounds_cache.insert(outline_key, measured);
                    measured
                };
                if let Some((outline_min_x, outline_max_x)) = outline_bounds {
                    let x_offset = glyph.font_size * glyph.x_offset;
                    line_ink_min_x = line_ink_min_x.min(scaled_x + x_offset + outline_min_x);
                    line_ink_max_x = line_ink_max_x.max(scaled_x + x_offset + outline_max_x);
                }

                let physical = if (run_x_scale - 1.0).abs() > 0.001 {
                    physical_with_x(glyph, run.line_y, scaled_x)
                } else {
                    glyph.physical((0.0, run.line_y), 1.0)
                };
                let key = hash_glyph_key(&physical.cache_key, axes_hash);
                glyphs.push(LayoutGlyphOut {
                    key: format!("{key:016x}"),
                    x: physical.x,
                    y: physical.y,
                });
                pending_records.push((
                    key,
                    GlyphRasterRecord {
                        cache_key: physical.cache_key,
                        axes: Arc::clone(&axes_arc),
                    },
                ));
            }

            if line_ink_min_x.is_finite() && line_ink_max_x.is_finite() {
                tight_width = tight_width.max((line_ink_max_x - line_ink_min_x).max(0.0));
            } else if line_min_x.is_finite() && line_max_x.is_finite() {
                tight_width = tight_width.max((line_max_x - line_min_x).max(0.0));
            }
        }

        // Put the outline scale context and bounds cache back into self.
        self.outline_scale_context = outline_scale_context;
        self.outline_bounds_cache = outline_bounds_cache;

        self.glyph_records.clear();
        for (key, record) in pending_records {
            self.glyph_records.insert(key, record);
        }
        self.axis_image_cache
            .retain(|key, _| self.glyph_records.contains_key(key));

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

        if !have_font_metrics {
            font_ascent = ascent;
            font_descent = descent;
            font_cap_height = ascent;
        }

        let response = LayoutResponse {
            glyphs,
            tight_width,
            font_width,
            ascent,
            descent,
            font_ascent,
            font_descent,
            font_cap_height,
            first_baseline,
            total_height: if total_height > 0.0 {
                total_height
            } else {
                leading
            },
            line_count,
        };

        serde_json::to_string(&response).unwrap_or_else(|_| {
            "{\"glyphs\":[],\"tight_width\":0,\"font_width\":0,\"ascent\":0,\"descent\":0,\"first_baseline\":0,\"total_height\":0,\"line_count\":0}".to_string()
        })
    }

    fn rasterize_mask_for_key(&mut self, key: u64) -> Option<RasterizedMask> {
        if let Some(existing) = self.axis_image_cache.get(&key) {
            return Some(existing.clone());
        }

        let record = self.glyph_records.get(&key)?.clone();

        let image_opt = if record.axes.is_empty() {
            self.swash_cache
                .get_image(&mut self.font_system, record.cache_key)
                .clone()
        } else {
            self.rasterize_with_axes(record.cache_key, record.axes.as_slice())
        };

        let image = image_opt?;
        let mask = swash_to_mask(&image);
        self.axis_image_cache.insert(key, mask.clone());
        Some(mask)
    }

    fn rasterize_with_axes(
        &mut self,
        cache_key: CacheKey,
        axes: &[AxisSetting],
    ) -> Option<SwashImage> {
        let font = self
            .font_system
            .get_font(cache_key.font_id, cache_key.font_weight)?;

        let font_ref = font.as_swash();
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
                    value: f32::from(cache_key.font_weight.0)
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

    fn run_requires_axis_advance_adjustment(
        &self,
        font_id: fontdb::ID,
        axes: &[AxisSetting],
    ) -> bool {
        if axes.iter().any(|axis| axis.tag != *b"wght") {
            return true;
        }

        self.font_has_axis(font_id, *b"opsz")
    }

    fn font_has_axis(&self, font_id: fontdb::ID, axis_tag: [u8; 4]) -> bool {
        self.font_system
            .db()
            .with_face_data(font_id, |font_data, face_index| {
                let swash_ref = swash::FontRef::from_index(font_data, face_index as usize)?;
                let tag = swash::Tag::from_be_bytes(axis_tag);
                Some(swash_ref.variations().find_by_tag(tag).is_some())
            })
            .flatten()
            .unwrap_or(false)
    }

    fn measure_advance_with_axes(
        &self,
        font_id: fontdb::ID,
        text: &str,
        rtl: bool,
        font_size: f32,
        weight: u16,
        axes: &[AxisSetting],
    ) -> Option<f32> {
        if text.is_empty() || !font_size.is_finite() || font_size <= 0.0 {
            return Some(0.0);
        }

        self.font_system
            .db()
            .with_face_data(font_id, |font_data, face_index| {
                let font_ref = harfrust::FontRef::from_index(font_data, face_index).ok()?;
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
                if rtl {
                    buffer.set_direction(harfrust::Direction::RightToLeft);
                } else {
                    buffer.set_direction(harfrust::Direction::LeftToRight);
                }
                buffer.guess_segment_properties();

                let glyph_buffer = shaper.shape(buffer, &[]);
                let advance_units = glyph_buffer
                    .glyph_positions()
                    .iter()
                    .map(|pos| pos.x_advance as f32)
                    .sum::<f32>();
                let upem = shaper.units_per_em().max(1) as f32;
                Some((advance_units / upem) * font_size)
            })
            .flatten()
    }

    fn measure_font_box_metrics(
        &self,
        font_id: fontdb::ID,
        font_size: f32,
        weight: u16,
        axes: &[AxisSetting],
    ) -> Option<(f32, f32, f32)> {
        if !font_size.is_finite() || font_size <= 0.0 {
            return None;
        }

        self.font_system
            .db()
            .with_face_data(font_id, |font_data, face_index| {
                let font_ref = swash::FontRef::from_index(font_data, face_index as usize)?;
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
                // Swash descent sign can vary by API path; normalize to positive-down.
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
            })
            .flatten()
    }

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

        self.font_system
            .db()
            .with_face_data(font_id, |font_data, face_index| {
                let font_ref = swash::FontRef::from_index(font_data, face_index as usize)?;
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

                                // x'(t) for cubic Bezier is quadratic: qa*t^2 + qb*t + qc = 0
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
            })
            .flatten()
    }
}

fn physical_with_x(
    glyph: &cosmic_text::LayoutGlyph,
    line_y: f32,
    x: f32,
) -> cosmic_text::PhysicalGlyph {
    let x_offset = glyph.font_size * glyph.x_offset;
    let y_offset = glyph.font_size * glyph.y_offset;

    let (cache_key, px, py) = CacheKey::new(
        glyph.font_id,
        glyph.glyph_id,
        glyph.font_size,
        (x + x_offset, (glyph.y - y_offset + line_y).trunc()),
        glyph.font_weight,
        glyph.cache_key_flags,
    );

    cosmic_text::PhysicalGlyph {
        cache_key,
        x: px,
        y: py,
    }
}

fn style_from_code(code: u32) -> Style {
    match code {
        1 => Style::Italic,
        2 => Style::Oblique,
        _ => Style::Normal,
    }
}

fn wrap_from_code(code: u32) -> Wrap {
    match code {
        1 => Wrap::Glyph,
        2 => Wrap::None,
        _ => Wrap::Word,
    }
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

fn swash_to_mask(image: &SwashImage) -> RasterizedMask {
    let width = image.placement.width;
    let height = image.placement.height;
    let pixel_count = width as usize * height as usize;

    let mut data = vec![0u8; pixel_count];
    let content_type = match image.content {
        SwashContent::Mask => {
            let len = pixel_count.min(image.data.len());
            data[..len].copy_from_slice(&image.data[..len]);
            0
        }
        SwashContent::Color => {
            for i in 0..pixel_count {
                data[i] = image.data.get(i * 4 + 3).copied().unwrap_or(0);
            }
            1
        }
        SwashContent::SubpixelMask => {
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

    let json = engine.layout_to_json(
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

    write_bytes(json.as_bytes(), out_ptr, out_cap)
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

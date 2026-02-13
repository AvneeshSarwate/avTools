use cosmic_text::fontdb;
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
use swash::zeno::{Angle, Format, Transform, Vector};

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
    first_baseline: f32,
    total_height: f32,
    line_count: usize,
}

pub struct TextEngine {
    font_system: FontSystem,
    buffer: Buffer,
    swash_cache: SwashCache,
    scale_context: swash::scale::ScaleContext,
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

        let mut attrs = Attrs::new()
            .family(family)
            .weight(Weight(weight.clamp(1, 1000)))
            .style(style_from_code(style));

        // Preserve existing fake-italic behavior through cache-key flags for consistency.
        if matches!(style_from_code(style), Style::Italic | Style::Oblique) {
            attrs = attrs.cache_key_flags(CacheKeyFlags::FAKE_ITALIC);
        }

        self.buffer
            .set_text(&mut self.font_system, text, &attrs, Shaping::Advanced, align);
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

        for run in self.buffer.layout_runs() {
            line_count += 1;

            if !have_first_line {
                first_line_top = run.line_top;
                first_baseline = run.line_y;
                have_first_line = true;
            }

            total_height = total_height.max(run.line_top + run.line_height - first_line_top);
            font_width = font_width.max(run.line_w);

            let mut line_min_x = f32::INFINITY;
            let mut line_max_x = f32::NEG_INFINITY;

            for glyph in run.glyphs {
                line_min_x = line_min_x.min(glyph.x);
                line_max_x = line_max_x.max(glyph.x + glyph.w);

                let physical = glyph.physical((0.0, run.line_y), 1.0);
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

            if line_min_x.is_finite() && line_max_x.is_finite() {
                tight_width = tight_width.max((line_max_x - line_min_x).max(0.0));
            }
        }

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

        let response = LayoutResponse {
            glyphs,
            tight_width,
            font_width,
            ascent,
            descent,
            first_baseline,
            total_height: if total_height > 0.0 { total_height } else { leading },
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

    if engine.load_font_file(&path) { 1 } else { 0 }
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

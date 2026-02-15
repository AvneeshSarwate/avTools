use cosmic_text::harfrust;
use cosmic_text::{fontdb, Align, Attrs, Buffer, Family, FontSystem, Metrics, Shaping, Style, Weight, Wrap};
use std::path::PathBuf;

fn main() {
    let font_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("assets")
        .join("fonts")
        .join("InterVariable.ttf");
    let data = std::fs::read(&font_path).expect("read InterVariable.ttf");

    let hfont = harfrust::FontRef::from_index(&data, 0).expect("harfrust font");
    let shaper_data = harfrust::ShaperData::new(&hfont);
    let instance = harfrust::ShaperInstance::from_variations(
        &hfont,
        [
            harfrust::Variation {
                tag: harfrust::Tag::new(b"wght"),
                value: 400.0,
            },
            harfrust::Variation {
                tag: harfrust::Tag::new(b"opsz"),
                value: 40.0,
            },
        ],
    );
    let shaper = shaper_data
        .shaper(&hfont)
        .instance(Some(&instance))
        .point_size(Some(40.0))
        .build();

    let mut buffer = harfrust::UnicodeBuffer::new();
    buffer.push_str("M");
    buffer.set_direction(harfrust::Direction::LeftToRight);
    buffer.guess_segment_properties();
    let glyph_buffer = shaper.shape(buffer, &[]);

    let infos = glyph_buffer.glyph_infos();
    let positions = glyph_buffer.glyph_positions();
    let upem = shaper.units_per_em().max(1) as f32;
    println!("upem={upem}");
    println!(
        "glyph_count={} gid={} x_adv={} x_off={}",
        infos.len(),
        infos.first().map(|g| g.glyph_id).unwrap_or_default(),
        positions.first().map(|p| p.x_advance).unwrap_or_default(),
        positions.first().map(|p| p.x_offset).unwrap_or_default()
    );
    let serialized = glyph_buffer.serialize(
        &shaper,
        harfrust::SerializeFlags::GLYPH_EXTENTS
            | harfrust::SerializeFlags::NO_GLYPH_NAMES
            | harfrust::SerializeFlags::NO_CLUSTERS,
    );
    println!("serialize={serialized}");
    if let (Some(info), Some(pos)) = (infos.first(), positions.first()) {
        let x_adv_px = (pos.x_advance as f32 / upem) * 40.0;
        println!("x_adv_px={x_adv_px}");
        println!("gid_u16={}", info.glyph_id as u16);
    }

    let sfont = swash::FontRef::from_index(&data, 0).expect("swash font");
    let mut settings = Vec::<swash::Setting<f32>>::new();
    let wght = swash::Tag::from_be_bytes(*b"wght");
    let opsz = swash::Tag::from_be_bytes(*b"opsz");
    if let Some(axis) = sfont.variations().find_by_tag(wght) {
        settings.push((wght, 400.0f32.clamp(axis.min_value(), axis.max_value())).into());
    }
    if let Some(axis) = sfont.variations().find_by_tag(opsz) {
        settings.push((opsz, 40.0f32.clamp(axis.min_value(), axis.max_value())).into());
    }
    let mut scale_context = swash::scale::ScaleContext::new();
    let mut scaler = scale_context
        .builder(sfont)
        .size(40.0)
        .hint(false)
        .variations(settings.into_iter())
        .build();
    if let Some(info) = infos.first() {
        let gid = info.glyph_id as u16;
        if let Some(outline) = scaler.scale_outline(gid) {
            let bounds = outline.bounds();
            let mut used_min_x = f32::INFINITY;
            let mut used_max_x = f32::NEG_INFINITY;
            let mut point_i = 0usize;
            for verb in outline.verbs() {
                let consumed = match verb {
                    swash::zeno::Verb::MoveTo | swash::zeno::Verb::LineTo => 1usize,
                    swash::zeno::Verb::QuadTo => 2usize,
                    swash::zeno::Verb::CurveTo => 3usize,
                    swash::zeno::Verb::Close => 0usize,
                };
                if consumed == 0 {
                    continue;
                }
                let end = point_i + consumed;
                if let Some(slice) = outline.points().get(point_i..end) {
                    for point in slice {
                        used_min_x = used_min_x.min(point.x);
                        used_max_x = used_max_x.max(point.x);
                    }
                }
                point_i = end;
            }
            println!(
                "outline points={} verbs={} bounds_all=({:.4},{:.4}) bounds_used=({:.4},{:.4})",
                outline.points().len(),
                outline.verbs().len(),
                bounds.min.x,
                bounds.max.x,
                used_min_x,
                used_max_x
            );
        } else {
            println!("scale_outline returned None");
        }
    }

    let arc: std::sync::Arc<dyn AsRef<[u8]> + Send + Sync> = std::sync::Arc::new(data.clone());
    let mut db = fontdb::Database::new();
    db.load_font_source(fontdb::Source::Binary(arc));
    let mut fs = FontSystem::new_with_locale_and_db(String::from("en-US"), db);
    let mut buffer = Buffer::new(&mut fs, Metrics::new(40.0, 51.0));
    buffer.set_metrics_and_size(&mut fs, Metrics::new(40.0, 51.0), None, None);
    buffer.set_wrap(&mut fs, Wrap::None);
    let attrs = Attrs::new()
        .family(Family::Name("Inter Variable"))
        .weight(Weight(400))
        .style(Style::Normal);
    buffer.set_text(&mut fs, "M", &attrs, Shaping::Advanced, Some(Align::Left));
    buffer.shape_until_scroll(&mut fs, true);

    let mut ctx = swash::scale::ScaleContext::new();
    for run in buffer.layout_runs() {
        println!("cosmic run line_w={} glyphs={}", run.line_w, run.glyphs.len());
        for glyph in run.glyphs {
            let bounds = fs
                .db()
                .with_face_data(glyph.font_id, |font_data, face_index| {
                    let sfont = swash::FontRef::from_index(font_data, face_index as usize)?;
                    let mut settings = Vec::<swash::Setting<f32>>::new();
                    if let Some(axis) = sfont.variations().find_by_tag(wght) {
                        settings
                            .push((wght, 400.0f32.clamp(axis.min_value(), axis.max_value())).into());
                    }
                    if let Some(axis) = sfont.variations().find_by_tag(opsz) {
                        settings.push(
                            (opsz, glyph.font_size.clamp(axis.min_value(), axis.max_value())).into(),
                        );
                    }
                    let mut builder = ctx.builder(sfont).size(glyph.font_size).hint(false);
                    if !settings.is_empty() {
                        builder = builder.variations(settings.into_iter());
                    }
                    let mut scaler = builder.build();
                    let outline = scaler.scale_outline(glyph.glyph_id)?;
                    let b = outline.bounds();
                    Some((b.min.x, b.max.x))
                })
                .flatten();

            if let Some((min_x, max_x)) = bounds {
                let x0 = glyph.x + glyph.font_size * glyph.x_offset + min_x;
                let x1 = glyph.x + glyph.font_size * glyph.x_offset + max_x;
                println!(
                    "glyph gid={} x={} w={} x_off={} bounds=({:.4},{:.4}) span=({:.4},{:.4}) width={:.4}",
                    glyph.glyph_id,
                    glyph.x,
                    glyph.w,
                    glyph.x_offset,
                    min_x,
                    max_x,
                    x0,
                    x1,
                    x1 - x0
                );
            } else {
                println!(
                    "glyph gid={} x={} w={} x_off={} outline=None",
                    glyph.glyph_id, glyph.x, glyph.w, glyph.x_offset
                );
            }
        }
    }
}

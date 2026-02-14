use cosmic_text::fontdb;
use std::fs;
use std::path::PathBuf;

fn main() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("assets")
        .join("fonts");

    let mut db = fontdb::Database::new();

    for name in [
        "NotoSans-Regular.ttf",
        "Inter-Regular.ttf",
        "Inter-Bold.ttf",
        "InterVariable.ttf",
        "InterVariable-Italic.ttf",
        "RobotoFlex-Variable.ttf",
    ] {
        let path = root.join(name);
        let bytes = fs::read(&path).expect("read font");
        let arc: std::sync::Arc<dyn AsRef<[u8]> + Send + Sync> = std::sync::Arc::new(bytes);
        let ids = db.load_font_source(fontdb::Source::Binary(arc));
        println!("loaded {name} => {} face(s)", ids.len());
    }

    println!("\nfaces in db: {}", db.len());

    for face in db.faces() {
        let family = face
            .families
            .iter()
            .map(|(f, _)| f.clone())
            .collect::<Vec<_>>()
            .join(" | ");
        let var_axes = db
            .with_face_data(face.id, |data, index| {
                swash::FontRef::from_index(data, index as usize)
                    .map(|fr| {
                        let tags = [
                            swash::Tag::from_be_bytes(*b"wght"),
                            swash::Tag::from_be_bytes(*b"wdth"),
                            swash::Tag::from_be_bytes(*b"opsz"),
                        ];
                        tags.into_iter()
                            .filter(|tag| fr.variations().find_by_tag(*tag).is_some())
                            .map(|tag| String::from_utf8_lossy(&tag.to_be_bytes()).to_string())
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default()
            })
            .unwrap_or_default();

        println!(
            "id={:?} index={} family='{}' ps='{}' style={:?} weight={} var_axes={:?}",
            face.id,
            face.index,
            family,
            face.post_script_name,
            face.style,
            face.weight.0,
            var_axes,
        );
    }

    for fam in ["Inter", "Inter Variable", "Roboto Flex", "Noto Sans"] {
        for w in [300u16, 450, 600, 750, 900] {
            let q = fontdb::Query {
                families: &[fontdb::Family::Name(fam)],
                weight: fontdb::Weight(w),
                stretch: fontdb::Stretch::Normal,
                style: fontdb::Style::Normal,
            };
            let picked = db.query(&q);
            let picked_s = picked
                .and_then(|id| db.face(id))
                .map(|f| format!("id={:?} idx={} ps={} w={}", f.id, f.index, f.post_script_name, f.weight.0))
                .unwrap_or_else(|| "none".to_string());
            println!("query family='{fam}' weight={w} -> {picked_s}");
        }
        println!();
    }
}

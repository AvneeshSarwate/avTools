use anyhow::{Context, Result, bail};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Write,
    path::Path,
};

/// Explicit scaffolding only. Unrelated project content (e.g. a .toe) is allowed;
/// each top-level template path must be absent, including symlinks.
pub fn create(root: &Path) -> Result<()> {
    let files: BTreeMap<String, String> =
        serde_json::from_str(include_str!("../assets/template.json"))?;
    fs::create_dir_all(root)?;
    let owned: BTreeSet<_> = files
        .keys()
        .map(|p| Path::new(p).components().next().unwrap().as_os_str())
        .collect();
    for name in owned {
        let path = root.join(name);
        if fs::symlink_metadata(&path).is_ok() {
            bail!(
                "Template would replace {}; choose a new folder. Existing files were not changed.",
                path.display()
            );
        }
    }
    // create_new prevents a concurrent creator from being overwritten after preflight.
    for (path, content) in files {
        let path = root.join(path);
        fs::create_dir_all(path.parent().unwrap())?;
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&path)
            .with_context(|| format!("Cannot create {}. Existing files were not overwritten; a partial template may remain.", path.display()))?;
        file.write_all(content.as_bytes())?;
    }
    Ok(())
}

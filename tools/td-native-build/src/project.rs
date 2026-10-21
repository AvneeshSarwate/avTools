use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Config {
    pub version: u32,
    pub sketches: BTreeMap<String, Entry>,
    #[serde(default = "dist")]
    pub out_dir: String,
    #[serde(default = "generated")]
    pub generated_dir: String,
    #[serde(default)]
    pub shader_dirs: Vec<String>,
}
fn dist() -> String {
    "dist".into()
}
fn generated() -> String {
    "generated".into()
}
fn one() -> usize {
    1
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    pub entry: String,
    pub target: String,
    #[serde(default)]
    pub outputs: Vec<String>,
    #[serde(default = "one")]
    pub samples: usize,
}
pub fn local(root: &Path, value: &str) -> Result<PathBuf> {
    let path = Path::new(value);
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|p| !matches!(p, std::path::Component::Normal(_)))
    {
        bail!("Path must be relative and inside the project: {value}");
    }
    Ok(root.join(path))
}
impl Config {
    pub fn load(root: &Path) -> Result<Self> {
        let config: Self = serde_json::from_slice(&fs::read(root.join("avtools.json"))?)?;
        if config.version != 1 || config.sketches.is_empty() {
            bail!("Expected version 1 and nonempty sketches");
        }
        let out = local(root, &config.out_dir)?;
        let generated = local(root, &config.generated_dir)?;
        for p in [&out, &generated] {
            if p.starts_with(root.join(".avtools")) || p.starts_with(root.join("sdk")) {
                bail!("Output directory conflicts with SDK or build metadata");
            }
        }
        if out.starts_with(&generated) || generated.starts_with(&out) {
            bail!("Output and generated directories must be separate");
        }
        for (name, entry) in &config.sketches {
            if name.is_empty()
                || !name
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            {
                bail!("Invalid entry name: {name}");
            }
            let path = local(root, &entry.entry)?;
            if path.starts_with(&out)
                || path.starts_with(&generated)
                || path.starts_with(root.join(".avtools"))
            {
                bail!("Entry inside generated/output directory");
            }
            if !["top", "chop"].contains(&entry.target.as_str()) {
                bail!("Invalid target: {}", entry.target);
            }
            if entry.target == "chop" {
                let mut names = std::collections::HashSet::new();
                if entry.outputs.is_empty()
                    || entry.outputs.len() > 1024
                    || entry.samples == 0
                    || entry
                        .outputs
                        .len()
                        .checked_mul(entry.samples)
                        .unwrap_or(usize::MAX)
                        > 1048576
                {
                    bail!("Invalid CHOP output shape for {name}");
                }
                for n in &entry.outputs {
                    if n.is_empty()
                        || n.len() > 128
                        || n.as_bytes()[0].is_ascii_digit()
                        || !n.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
                        || !names.insert(n)
                    {
                        bail!("Invalid/duplicate output channel: {n}");
                    }
                }
            }
        }
        for dir in &config.shader_dirs {
            let p = local(root, dir)?;
            if [&out, &generated]
                .iter()
                .any(|x| p.starts_with(x) || x.starts_with(&p))
            {
                bail!("Shader directories overlap outputs");
            }
        }
        Ok(config)
    }
}

pub fn ignored(root: &Path, path: &Path, config: Option<&Config>) -> bool {
    let rel = path.strip_prefix(root).unwrap_or(path);
    if rel.components().any(|p| {
        matches!(
            p.as_os_str().to_str(),
            Some(
                ".git"
                    | ".avtools"
                    | "node_modules"
                    | "target"
                    | "build"
                    | "artifacts"
                    | "Backup"
                    | "Plugins"
            )
        )
    }) {
        return true;
    }
    let output = config.map_or("dist", |c| &c.out_dir);
    let generated = config.map_or("generated", |c| &c.generated_dir);
    rel.starts_with(output)
        || rel.starts_with(generated)
        || matches!(
            path.extension().and_then(|x| x.to_str()),
            Some("toe" | "tox" | "tmp" | "log" | "plugin" | "dylib")
        )
}
// Capture every allowed input, including missing-import directory changes. Content
// hashes before publication catch edits even if FSEvents delivery is delayed.
pub fn snapshot(root: &Path, config: &Config) -> Result<BTreeMap<PathBuf, Vec<u8>>> {
    let mut files = BTreeMap::new();
    for item in walkdir::WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| e.path() == root || !ignored(root, e.path(), Some(config)))
    {
        let item = item?;
        if item.file_type().is_file() {
            files.insert(
                item.path().strip_prefix(root)?.to_path_buf(),
                fs::read(item.path()).with_context(|| item.path().display().to_string())?,
            );
        }
    }
    Ok(files)
}
pub fn revision(files: &BTreeMap<PathBuf, Vec<u8>>) -> String {
    let mut hash = Sha256::new();
    for (path, bytes) in files {
        hash.update(path.to_string_lossy().as_bytes());
        hash.update([0]);
        hash.update((bytes.len() as u64).to_le_bytes());
        hash.update(bytes);
    }
    format!("{:x}", hash.finalize())
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<bool> {
    if fs::read(path).ok().as_deref() == Some(bytes) {
        return Ok(false);
    }
    fs::create_dir_all(path.parent().unwrap())?;
    let temp = path.with_extension(format!("{}.tmp", std::process::id()));
    fs::write(&temp, bytes)?;
    fs::rename(&temp, path)?;
    Ok(true)
}

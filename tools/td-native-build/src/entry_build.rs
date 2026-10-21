//! Manifest-free builds: one root entry plus its dependency graph, sharing tsconfig options.
use crate::{
    build::BuildResult,
    checker::Diagnostic,
    inputs::Inputs,
    project::{self, Config, Entry},
};
use anyhow::{Context, Result, bail};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::Instant,
};

#[derive(Clone)]
pub struct Selection {
    pub root: PathBuf,
    pub entry: PathBuf,
    pub target: String,
    pub cache: PathBuf,
}
impl Selection {
    pub fn discover(entry: &Path, target: &str) -> Result<Self> {
        if !["top", "chop"].contains(&target) {
            bail!("Target must be top or chop");
        }
        let entry = std::path::absolute(entry)?;
        let entry = PathBuf::from(tsrs_core::tspath::normalize_path(&entry.to_string_lossy()));
        if !matches!(
            entry.extension().and_then(|p| p.to_str()),
            Some("ts" | "tsx" | "mts" | "cts")
        ) {
            bail!("Choose a TypeScript entry file (.ts, .tsx, .mts or .cts)");
        }
        // Keep the logical path of workspace links: its enclosing config is the user's project.
        let root = entry
            .ancestors()
            .skip(1)
            .find(|p| p.join("tsconfig.json").is_file())
            .context(
                "No enclosing tsconfig.json; create a template or add a TypeScript project config",
            )?
            .to_path_buf();
        let relative = entry.strip_prefix(&root)?.to_path_buf();
        // FSEvents reports physical root paths (/private/var, not /var). Canonicalize
        // the project directory, keeping workspace links inside it logical.
        let root = root.canonicalize()?;
        let entry = root.join(relative);
        let key = format!("{}\n{target}", entry.strip_prefix(&root)?.display());
        let hash = format!("{:x}", Sha256::digest(key.as_bytes()));
        let cache = root.join(".avtools/entries").join(&hash[..20]);
        Ok(Self {
            root,
            entry,
            target: target.into(),
            cache,
        })
    }
}
fn diagnostic(error: impl std::fmt::Display) -> Diagnostic {
    Diagnostic {
        code: 0,
        message: error.to_string(),
        file: None,
        line: None,
        column: None,
    }
}
pub fn build(selection: &Selection, check_only: bool) -> Result<BuildResult> {
    fs::create_dir_all(&selection.cache)?;
    // Serialize CLI and TD publication, including shared generated files.
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(selection.root.join(".avtools/build.lock"))?;
    lock.lock()?;
    let result = match build_inner(selection, check_only) {
        Ok(result) => result,
        Err(error) => BuildResult {
            state: "error".into(),
            revision: String::new(),
            diagnostics: vec![diagnostic(format!("{error:#}"))],
            changed: vec![],
            elapsed_ms: 0.0,
            bundles: Default::default(),
        },
    };
    project::atomic_write(
        &selection.cache.join("status.json"),
        &serde_json::to_vec_pretty(&result)?,
    )?;
    Ok(result)
}
fn build_inner(s: &Selection, check_only: bool) -> Result<BuildResult> {
    crate::build::initialize();
    let start = Instant::now();
    let inputs = Inputs::default();
    let config = Config {
        version: 1,
        sketches: BTreeMap::new(),
        out_dir: "dist".into(),
        generated_dir: "generated".into(),
        shader_dirs: vec![String::new()],
    };
    // WGSL discovery is project-relative. Only wrappers actually requested by this
    // entry become build dependencies or contribute shader diagnostics.
    // TD project folders often contain large movies/images. Discover shader
    // sources only; ordinary imports are read lazily by the shared Inputs view.
    let mut files = BTreeMap::new();
    for item in walkdir::WalkDir::new(&s.root)
        .into_iter()
        .filter_entry(|e| {
            e.path() == s.root
                || (!project::ignored(&s.root, e.path(), Some(&config))
                    && !e.path().starts_with(s.root.join("sdk")))
        })
    {
        let item = item?;
        if item.file_type().is_file()
            && item.path().extension().and_then(|x| x.to_str()) == Some("wgsl")
        {
            files.insert(
                item.path().strip_prefix(&s.root)?.to_path_buf(),
                fs::read(item.path())?,
            );
        }
    }
    let mut generated = BTreeMap::new();
    let mut shaders = BTreeMap::new();
    let mut shader_errors = BTreeMap::new();
    for (path, bytes) in files.iter().filter(|(p, _)| {
        p.extension().and_then(|x| x.to_str()) == Some("wgsl") && !p.starts_with("sdk")
    }) {
        let name = path.file_name().unwrap().to_string_lossy();
        let suffixes = [
            (".material.wgsl", ".material.raw.generated.ts"),
            (".strokeMaterial.wgsl", ".strokeMaterial.raw.generated.ts"),
            (".fragFunc.wgsl", ".frag.raw.generated.ts"),
            (".compute.wgsl", ".compute.raw.generated.ts"),
        ];
        let Some(target) = suffixes.iter().find_map(|(suffix, out)| {
            name.strip_suffix(suffix).map(|stem| {
                Path::new("generated")
                    .join(path.parent().unwrap())
                    .join(format!("{stem}{out}"))
            })
        }) else {
            continue;
        };
        shaders.insert(s.root.join(&target), (path.clone(), bytes.clone()));
        match crate::generator::generate(&BTreeMap::from([(path.clone(), bytes.clone())]), &config)
        {
            Ok(output) => generated.extend(output),
            Err(error) => {
                shader_errors.insert(s.root.join(target), format!("{error:#}"));
            }
        }
    }
    inputs.generated(&s.root, "generated", &generated);
    let mut result = BuildResult {
        state: "ready".into(),
        revision: String::new(),
        diagnostics: crate::checker::check_selected(&s.root, &inputs, Some(&s.entry)),
        changed: vec![],
        elapsed_ms: 0.0,
        bundles: Default::default(),
    };
    let mut outputs = Vec::new();
    if result.diagnostics.is_empty() && !check_only {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()?;
        let entry = Entry {
            entry: s.entry.to_string_lossy().into_owned(),
            target: s.target.clone(),
            outputs: vec![],
            samples: 1,
        };
        match rt.block_on(crate::bundler::bundle(&s.root, "sketch", &entry, &inputs)) {
            Ok(files) => outputs = files,
            Err(error) => result.diagnostics.push(diagnostic(format!("{error:#}"))),
        }
    }
    let used = inputs.generated_reads();
    for target in &used {
        if let Some((path, bytes)) = shaders.get(target) {
            inputs.seed(&s.root, &BTreeMap::from([(path.clone(), bytes.clone())]));
        }
        if let Some(error) = shader_errors.get(target) {
            result.diagnostics.push(diagnostic(error));
        }
    }
    project::atomic_write(
        &s.cache.join("dependencies.json"),
        &serde_json::to_vec(&inputs.dependencies())?,
    )?;
    result.revision = inputs.revision();
    if !inputs.current() {
        result.state = "stale".into();
        result.diagnostics.push(diagnostic(
            "Inputs changed while building; result discarded",
        ));
        return Ok(result);
    }
    for (path, bytes) in &generated {
        if used.contains(&s.root.join(path)) {
            project::atomic_write(&s.root.join(path), bytes)?;
        }
    }
    if !result.diagnostics.is_empty() {
        result.state = "error".into();
        outputs.clear();
    }
    for (name, bytes) in outputs {
        if name == "sketch.js" {
            result
                .bundles
                .insert("sketch".into(), String::from_utf8(bytes.clone())?);
        }
        if project::atomic_write(&s.cache.join(&name), &bytes)? {
            result
                .changed
                .push(s.cache.join(name).to_string_lossy().into_owned());
        }
    }
    result.elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
    Ok(result)
}

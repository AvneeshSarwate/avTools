use crate::{
    bundler, checker, generator,
    project::{self, Config},
};
use anyhow::{Result, bail};
use serde::Serialize;
use std::{fs, path::Path, time::Instant};
#[derive(Clone, Serialize)]
pub struct BuildResult {
    pub state: String,
    pub revision: String,
    pub diagnostics: Vec<checker::Diagnostic>,
    pub changed: Vec<String>,
    pub elapsed_ms: f64,
    #[serde(skip)]
    pub bundles: std::collections::HashMap<String, String>,
}
pub fn build(root: &Path, check_only: bool) -> Result<BuildResult> {
    // Keep status publication inside the same cross-process lock as the build.
    fs::create_dir_all(root.join(".avtools"))?;
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join(".avtools/build.lock"))?;
    lock.lock()?;
    match build_inner(root, check_only) {
        Ok(result) => Ok(result),
        Err(error) => {
            let revision = Config::load(root)
                .ok()
                .and_then(|c| project::snapshot(root, &c).ok())
                .map(|s| project::revision(&s))
                .unwrap_or_default();
            let result = BuildResult {
                state: if error.to_string().contains("Inputs changed while building") {
                    "stale".into()
                } else {
                    "error".into()
                },
                revision,
                diagnostics: vec![checker::Diagnostic {
                    code: 0,
                    message: format!("{error:#}"),
                    file: None,
                    line: None,
                    column: None,
                }],
                changed: vec![],
                elapsed_ms: 0.0,
                bundles: Default::default(),
            };
            project::atomic_write(
                &root.join(".avtools/status.json"),
                &serde_json::to_vec_pretty(&result)?,
            )?;
            Ok(result)
        }
    }
}
fn build_inner(root: &Path, check_only: bool) -> Result<BuildResult> {
    initialize();
    let start = Instant::now();
    let config = Config::load(root)?;
    let files = project::snapshot(root, &config)?;
    let captured: Config = serde_json::from_slice(&files[Path::new("avtools.json")])?;
    if serde_json::to_value(&captured)? != serde_json::to_value(&config)? {
        bail!("Inputs changed while building; configuration snapshot changed");
    }
    let inputs = crate::inputs::Inputs::default();
    inputs.seed(root, &files);
    let revision = project::revision(&files);
    let session = root.join(".avtools/session");
    if session.exists() {
        fs::remove_dir_all(&session)?;
    }
    fs::create_dir_all(&session)?;
    struct Cleanup(std::path::PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    let _cleanup = Cleanup(session.clone());
    let generated = generator::generate(&files, &config)?;
    inputs.generated(root, &config.generated_dir, &generated);
    let diagnostics = checker::check_inputs(root, &inputs);
    let mut result = BuildResult {
        state: "ready".into(),
        revision,
        diagnostics,
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
        for (name, entry) in &config.sketches {
            match rt.block_on(bundler::bundle(root, name, entry, &inputs)) {
                Ok(files) => outputs.extend(files),
                Err(error) => {
                    result.diagnostics.push(checker::Diagnostic {
                        code: 0,
                        message: format!("{error:#}"),
                        file: None,
                        line: None,
                        column: None,
                    });
                    break;
                }
            }
        }
    }
    project::atomic_write(
        &root.join(".avtools/source-revision.txt"),
        result.revision.as_bytes(),
    )?;
    let dependencies = inputs.dependencies();
    project::atomic_write(
        &root.join(".avtools/dependencies.json"),
        &serde_json::to_vec(&dependencies)?,
    )?;
    if !inputs.current() || project::revision(&project::snapshot(root, &config)?) != result.revision
    {
        bail!("Inputs changed while building; result discarded. Retry scheduled by watcher.");
    }
    result.revision = inputs.revision();
    // Derived source remains inspectable even when a user type error blocks publication.
    for (path, bytes) in &generated {
        project::atomic_write(&root.join(path), bytes)?;
    }
    let gen_dir = root.join(&config.generated_dir);
    if gen_dir.exists() {
        for item in walkdir::WalkDir::new(&gen_dir) {
            let item = item?;
            if item.file_type().is_file()
                && item.path().to_string_lossy().ends_with(".generated.ts")
                && !generated.contains_key(item.path().strip_prefix(root)?)
            {
                fs::remove_file(item.path())?;
            }
        }
    }
    if !result.diagnostics.is_empty() {
        result.state = "error".into();
        outputs.clear(); // Every entry must succeed before publishing any runtime bundle.
    }
    for (name, bytes) in outputs {
        if let Some(entry) = name.strip_suffix(".js") {
            result
                .bundles
                .insert(entry.to_owned(), String::from_utf8(bytes.clone())?);
        }
        if project::atomic_write(&root.join(&config.out_dir).join(&name), &bytes)? {
            result.changed.push(name);
        }
    }
    result.elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
    project::atomic_write(
        &root.join(".avtools/status.json"),
        &serde_json::to_vec_pretty(&result)?,
    )?;
    if result.state == "ready" && !check_only {
        project::atomic_write(
            &root.join(".avtools/last-good.json"),
            &serde_json::to_vec_pretty(&result)?,
        )?;
    }
    Ok(result)
}

pub(crate) fn initialize() {
    static INIT: std::sync::Once = std::sync::Once::new();
    INIT.call_once(|| {
        let _ = rayon::ThreadPoolBuilder::new()
            .num_threads(2)
            .build_global();
    });
}

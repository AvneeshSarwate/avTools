use crate::project::Entry;
use anyhow::{Result, anyhow, bail};
use rolldown::{
    Bundler, BundlerOptions, CodeSplittingMode, InputItem, OutputFormat, Platform, SourceMapType,
};
use rolldown_common::{ModuleType, Output};
use std::path::Path;

pub async fn bundle(
    root: &Path,
    name: &str,
    entry: &Entry,
    inputs: &crate::inputs::Inputs,
) -> Result<Vec<(String, Vec<u8>)>> {
    let errors = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let mut bundler = Bundler::with_plugins(
        BundlerOptions {
            cwd: Some(root.to_path_buf()),
            tsconfig: Some(rolldown::TsConfig::Manual(root.join("tsconfig.json"))),
            input: Some(vec![InputItem {
                name: Some(name.into()),
                import: root.join(&entry.entry).to_string_lossy().into_owned(),
            }]),
            name: Some("__tdSketch".into()),
            resolve: Some(rolldown::ResolveOptions {
                main_fields: Some(vec!["module".into(), "main".into()]),
                ..Default::default()
            }),
            format: Some(OutputFormat::Iife),
            platform: Some(Platform::Neutral),
            sourcemap: Some(SourceMapType::File),
            code_splitting: Some(CodeSplittingMode::Bool(false)),
            module_types: Some([(".wgsl".into(), ModuleType::Text)].into_iter().collect()),
            ..Default::default()
        },
        vec![rolldown_plugin::Plugin::new_shared(DependencyPlugin::new(
            root,
            inputs,
            errors.clone(),
        ))],
    )
    .map_err(|e| anyhow!("{e:?}"))?;
    let result = bundler.generate().await;
    bundler.close().await.map_err(|e| anyhow!("{e:?}"))?;
    let output = result.map_err(|e| {
        anyhow!(
            "{}\n{}",
            e.iter()
                .map(|d| d.to_diagnostic().convert_to_string(false))
                .collect::<Vec<_>>()
                .join("\n"),
            errors.lock().unwrap().join("\n")
        )
    })?;
    // Our resolver reports unresolved imports as errors; ordinary package warnings are nonfatal.
    let mut files = Vec::new();
    for asset in output.assets {
        let mut bytes = asset.content_as_bytes().to_vec();
        if let Output::Chunk(chunk) = &asset {
            if !chunk.imports.is_empty() || !chunk.dynamic_imports.is_empty() {
                bail!("External/dynamic imports are unsupported");
            }
            let required = if entry.target == "chop" {
                vec!["setup", "onCook"]
            } else {
                vec!["draw"]
            };
            if !required
                .iter()
                .any(|name| chunk.exports.iter().any(|x| x.as_str() == *name))
            {
                bail!("{name}: export {}", required.join(" or "));
            }
            let footer = if entry.target == "chop" {
                "\nfunction setup(host) { return __tdSketch.setup?.(host); }\nfunction onCook(host, frame) { return __tdSketch.onCook?.(host, frame); }\nconst onPulse = __tdSketch.onPulse;\n"
            } else {
                "\nfunction setup(p, host) { return __tdSketch.setup?.(p, host); }\nfunction draw(p, frame) { return __tdSketch.draw(p, frame); }\nconst onPulse = __tdSketch.onPulse;\n"
            };
            bytes.extend_from_slice(footer.as_bytes());
            let path = root.join(&entry.entry);
            let source = String::from_utf8(inputs.read(&path)?)?;
            let metadata = crate::parameters::extract(&source, &path, chunk.exports.iter().any(|e| e.as_str() == "parameters"))?;
            let mut annotated = format!("// avtools-parameters-v1:{metadata}\n").into_bytes();
            annotated.extend(bytes);
            bytes = annotated;
        }
        if asset.filename().ends_with(".map") {
            let mut map: serde_json::Value = serde_json::from_slice(&bytes)?;
            if let Some(mappings) = map.get_mut("mappings") {
                *mappings = serde_json::Value::String(format!(";{}", mappings.as_str().unwrap_or("")));
            }
            bytes = serde_json::to_vec(&map)?;
        }
        files.push((asset.filename().to_string(), bytes));
    }
    Ok(files)
}

#[derive(Debug)]
struct DependencyPlugin {
    root: std::path::PathBuf,
    inputs: crate::inputs::Inputs,
    imports: oxc_resolver::ResolverGeneric<crate::inputs::Inputs>,
    requires: oxc_resolver::ResolverGeneric<crate::inputs::Inputs>,
    errors: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
}
impl DependencyPlugin {
    fn failure(&self, message: String) -> anyhow::Error {
        self.errors.lock().unwrap().push(message.clone());
        anyhow!(message)
    }
    fn new(
        root: &Path,
        inputs: &crate::inputs::Inputs,
        errors: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
    ) -> Self {
        let options = |condition: &str| oxc_resolver::ResolveOptions {
            tsconfig: Some(oxc_resolver::TsconfigDiscovery::Manual(
                oxc_resolver::TsconfigOptions {
                    config_file: root.join("tsconfig.json"),
                    references: oxc_resolver::TsconfigReferences::Auto,
                },
            )),
            condition_names: vec![condition.into(), "default".into()],
            extensions: vec![
                ".tsx".into(),
                ".ts".into(),
                ".jsx".into(),
                ".js".into(),
                ".mjs".into(),
                ".cjs".into(),
                ".json".into(),
            ],
            extension_alias: vec![
                (
                    ".js".into(),
                    vec![".ts".into(), ".tsx".into(), ".js".into()],
                ),
                (".mjs".into(), vec![".mts".into(), ".mjs".into()]),
                (".cjs".into(), vec![".cts".into(), ".cjs".into()]),
            ],
            main_fields: vec!["module".into(), "main".into()],
            // Honor package-authored browser fallbacks (e.g. seedrandom crypto:false).
            alias_fields: vec![vec!["browser".into()]],
            builtin_modules: false,
            ..Default::default()
        };
        Self {
            errors,
            root: root.into(),
            inputs: inputs.clone(),
            imports: oxc_resolver::ResolverGeneric::new_with_file_system(
                inputs.clone(),
                options("import"),
            ),
            requires: oxc_resolver::ResolverGeneric::new_with_file_system(
                inputs.clone(),
                options("require"),
            ),
        }
    }
}
impl rolldown_plugin::Plugin for DependencyPlugin {
    fn register_hook_usage(&self) -> rolldown_plugin::HookUsage {
        rolldown_plugin::HookUsage::ResolveId | rolldown_plugin::HookUsage::Load
    }
    fn name(&self) -> std::borrow::Cow<'static, str> {
        "avtools-inputs".into()
    }
    async fn resolve_id(
        &self,
        _ctx: &rolldown_plugin::PluginContext,
        args: &rolldown_plugin::HookResolveIdArgs<'_>,
    ) -> rolldown_plugin::HookResolveIdReturn {
        if args.specifier.starts_with('\0') {
            return Ok(None);
        }
        let parent = args
            .importer
            .and_then(|p| Path::new(p).parent())
            .unwrap_or(&self.root);
        let resolver = if args.kind == rolldown_common::ImportKind::Require {
            &self.requires
        } else {
            &self.imports
        };
        let resolution = match resolver.resolve(parent,args.specifier) {
            Ok(value) => value,
            Err(oxc_resolver::ResolveError::Ignored(_)) => return Ok(Some(rolldown_plugin::HookResolveIdOutput::from_id("\0avtools-empty"))),
            Err(e) => return Err(self.failure(format!("Cannot resolve {} from {}: {e}. Install dependencies with your package manager; Node built-ins have no TD runtime implementation.",args.specifier,parent.display()))),
        };
        let mut output = rolldown_plugin::HookResolveIdOutput::from_id(
            resolution.full_path().to_string_lossy().into_owned(),
        );
        output.package_json_path = resolution
            .package_json()
            .map(|p| p.path().to_string_lossy().into_owned());
        Ok(Some(output))
    }
    async fn load(
        &self,
        _ctx: rolldown_plugin::SharedLoadPluginContext,
        args: &rolldown_plugin::HookLoadArgs<'_>,
    ) -> rolldown_plugin::HookLoadReturn {
        if args.id == "\0avtools-empty" {
            return Ok(Some(rolldown_plugin::HookLoadOutput {
                code: "module.exports = {};".into(),
                ..Default::default()
            }));
        }
        if args.id.starts_with('\0') {
            return Ok(None);
        }
        if args.id.ends_with(".d.ts") || args.id.ends_with(".d.mts") || args.id.ends_with(".d.cts")
        {
            return Err(self.failure(format!("{} is declarations only; use type-only imports. For runtime functions import the package implementation, not a declaration file.",args.id)));
        }
        Ok(Some(rolldown_plugin::HookLoadOutput {
            code: self
                .inputs
                .text(Path::new(args.id))
                .map_err(|e| self.failure(format!("Cannot load {}: {e}", args.id)))?
                .into(),
            ..Default::default()
        }))
    }
}

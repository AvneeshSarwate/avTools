use crate::project::Entry;
use anyhow::{Result, anyhow, bail};
use oxc_ast_visit::Visit;
use rolldown::{
    Bundler, BundlerOptions, CodeSplittingMode, InputItem, OutputFormat, Platform, SourceMapType,
};
use rolldown_common::{ModuleType, Output};
use std::path::Path;

pub async fn bundle(root: &Path, name: &str, entry: &Entry) -> Result<Vec<(String, Vec<u8>)>> {
    let mut bundler = Bundler::new(BundlerOptions {
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
    })
    .map_err(|e| anyhow!("{e:?}"))?;
    let result = bundler.generate().await;
    bundler.close().await.map_err(|e| anyhow!("{e:?}"))?;
    let output = result.map_err(|e| anyhow!("{e:?}"))?;
    // Unresolved imports are warnings in Rollup; they cannot become runtime globals here.
    if !output.warnings.is_empty() {
        bail!("Bundler warnings: {:?}", output.warnings);
    }
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
            for module in &chunk.module_ids {
                let id = module.to_string();
                if Path::new(&id).is_absolute() && !Path::new(&id).starts_with(root) {
                    bail!("Runtime dependencies must be inside the project/SDK: {id}");
                }
                if id.contains("/core-timing/")
                    || id.contains("/babylon/")
                    || id.contains("/babylonGL/")
                {
                    bail!(
                        "Unsupported runtime module {id}; use host.timing and raw WebGPU libraries"
                    );
                }
            }
            validate_runtime(&chunk.code)?;
            for module in &chunk.module_ids {
                let id = module.to_string();
                if let Ok(text) = std::fs::read_to_string(&id) {
                    validate_imports(&id, &text)?;
                }
            }
            let footer = if entry.target == "chop" {
                "\nfunction setup(host) { return __tdSketch.setup?.(host); }\nfunction onCook(host, frame) { return __tdSketch.onCook?.(host, frame); }\nconst onPulse = __tdSketch.onPulse;\n"
            } else {
                "\nfunction setup(p, host) { return __tdSketch.setup?.(p, host); }\nfunction draw(p, frame) { return __tdSketch.draw(p, frame); }\nconst onPulse = __tdSketch.onPulse;\n"
            };
            bytes.extend_from_slice(footer.as_bytes());
        }
        files.push((asset.filename().to_string(), bytes));
    }
    Ok(files)
}

fn validate_runtime(code: &str) -> Result<()> {
    let allocator = oxc_allocator::Allocator::default();
    let parsed = oxc_parser::Parser::new(&allocator, code, oxc_span::SourceType::mjs()).parse();
    let semantic = oxc_semantic::SemanticBuilder::new().build(&parsed.program);
    for name in [
        "window",
        "document",
        "navigator",
        "fetch",
        "WebSocket",
        "Worker",
        "setInterval",
        "clearInterval",
        "Deno",
        "process",
        "require",
    ] {
        if semantic
            .semantic
            .scoping()
            .root_unresolved_references()
            .contains_key(name)
        {
            bail!("{name} is unavailable in the TD runtime");
        }
    }
    Ok(())
}
#[derive(Default)]
struct Imports {
    dynamic: bool,
}
impl<'a> Visit<'a> for Imports {
    fn visit_import_expression(&mut self, _: &oxc_ast::ast::ImportExpression<'a>) {
        self.dynamic = true;
    }
}
fn validate_imports(path: &str, code: &str) -> Result<()> {
    let allocator = oxc_allocator::Allocator::default();
    let source_type = oxc_span::SourceType::from_path(path).unwrap_or(oxc_span::SourceType::mjs());
    let parsed = oxc_parser::Parser::new(&allocator, code, source_type).parse();
    let mut visitor = Imports::default();
    visitor.visit_program(&parsed.program);
    if visitor.dynamic {
        bail!("{path}: runtime import() is unsupported; use static imports");
    }
    Ok(())
}

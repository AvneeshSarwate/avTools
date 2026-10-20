use crate::project::Config;
use anyhow::{Result, anyhow};
use rquickjs::{Context, Runtime};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

pub fn generate(
    files: &BTreeMap<PathBuf, Vec<u8>>,
    config: &Config,
) -> Result<BTreeMap<PathBuf, Vec<u8>>> {
    let runtime = Runtime::new()?;
    let context = Context::full(&runtime)?;
    context.with(|ctx| -> Result<_> {
        ctx.eval::<(), _>(include_str!("../assets/generators.js"))
            .map_err(|e| anyhow!("Shader engine: {e}: {:?}", ctx.catch()))?;
        let mut outputs = BTreeMap::new();
        for (path, source) in files {
            if !config.shader_dirs.iter().any(|d| path.starts_with(d))
                || path.extension().and_then(|x| x.to_str()) != Some("wgsl")
            {
                continue;
            }
            let input = serde_json::to_string(&String::from_utf8(source.clone())?)?;
            let name = serde_json::to_string(&path.to_string_lossy())?;
            let result: String = ctx
                .eval(format!(
                    "JSON.stringify(avtoolsGenerators.generate({name}, {input}) ?? null)"
                ))
                .map_err(|e| anyhow!("{}: {e}: {:?}", path.display(), ctx.catch()))?;
            let result: serde_json::Value = serde_json::from_str(&result)?;
            if result.is_null() {
                continue;
            }
            let name = path.file_name().unwrap().to_str().unwrap();
            let stem = [
                ".strokeMaterial.wgsl",
                ".material.wgsl",
                ".fragFunc.wgsl",
                ".compute.wgsl",
            ]
            .into_iter()
            .find_map(|s| name.strip_suffix(s))
            .unwrap();
            let target = Path::new(&config.generated_dir)
                .join(path.parent().unwrap())
                .join(format!("{stem}{}", result["suffix"].as_str().unwrap()));
            outputs.insert(target, result["code"].as_str().unwrap().as_bytes().to_vec());
        }
        Ok(outputs)
    })
}

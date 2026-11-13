//! The only module allowed to hold tsrs arena pointers. Every returned field is owned.
use serde::Serialize;
use std::{
    path::Path,
    sync::{Arc, Mutex},
};
use tsrs_core::{P, Tristate, arena::Region, context::Context};
use tsrs_vfs::{FS, bundled};

static POISONED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static SESSION: Mutex<()> = Mutex::new(());
#[derive(Debug, Clone, Serialize)]
pub struct Diagnostic {
    pub code: i32,
    pub message: String,
    pub file: Option<String>,
    pub line: Option<usize>,
    pub column: Option<usize>,
}
struct Host {
    cwd: String,
    fs: Arc<dyn FS>,
}
impl tsrs_tsoptions::ParseConfigHost for Host {
    fn fs(&self) -> &dyn FS {
        self.fs.as_ref()
    }
    fn get_current_directory(&self) -> &str {
        &self.cwd
    }
}
struct Program(&'static tsrs_compiler::Program);
impl Drop for Program {
    fn drop(&mut self) {
        // SAFETY: no pointer escapes check(); no incremental/shared programs exist.
        unsafe { tsrs_compiler::free_unshared_program(self.0) }
    }
}
fn copy(d: P<tsrs_ast::Diagnostic>) -> Diagnostic {
    let file = d.file();
    let location = file.and_then(|f| {
        d.pos().map(|p| {
            let text = f.text();
            let mut pos = (p as usize).min(text.len());
            while !text.is_char_boundary(pos) {
                pos -= 1;
            }
            let prefix = &text[..pos];
            let line = prefix.bytes().filter(|b| *b == b'\n').count() + 1;
            let column = prefix
                .rsplit('\n')
                .next()
                .unwrap_or("")
                .encode_utf16()
                .count()
                + 1;
            (line, column)
        })
    });
    Diagnostic {
        code: d.code(),
        message: format!("{}", &*d),
        file: file.map(|f| f.file_name().to_string()),
        line: location.map(|x| x.0),
        column: location.map(|x| x.1),
    }
}
pub fn check(root: &Path) -> Vec<Diagnostic> {
    check_inputs(root, &crate::inputs::Inputs::default())
}
pub fn check_inputs(root: &Path, inputs: &crate::inputs::Inputs) -> Vec<Diagnostic> {
    check_selected(root, inputs, None)
}
pub fn check_selected(
    root: &Path,
    inputs: &crate::inputs::Inputs,
    entry: Option<&Path>,
) -> Vec<Diagnostic> {
    let _lock = SESSION.lock().unwrap_or_else(|e| e.into_inner());
    assert!(
        !POISONED.load(std::sync::atomic::Ordering::Relaxed),
        "Compiler session is poisoned; restart the host"
    );
    struct PanicGuard;
    impl Drop for PanicGuard {
        fn drop(&mut self) {
            if std::thread::panicking() {
                POISONED.store(true, std::sync::atomic::Ordering::Relaxed);
            }
        }
    }
    let _panic_guard = PanicGuard;
    let region = Region::new(1 << 20);
    let diagnostics = {
        let _scope = region.enter();
        let fs: Arc<dyn FS> = Arc::new(bundled::wrap_fs(inputs.checker_fs()));
        let host = P::new(Host {
            cwd: root.to_string_lossy().into_owned(),
            fs: fs.clone(),
        });
        let options = tsrs_core::CompilerOptions {
            no_emit: Tristate::True,
            single_threaded: Tristate::True,
            ..Default::default()
        };
        let (config, errors) = tsrs_tsoptions::get_parsed_command_line_of_config_file(
            &root.join("tsconfig.json").to_string_lossy(),
            Some(&options),
            None,
            host.get(),
            None,
        );
        let mut diagnostics: Vec<_> = errors.into_iter().map(copy).collect();
        if let Some(mut config) = config {
            if let Some(entry) = entry {
                // Keep explicit ambient declarations, but do not check unrelated runnable sketches.
                let mut files: Vec<_> = config
                    .parsed_config
                    .file_names
                    .iter()
                    .filter(|p| {
                        p.ends_with(".d.ts") || p.ends_with(".d.mts") || p.ends_with(".d.cts")
                    })
                    .cloned()
                    .collect();
                files.push(entry.to_string_lossy().into_owned());
                config = config.with_file_names(files);
                config.errors.retain(|d| d.code() != 18003);
                diagnostics.retain(|d| d.code != 18003);
            }
            let host = tsrs_compiler::new_cached_fs_compiler_host(
                &root.to_string_lossy(),
                fs,
                &bundled::default_lib_path(),
                None,
                None,
                None,
            );
            let mut options = tsrs_compiler::ProgramOptions::new(P::new(config), host);
            options.single_threaded = Tristate::True;
            options.checker_regions = true;
            options.checker_diagnostic_regions = true;
            let program = Program(tsrs_compiler::new_program(options));
            let ctx = Context::default();
            let errors = tsrs_compiler::get_diagnostics_of_any_program(
                &ctx,
                program.0,
                None,
                false,
                &mut |ctx, file| program.0.get_bind_diagnostics(ctx, file),
                &mut |ctx, file| program.0.get_semantic_diagnostics(ctx, file),
            );
            diagnostics.extend(errors.into_iter().map(copy));
        }
        diagnostics
    };
    drop(region);
    // SAFETY: all P values, programs and checker regions are gone; checks are serialized,
    // single-threaded and shared-graph/leaf-freeing caches are never enabled.
    unsafe {
        tsrs_ast::avtools_reset_session_ids();
    }
    diagnostics
}

pub mod build;
pub mod bundler;
pub mod checker;
pub mod ffi;
pub mod generator;
pub mod project;
pub mod service;
pub fn version() -> &'static str {
    "0.1.0"
}
pub mod file_watch;

pub mod inputs;

pub mod entry_build;
pub mod template;

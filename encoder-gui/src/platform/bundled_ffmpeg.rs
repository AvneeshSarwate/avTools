use anyhow::{anyhow, Result};
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

pub fn find_ffmpeg() -> Result<PathBuf> {
    find_tool("ffmpeg", "HAP_ENCODER_FFMPEG")
}

pub fn find_ffprobe() -> Result<PathBuf> {
    find_tool("ffprobe", "HAP_ENCODER_FFPROBE")
}

fn find_tool(tool_name: &str, env_key: &str) -> Result<PathBuf> {
    if let Ok(path) = env::var(env_key) {
        let path = PathBuf::from(path);
        if is_executable(&path) {
            return Ok(path);
        }
    }

    let exe = env::current_exe().ok();
    let candidates = sidecar_candidates(tool_name, exe.as_deref());
    for candidate in candidates {
        if is_executable(&candidate) {
            return Ok(candidate);
        }
    }

    if command_available(tool_name) {
        return Ok(PathBuf::from(tool_name));
    }

    Err(anyhow!(
        "Could not find {tool_name}. Put it next to the app, install it on PATH, or set {env_key}."
    ))
}

fn sidecar_candidates(tool_name: &str, current_exe: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let file_name = if cfg!(windows) {
        format!("{tool_name}.exe")
    } else {
        tool_name.to_string()
    };

    if let Some(exe) = current_exe {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(&file_name));
            candidates.push(dir.join("Resources").join(&file_name));
            if cfg!(target_os = "macos") {
                candidates.push(dir.join("../Resources").join(&file_name));
            }
        }
    }
    candidates
}

fn command_available(tool_name: &str) -> bool {
    Command::new(tool_name)
        .arg("-version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn is_executable(path: &Path) -> bool {
    path.is_file()
}

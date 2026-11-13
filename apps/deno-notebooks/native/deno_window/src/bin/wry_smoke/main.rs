// wry (and the webview this smoke test exercises) is a macOS-only dependency.
#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "macos")]
fn main() {
    macos::main();
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("wry_smoke is macOS-only");
}

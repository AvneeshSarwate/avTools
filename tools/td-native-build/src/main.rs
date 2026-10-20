use anyhow::{Result, bail};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
fn run() -> Result<()> {
    let args: Vec<_> = std::env::args().collect();
    let command = args.get(1).map(String::as_str).unwrap_or("help");
    let root = PathBuf::from(args.get(2).map(String::as_str).unwrap_or("."));
    if command == "init" {
        if root.exists() && root.read_dir()?.next().is_some() {
            bail!("init requires an empty directory; SDK upgrades are explicit");
        }
        let files: std::collections::BTreeMap<String, String> =
            serde_json::from_str(include_str!("../assets/template.json"))?;
        for (path, content) in files {
            avtools_build::project::atomic_write(&root.join(path), content.as_bytes())?;
        }
        println!("Created {}", root.display());
        return Ok(());
    }
    if command == "watch" {
        let service = avtools_build::service::Service::shared();
        let sub = service.subscribe(&root)?;
        sub.project
            .automatic
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let mut previous = 0;
        loop {
            {
                let state = sub.project.state.lock().unwrap();
                if state.sequence != previous {
                    previous = state.sequence;
                    println!("{}: {}", state.status, state.message);
                }
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    if command == "build" || command == "check" {
        let root = root.canonicalize()?;
        let result = avtools_build::build::build(&root, command == "check")?;
        println!("{}", serde_json::to_string_pretty(&result)?);
        if result.state != "ready" {
            bail!("Build failed; last successful bundles retained");
        }
        return Ok(());
    }
    if command == "soak" {
        let root = root.canonicalize()?;
        let count = args
            .get(3)
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(100);
        for i in 0..count {
            let start = std::time::Instant::now();
            let alternate = args.get(4).map(PathBuf::from);
            let selected = if i % 2 == 1 {
                alternate.as_deref().unwrap_or(&root)
            } else {
                &root
            };
            let result = avtools_build::checker::check(Path::new(selected));
            println!(
                "{}",
                serde_json::json!({"iteration":i,"errors":result.len(),"memory_bytes":tsrs_core::memsplit::process_memory(),"ms":start.elapsed().as_secs_f64()*1000.0})
            );
        }
        return Ok(());
    }
    println!(
        "avtools-build {}\nCommands: init|build|check|watch PROJECT; soak PROJECT [COUNT]\ncheck performs type checking only, not native runtime validation.",
        avtools_build::version()
    );
    Ok(())
}
fn main() {
    let result = std::thread::Builder::new()
        .stack_size(128 << 20)
        .spawn(run)
        .unwrap()
        .join();
    match result {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            eprintln!("{e:#}");
            std::process::exit(1)
        }
        Err(_) => {
            eprintln!("Compiler panicked");
            std::process::exit(2)
        }
    }
}

use crate::{build, project};
use anyhow::Result;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, Weak, mpsc},
    thread,
    time::Duration,
};

#[derive(Default)]
pub struct State {
    pub sequence: u64,
    pub revision: String,
    pub status: String,
    pub message: String,
    pub json: String,
    pub bundles: HashMap<String, String>,
}
pub struct Project {
    pub root: PathBuf,
    pub automatic: std::sync::atomic::AtomicUsize,
    pub state: Mutex<State>,
    _watcher: Mutex<Option<RecommendedWatcher>>,
}
enum Command {
    Build(Weak<Project>, bool),
    Stop,
}
pub struct Service {
    tx: mpsc::Sender<Command>,
    thread: Mutex<Option<thread::JoinHandle<()>>>,
    projects: Mutex<HashMap<PathBuf, Weak<Project>>>,
}
static SERVICE: OnceLock<Mutex<Weak<Service>>> = OnceLock::new();
impl Service {
    pub fn shared() -> Arc<Self> {
        let mut weak = SERVICE
            .get_or_init(|| Mutex::new(Weak::new()))
            .lock()
            .unwrap();
        if let Some(service) = weak.upgrade() {
            return service;
        }
        let (tx, rx) = mpsc::channel();
        let thread = thread::Builder::new()
            .name("avtools-build".into())
            .stack_size(128 << 20)
            .spawn(move || worker(rx))
            .unwrap();
        let service = Arc::new(Self {
            tx,
            thread: Mutex::new(Some(thread)),
            projects: Mutex::new(HashMap::new()),
        });
        *weak = Arc::downgrade(&service);
        service
    }
    pub fn subscribe(self: &Arc<Self>, root: &Path) -> Result<Subscription> {
        let root = root.canonicalize()?;
        let mut projects = self.projects.lock().unwrap();
        if let Some(project) = projects.get(&root).and_then(Weak::upgrade) {
            return Ok(Subscription {
                service: self.clone(),
                project,
            });
        }
        let project = Arc::new(Project {
            root: root.clone(),
            automatic: std::sync::atomic::AtomicUsize::new(0),
            state: Mutex::new(State::default()),
            _watcher: Mutex::new(None),
        });
        let weak = Arc::downgrade(&project);
        let tx = self.tx.clone();
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                let Some(project) = weak.upgrade() else {
                    return;
                };
                match event {
                    Ok(event) => {
                        let config = project::Config::load(&project.root).ok();
                        if project.automatic.load(std::sync::atomic::Ordering::Relaxed) > 0
                            && event
                                .paths
                                .iter()
                                .any(|path| !project::ignored(&project.root, path, config.as_ref()))
                        {
                            let _ = tx.send(Command::Build(Arc::downgrade(&project), false));
                        }
                    }
                    Err(error) => {
                        let mut state = project.state.lock().unwrap();
                        state.sequence += 1;
                        state.status = "error".into();
                        state.message = format!("Filesystem watcher failed: {error}");
                    }
                }
            })?;
        watcher.watch(&root, RecursiveMode::Recursive)?;
        *project._watcher.lock().unwrap() = Some(watcher);
        projects.insert(root, Arc::downgrade(&project));
        self.tx
            .send(Command::Build(Arc::downgrade(&project), true))?;
        Ok(Subscription {
            service: self.clone(),
            project,
        })
    }
}
impl Drop for Service {
    fn drop(&mut self) {
        let _ = self.tx.send(Command::Stop);
        if let Some(thread) = self.thread.lock().unwrap().take() {
            let _ = thread.join();
        }
    }
}
pub struct Subscription {
    pub service: Arc<Service>,
    pub project: Arc<Project>,
}
impl Subscription {
    pub fn request(&self) {
        let _ = self
            .service
            .tx
            .send(Command::Build(Arc::downgrade(&self.project), true));
    }
}
fn worker(rx: mpsc::Receiver<Command>) {
    while let Ok(command) = rx.recv() {
        let mut pending = HashMap::new();
        let mut add = |command| match command {
            Command::Stop => false,
            Command::Build(weak, force) => {
                if let Some(p) = Weak::<Project>::upgrade(&weak) {
                    let slot = pending.entry(p.root.clone()).or_insert((weak, false));
                    slot.1 |= force;
                }
                true
            }
        };
        if !add(command) {
            return;
        }
        loop {
            match rx.recv_timeout(Duration::from_millis(90)) {
                Ok(command) => {
                    if !add(command) {
                        return;
                    }
                }
                Err(_) => break,
            }
        }
        for (weak, force) in pending.into_values() {
            let Some(project) = weak.upgrade() else {
                continue;
            };
            if !force {
                if let Ok(config) = project::Config::load(&project.root) {
                    if let Ok(files) = project::snapshot(&project.root, &config) {
                        if project::revision(&files) == project.state.lock().unwrap().revision {
                            continue;
                        }
                    }
                }
            }
            {
                let mut state = project.state.lock().unwrap();
                state.sequence += 1;
                state.status = "building".into();
                state.message = "Checking and bundling…".into();
            }
            let result = std::panic::catch_unwind(|| {
                loop {
                    let result = build::build(&project.root, false)?;
                    if result.state != "stale" {
                        break Ok::<_, anyhow::Error>(result);
                    }
                }
            });
            let mut state = project.state.lock().unwrap();
            state.sequence += 1;
            match result {
                Ok(Ok(result)) => {
                    state.status = result.state.clone();
                    state.revision = result.revision.clone();
                    state.message = if result.diagnostics.is_empty() {
                        format!(
                            "Ready ({:.0} ms), revision {}",
                            result.elapsed_ms,
                            &result.revision[..12]
                        )
                    } else {
                        result
                            .diagnostics
                            .iter()
                            .map(|d| {
                                format!(
                                    "{}:{}:{} TS{} {}",
                                    d.file.as_deref().unwrap_or(""),
                                    d.line.unwrap_or(0),
                                    d.column.unwrap_or(0),
                                    d.code,
                                    d.message
                                )
                            })
                            .collect::<Vec<_>>()
                            .join("\n")
                    };
                    state.json = serde_json::to_string(&result).unwrap();
                    if result.state == "ready" {
                        state.bundles = result.bundles;
                    }
                }
                Ok(Err(error)) => {
                    state.status = "error".into();
                    state.message = format!("{error:#}");
                    state.json=serde_json::json!({"state":"error","message":state.message,"sequence":state.sequence}).to_string();
                }
                Err(_) => {
                    state.status = "error".into();
                    state.message =
                        "Compiler panicked; close project subscriptions before retrying".into();
                }
            }
        }
    }
}

use crate::{build, project};
use anyhow::Result;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::{BTreeSet, HashMap},
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
    key: PathBuf,
    selection: Option<crate::entry_build::Selection>,
    _root_watch: Arc<RootWatch>,
    pub automatic: std::sync::atomic::AtomicUsize,
    pub state: Mutex<State>,
    _watcher: Mutex<Option<RecommendedWatcher>>,
    dependencies: Mutex<Vec<crate::inputs::Dependency>>,
    watched: Mutex<BTreeSet<PathBuf>>,
    tx: mpsc::Sender<Command>,
}
enum Command {
    Build(Weak<Project>, bool),
    Stop,
}
pub struct Service {
    tx: mpsc::Sender<Command>,
    thread: Mutex<Option<thread::JoinHandle<()>>>,
    projects: Mutex<HashMap<PathBuf, Weak<Project>>>,
    roots: Mutex<HashMap<PathBuf, Weak<RootWatch>>>,
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
            roots: Mutex::new(HashMap::new()),
        });
        *weak = Arc::downgrade(&service);
        service
    }
    pub fn subscribe(self: &Arc<Self>, root: &Path) -> Result<Subscription> {
        self.subscribe_selected(&root.canonicalize()?, None)
    }
    pub fn subscribe_file(self: &Arc<Self>, entry: &Path, target: &str) -> Result<Subscription> {
        let selection = crate::entry_build::Selection::discover(entry, target)?;
        self.subscribe_selected(&selection.root.clone(), Some(selection))
    }
    fn subscribe_selected(
        self: &Arc<Self>,
        root: &Path,
        selection: Option<crate::entry_build::Selection>,
    ) -> Result<Subscription> {
        let root = root.to_path_buf();
        let key = selection
            .as_ref()
            .map_or_else(|| root.clone(), |s| s.cache.clone());
        let mut projects = self.projects.lock().unwrap();
        if let Some(project) = projects.get(&key).and_then(Weak::upgrade) {
            return Ok(Subscription {
                service: self.clone(),
                project,
            });
        }
        let root_watch = {
            let mut roots = self.roots.lock().unwrap();
            if let Some(watch) = roots.get(&root).and_then(Weak::upgrade) {
                watch
            } else {
                let watch = Arc::new(RootWatch {
                    watcher: Mutex::new(None),
                    subscribers: Mutex::new(Vec::new()),
                });
                let weak = Arc::downgrade(&watch);
                let mut native =
                    notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                        if let Some(watch) = weak.upgrade() {
                            let mut subscribers = watch.subscribers.lock().unwrap();
                            subscribers.retain(|p| {
                                if let Some(p) = Weak::<Project>::upgrade(p) {
                                    p.event(&event);
                                    true
                                } else {
                                    false
                                }
                            });
                        }
                    })?;
                native.watch(&root, RecursiveMode::Recursive)?;
                *watch.watcher.lock().unwrap() = Some(native);
                roots.insert(root.clone(), Arc::downgrade(&watch));
                watch
            }
        };
        let project = Arc::new(Project {
            root: root.clone(),
            key: key.clone(),
            selection,
            _root_watch: root_watch.clone(),
            automatic: std::sync::atomic::AtomicUsize::new(0),
            state: Mutex::new(State::default()),
            _watcher: Mutex::new(None),
            dependencies: Mutex::new(Vec::new()),
            watched: Mutex::new(BTreeSet::new()),
            tx: self.tx.clone(),
        });
        let weak = Arc::downgrade(&project);
        let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            if let Some(project) = weak.upgrade() {
                project.event(&event);
            }
        })?;
        *project._watcher.lock().unwrap() = Some(watcher);
        root_watch
            .subscribers
            .lock()
            .unwrap()
            .push(Arc::downgrade(&project));
        projects.insert(key, Arc::downgrade(&project));
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
                    let slot = pending.entry(p.key.clone()).or_insert((weak, false));
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
                let dependencies = project.dependencies.lock().unwrap();
                let source_revision =
                    std::fs::read_to_string(project.root.join(".avtools/source-revision.txt"))
                        .unwrap_or_default();
                if !dependencies.is_empty()
                    && dependencies.iter().all(crate::inputs::Dependency::current)
                {
                    if project.selection.is_some() {
                        continue;
                    }
                    if let Ok(config) = project::Config::load(&project.root) {
                        if let Ok(files) = project::snapshot(&project.root, &config) {
                            if project::revision(&files) == source_revision {
                                continue;
                            }
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
                    let result = if let Some(selection) = &project.selection {
                        crate::entry_build::build(selection, false)?
                    } else {
                        build::build(&project.root, false)?
                    };
                    if result.state != "stale" {
                        break Ok::<_, anyhow::Error>(result);
                    }
                }
            });
            let watch_error = project.refresh_watches().err();
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
            if let Some(error) = watch_error {
                state.status = "error".into();
                state.message = format!("Dependency watcher failed: {error}");
            }
        }
    }
}

struct RootWatch {
    watcher: Mutex<Option<RecommendedWatcher>>,
    subscribers: Mutex<Vec<Weak<Project>>>,
}
impl Project {
    fn event(self: &Arc<Self>, event: &notify::Result<notify::Event>) {
        match event {
            Ok(event) => {
                if self.automatic.load(std::sync::atomic::Ordering::Relaxed) == 0 {
                    return;
                }
                let config = project::Config::load(&self.root).ok();
                if event.paths.iter().any(|path| {
                    if path.starts_with(self.root.join(".avtools")) {
                        return false;
                    }
                    (!project::ignored(&self.root, path, config.as_ref())
                        && path.starts_with(&self.root))
                        || self
                            .dependencies
                            .lock()
                            .unwrap()
                            .iter()
                            .any(|d| d.affects(path))
                }) {
                    let _ = self.tx.send(Command::Build(Arc::downgrade(self), false));
                }
            }
            Err(error) => {
                let mut state = self.state.lock().unwrap();
                state.sequence += 1;
                state.status = "error".into();
                state.message = format!("Filesystem watcher failed: {error}");
            }
        }
    }
    fn refresh_watches(self: &Arc<Self>) -> Result<()> {
        let path = self.selection.as_ref().map_or_else(
            || self.root.join(".avtools/dependencies.json"),
            |s| s.cache.join("dependencies.json"),
        );
        if !path.exists() {
            return Ok(());
        }
        let dependencies: Vec<crate::inputs::Dependency> =
            serde_json::from_slice(&std::fs::read(path)?)?;
        let mut wanted = BTreeSet::new();
        for dependency in &dependencies {
            let resolved = dependency.resolved.as_ref().unwrap_or(&dependency.path);
            if resolved.starts_with(&self.root) {
                continue;
            }
            // Resolver probes include / and every ancestor's package metadata.
            // Do not subscribe whole filesystem roots for these incidental probes.
            if matches!(
                dependency.kind,
                crate::inputs::Kind::Realpath | crate::inputs::Kind::SymlinkMetadata
            ) {
                continue;
            }
            if dependency.kind == crate::inputs::Kind::Metadata && dependency.path.is_dir() {
                continue;
            }
            let mut parent = resolved.parent();
            while let Some(p) = parent {
                if p.is_dir() {
                    if p.components().count() > 2 {
                        wanted.insert(p.canonicalize()?);
                    }
                    break;
                }
                parent = p.parent();
            }
        }
        let mut watcher = self._watcher.lock().unwrap();
        let mut watched = self.watched.lock().unwrap();
        if *watched != wanted {
            if let Some(watcher) = watcher.as_mut() {
                let mut changes = watcher.paths_mut();
                for path in wanted.difference(&watched) {
                    changes.add(path, RecursiveMode::NonRecursive)?;
                }
                for path in watched.difference(&wanted) {
                    changes.remove(path)?;
                }
                changes.commit()?;
            }
        }
        *watched = wanted;
        let changed = !dependencies.iter().all(crate::inputs::Dependency::current);
        *self.dependencies.lock().unwrap() = dependencies;
        if changed {
            let _ = self.tx.send(Command::Build(Arc::downgrade(self), false));
        }
        Ok(())
    }
}

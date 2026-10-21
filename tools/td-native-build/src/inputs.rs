//! One immutable, lazily populated filesystem view shared by checking and bundling.
//! Paths retain their real locations: package resolution and symlinks behave normally.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs, io,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Kind {
    Read,
    Metadata,
    SymlinkMetadata,
    Link,
    Realpath,
    Directory,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Dependency {
    pub path: PathBuf,
    pub kind: Kind,
    pub digest: String,
    pub resolved: Option<PathBuf>,
}
#[derive(Clone, Debug, Default)]
pub struct Inputs {
    inner: Arc<Mutex<Inner>>,
}
#[derive(Debug, Default)]
struct Inner {
    values: BTreeMap<(PathBuf, Kind), Option<Vec<u8>>>,
    generated: BTreeMap<PathBuf, Vec<u8>>,
    generated_root: Option<PathBuf>,
    generated_reads: BTreeSet<PathBuf>,
}
fn normalize(path: &Path) -> PathBuf {
    PathBuf::from(tsrs_core::tspath::normalize_path(&path.to_string_lossy()))
}
fn observe(path: &Path, kind: Kind) -> Option<Vec<u8>> {
    match kind {
        Kind::Read => fs::read(path).ok(),
        Kind::Metadata | Kind::SymlinkMetadata => {
            let m = if kind == Kind::Metadata {
                fs::metadata(path)
            } else {
                fs::symlink_metadata(path)
            }
            .ok()?;
            Some(vec![
                m.is_file() as u8,
                m.is_dir() as u8,
                m.is_symlink() as u8,
            ])
        }
        Kind::Link | Kind::Realpath => {
            let p = if kind == Kind::Link {
                fs::read_link(path)
            } else {
                fs::canonicalize(path)
            }
            .ok()?;
            Some(p.to_string_lossy().as_bytes().to_vec())
        }
        Kind::Directory => {
            let mut entries: Vec<(String, bool)> = fs::read_dir(path)
                .ok()?
                .filter_map(|e| {
                    let e = e.ok()?;
                    Some((
                        e.file_name().to_string_lossy().into_owned(),
                        e.path().is_dir(),
                    ))
                })
                .collect();
            entries.sort();
            Some(serde_json::to_vec(&entries).unwrap())
        }
    }
}
fn digest(value: &Option<Vec<u8>>) -> String {
    let mut h = Sha256::new();
    h.update([value.is_some() as u8]);
    if let Some(v) = value {
        h.update(v);
    }
    format!("{:x}", h.finalize())
}
impl Dependency {
    pub fn current(&self) -> bool {
        digest(&observe(&self.path, self.kind)) == self.digest
    }
    pub fn affects(&self, path: &Path) -> bool {
        let path = normalize(path);
        std::iter::once(&self.path)
            .chain(self.resolved.iter())
            .any(|p| {
                path == *p
                    || p.starts_with(&path)
                    || (self.kind == Kind::Directory && path.parent() == Some(p.as_path()))
            })
    }
}
impl Inputs {
    pub fn seed(&self, root: &Path, files: &BTreeMap<PathBuf, Vec<u8>>) {
        let mut inner = self.inner.lock().unwrap();
        for (p, v) in files {
            inner
                .values
                .insert((normalize(&root.join(p)), Kind::Read), Some(v.clone()));
        }
    }
    pub fn generated(&self, root: &Path, directory: &str, files: &BTreeMap<PathBuf, Vec<u8>>) {
        let mut inner = self.inner.lock().unwrap();
        inner.generated_root = Some(root.join(directory));
        inner.generated = files
            .iter()
            .map(|(p, v)| (root.join(p), v.clone()))
            .collect();
    }
    fn get(&self, path: &Path, kind: Kind) -> Option<Vec<u8>> {
        let path = normalize(path);
        let mut inner = self.inner.lock().unwrap();
        if inner
            .generated_root
            .as_ref()
            .is_some_and(|p| path.starts_with(p))
        {
            inner.generated_reads.insert(path.clone());
            let file = inner.generated.get(&path);
            let is_dir = inner
                .generated
                .keys()
                .any(|p| p != &path && p.starts_with(&path));
            return match kind {
                Kind::Read => file.cloned(),
                Kind::Metadata | Kind::SymlinkMetadata => {
                    if file.is_some() || is_dir {
                        Some(vec![file.is_some() as u8, is_dir as u8, 0])
                    } else {
                        None
                    }
                }
                Kind::Realpath => Some(path.to_string_lossy().as_bytes().to_vec()),
                Kind::Link => None,
                Kind::Directory => {
                    let mut entries = BTreeMap::new();
                    for p in inner.generated.keys() {
                        if let Ok(rel) = p.strip_prefix(&path) {
                            if let Some(first) = rel.iter().next() {
                                entries.insert(
                                    first.to_string_lossy().into_owned(),
                                    rel.iter().count() > 1,
                                );
                            }
                        }
                    }
                    Some(serde_json::to_vec(&entries.into_iter().collect::<Vec<_>>()).unwrap())
                }
            };
        }
        inner
            .values
            .entry((path.clone(), kind))
            .or_insert_with(|| observe(&path, kind))
            .clone()
    }
    pub fn generated_reads(&self) -> BTreeSet<PathBuf> {
        self.inner.lock().unwrap().generated_reads.clone()
    }
    pub fn read(&self, path: &Path) -> io::Result<Vec<u8>> {
        self.get(path, Kind::Read)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, path.display().to_string()))
    }
    pub fn text(&self, path: &Path) -> io::Result<String> {
        String::from_utf8(self.read(path)?)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
    }
    pub fn metadata(&self, path: &Path, symlink: bool) -> io::Result<oxc_resolver::FileMetadata> {
        let v = self
            .get(
                path,
                if symlink {
                    Kind::SymlinkMetadata
                } else {
                    Kind::Metadata
                },
            )
            .ok_or(io::ErrorKind::NotFound)?;
        Ok(oxc_resolver::FileMetadata::new(
            v[0] != 0,
            v[1] != 0,
            v[2] != 0,
        ))
    }
    pub fn realpath(&self, path: &Path) -> io::Result<PathBuf> {
        self.path_value(path, Kind::Realpath)
    }
    fn path_value(&self, path: &Path, kind: Kind) -> io::Result<PathBuf> {
        Ok(PathBuf::from(
            String::from_utf8(self.get(path, kind).ok_or(io::ErrorKind::NotFound)?)
                .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?,
        ))
    }
    pub fn entries(&self, path: &Path) -> tsrs_vfs::Entries {
        let mut entries: Vec<(String, bool)> = self
            .get(path, Kind::Directory)
            .and_then(|v| serde_json::from_slice(&v).ok())
            .unwrap_or_default();
        let inner = self.inner.lock().unwrap();
        if let Some(g) = &inner.generated_root {
            if g.parent() == Some(path)
                && !entries
                    .iter()
                    .any(|(n, _)| Some(n.as_str()) == g.file_name().and_then(|n| n.to_str()))
            {
                entries.push((g.file_name().unwrap().to_string_lossy().into_owned(), true));
            }
        }
        let mut result = tsrs_vfs::Entries::default();
        for (n, dir) in entries {
            if dir {
                result.directories.push(n)
            } else {
                result.files.push(n)
            }
        }
        result
    }
    pub fn dependencies(&self) -> Vec<Dependency> {
        self.inner
            .lock()
            .unwrap()
            .values
            .iter()
            .map(|((path, kind), value)| Dependency {
                path: path.clone(),
                kind: *kind,
                digest: digest(value),
                resolved: fs::canonicalize(path).ok(),
            })
            .collect()
    }
    pub fn revision(&self) -> String {
        format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&self.dependencies()).unwrap())
        )
    }
    pub fn current(&self) -> bool {
        self.dependencies().iter().all(Dependency::current)
    }
    pub fn checker_fs(&self) -> impl tsrs_vfs::FS + use<> {
        let read = self.clone();
        let file = self.clone();
        let dir = self.clone();
        let entries = self.clone();
        let real = self.clone();
        let stat = self.clone();
        tsrs_vfs::wrapvfs::wrap(
            tsrs_vfs::osvfs::fs(),
            tsrs_vfs::wrapvfs::Replacements {
                read_file: Some(Box::new(move |p| read.text(Path::new(p)).ok())),
                file_exists: Some(Box::new(move |p| {
                    file.metadata(Path::new(p), false)
                        .is_ok_and(|m| m.is_file())
                })),
                directory_exists: Some(Box::new(move |p| {
                    dir.metadata(Path::new(p), false).is_ok_and(|m| m.is_dir())
                })),
                get_accessible_entries: Some(Box::new(move |p| entries.entries(Path::new(p)))),
                realpath: Some(Box::new(move |p| {
                    real.realpath(Path::new(p))
                        .unwrap_or_else(|_| PathBuf::from(p))
                        .to_string_lossy()
                        .into_owned()
                })),
                stat: Some(Box::new(move |p| {
                    let m = stat.metadata(Path::new(p), false).ok()?;
                    Some(tsrs_vfs::FileInfo {
                        name: Path::new(p).file_name()?.to_string_lossy().into_owned(),
                        size: 0,
                        mode: if m.is_dir() {
                            tsrs_vfs::FileMode::Dir
                        } else {
                            tsrs_vfs::FileMode::None
                        },
                        mod_time: None,
                    })
                })),
                ..Default::default()
            },
        )
    }
}
impl oxc_resolver::FileSystem for Inputs {
    fn new(_yarn_pnp: bool) -> Self {
        Self::default()
    }
    fn read(&self, p: &Path) -> io::Result<Vec<u8>> {
        self.read(p)
    }
    fn read_to_string(&self, p: &Path) -> io::Result<String> {
        self.text(p)
    }
    fn metadata(&self, p: &Path) -> io::Result<oxc_resolver::FileMetadata> {
        self.metadata(p, false)
    }
    fn symlink_metadata(&self, p: &Path) -> io::Result<oxc_resolver::FileMetadata> {
        self.metadata(p, true)
    }
    fn read_link(&self, p: &Path) -> Result<PathBuf, oxc_resolver::ResolveError> {
        self.path_value(p, Kind::Link).map_err(Into::into)
    }
    fn canonicalize(&self, p: &Path) -> io::Result<PathBuf> {
        self.realpath(p)
    }
}

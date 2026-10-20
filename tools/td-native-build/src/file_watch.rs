use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    ffi::{CStr, CString, c_char},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
struct Value {
    source: String,
    error: String,
    sequence: u64,
}
pub struct FileWatch {
    value: Arc<Mutex<Value>>,
    _watcher: RecommendedWatcher,
    sequence: u64,
    source: CString,
    error: CString,
}
fn refresh(path: &Path, value: &Mutex<Value>) {
    let read = std::fs::read_to_string(path);
    let mut value = value.lock().unwrap();
    match read {
        Ok(source) => {
            if source != value.source || !value.error.is_empty() {
                value.sequence += 1;
                value.source = source;
                value.error.clear();
            }
        }
        Err(e) => {
            let error = format!("{}: {e}", path.display());
            if error != value.error {
                value.sequence += 1;
                value.error = error;
            }
        }
    }
}
impl FileWatch {
    fn create(path: PathBuf) -> anyhow::Result<Self> {
        let value = Arc::new(Mutex::new(Value {
            source: String::new(),
            error: String::new(),
            sequence: 0,
        }));
        let state = value.clone();
        let watched = path.clone();
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| match event {
                Ok(e) => {
                    if e.paths
                        .iter()
                        .any(|p| p == &watched || Some(p.as_path()) == watched.parent())
                    {
                        refresh(&watched, &state);
                    }
                }
                Err(e) => {
                    let mut s = state.lock().unwrap();
                    s.error = format!("Bundle watcher failed: {e}");
                    s.sequence += 1;
                }
            })?;
        watcher.watch(
            path.parent()
                .ok_or_else(|| anyhow::anyhow!("Missing parent directory"))?,
            RecursiveMode::NonRecursive,
        )?;
        refresh(&path, &value);
        Ok(Self {
            value,
            _watcher: watcher,
            sequence: u64::MAX,
            source: CString::default(),
            error: CString::default(),
        })
    }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn avb_file_create(path: *const c_char) -> *mut FileWatch {
    std::panic::catch_unwind(|| {
        if path.is_null() {
            return None;
        }
        let path = unsafe { CStr::from_ptr(path) }.to_str().ok()?;
        Some(Box::into_raw(Box::new(
            FileWatch::create(PathBuf::from(path)).ok()?,
        )))
    })
    .ok()
    .flatten()
    .unwrap_or(std::ptr::null_mut())
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn avb_file_poll(handle: *mut FileWatch) -> i32 {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if handle.is_null() {
            return -1;
        }
        let h = unsafe { &mut *handle };
        let Ok(v) = h.value.try_lock() else {
            return 0;
        };
        if h.sequence == v.sequence {
            return 0;
        }
        h.sequence = v.sequence;
        h.source = CString::new(v.source.replace('\0', "�")).unwrap();
        h.error = CString::new(v.error.replace('\0', "�")).unwrap();
        1
    }))
    .unwrap_or(-1)
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn avb_file_source(handle: *const FileWatch) -> *const c_char {
    if handle.is_null() {
        return std::ptr::null();
    }
    unsafe { (*handle).source.as_ptr() }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn avb_file_error(handle: *const FileWatch) -> *const c_char {
    if handle.is_null() {
        return std::ptr::null();
    }
    unsafe { (*handle).error.as_ptr() }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn avb_file_destroy(handle: *mut FileWatch) {
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if !handle.is_null() {
            drop(unsafe { Box::from_raw(handle) });
        }
    }));
}

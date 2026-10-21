//! C ABI owns all handles/returned strings. Poll/getters/destroy for a handle are
//! serialized by its caller; background threads never enter TouchDesigner/V8.
use crate::service::{Service, Subscription};
use std::{
    ffi::{CStr, CString, c_char},
    panic::{AssertUnwindSafe, catch_unwind},
    path::Path,
};
pub struct Handle {
    sub: Subscription,
    entry: String,
    sequence: u64,
    automatic: bool,
    source: CString,
    status: CString,
    message: CString,
}
fn cstring(s: &str) -> CString {
    CString::new(s.replace('\0', "�")).unwrap()
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn avb_subscribe(
    root: *const c_char,
    entry: *const c_char,
    automatic: i32,
) -> *mut Handle {
    if root.is_null() || entry.is_null() {
        return std::ptr::null_mut();
    }
    catch_unwind(|| {
        let root = unsafe { CStr::from_ptr(root) }.to_str().ok()?;
        let entry = unsafe { CStr::from_ptr(entry) }.to_str().ok()?.to_string();
        let sub = Service::shared().subscribe(Path::new(root)).ok()?;
        if automatic != 0 {
            sub.project
                .automatic
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
        Some(Box::into_raw(Box::new(Handle {
            sub,
            entry,
            automatic: automatic != 0,
            sequence: u64::MAX,
            source: cstring(""),
            status: cstring("queued"),
            message: cstring(""),
        })))
    })
    .ok()
    .flatten()
    .unwrap_or(std::ptr::null_mut())
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn avb_poll(handle: *mut Handle) -> i32 {
    if handle.is_null() {
        return -1;
    }
    catch_unwind(AssertUnwindSafe(|| {
        let handle = unsafe { &mut *handle };
        let Ok(state) = handle.sub.project.state.try_lock() else {
            return 0;
        };
        if state.sequence == handle.sequence {
            return 0;
        }
        handle.sequence = state.sequence;
        handle.status = cstring(&state.status);
        handle.message = cstring(&state.message);
        if let Some(source) = state.bundles.get(&handle.entry) {
            handle.source = cstring(source);
        } else if state.status == "ready" {
            handle.message = cstring(&format!("Entry '{}' does not exist", handle.entry));
            handle.status = cstring("error");
        }
        1
    }))
    .unwrap_or(-1)
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn avb_source(handle: *const Handle) -> *const c_char {
    if handle.is_null() {
        return std::ptr::null();
    }
    unsafe { (*handle).source.as_ptr() }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn avb_status(handle: *const Handle) -> *const c_char {
    if handle.is_null() {
        return std::ptr::null();
    }
    unsafe { (*handle).status.as_ptr() }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn avb_message(handle: *const Handle) -> *const c_char {
    if handle.is_null() {
        return std::ptr::null();
    }
    unsafe { (*handle).message.as_ptr() }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn avb_request(handle: *const Handle) {
    let _ = catch_unwind(AssertUnwindSafe(|| {
        if !handle.is_null() {
            unsafe {
                (*handle).sub.request();
            }
        }
    }));
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn avb_destroy(handle: *mut Handle) {
    let _ = catch_unwind(AssertUnwindSafe(|| {
        if !handle.is_null() {
            drop(unsafe { Box::from_raw(handle) });
        }
    }));
}

impl Drop for Handle {
    fn drop(&mut self) {
        if self.automatic {
            self.sub
                .project
                .automatic
                .fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
        }
    }
}

/// Manifest-free subscriptions share an entry build and the enclosing project watcher.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn avb_subscribe_file(
    entry: *const c_char,
    target: *const c_char,
    automatic: i32,
) -> *mut Handle {
    if entry.is_null() || target.is_null() {
        return std::ptr::null_mut();
    }
    catch_unwind(|| {
        let entry = unsafe { CStr::from_ptr(entry) }.to_str().ok()?;
        let target = unsafe { CStr::from_ptr(target) }.to_str().ok()?;
        let sub = Service::shared()
            .subscribe_file(Path::new(entry), target)
            .ok()?;
        if automatic != 0 {
            sub.project
                .automatic
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
        Some(Box::into_raw(Box::new(Handle {
            sub,
            entry: "sketch".into(),
            sequence: u64::MAX,
            automatic: automatic != 0,
            source: cstring(""),
            status: cstring("queued"),
            message: cstring(""),
        })))
    })
    .ok()
    .flatten()
    .unwrap_or(std::ptr::null_mut())
}
/// Explicit file creation; error text copied to caller storage. Never overwrites content.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn avb_init(root: *const c_char, error: *mut c_char, capacity: usize) -> i32 {
    let result = catch_unwind(|| -> anyhow::Result<()> {
        if root.is_null() {
            anyhow::bail!("Choose a Template Directory first");
        }
        let root = unsafe { CStr::from_ptr(root) }.to_str()?;
        if root.is_empty() {
            anyhow::bail!("Choose a Template Directory first");
        }
        crate::template::create(Path::new(root))
    });
    let message = match result {
        Ok(Ok(())) => return 1,
        Ok(Err(e)) => format!("{e:#}"),
        Err(_) => "Template creation failed".into(),
    };
    if !error.is_null() && capacity > 0 {
        let bytes = message.as_bytes();
        let n = bytes.len().min(capacity - 1);
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), error.cast(), n);
            *error.add(n) = 0;
        }
    }
    0
}

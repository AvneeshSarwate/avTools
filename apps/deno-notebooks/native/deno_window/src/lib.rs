use serde::Serialize;
use std::cell::RefCell;
use std::collections::HashMap;
use std::ptr;
use std::slice;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use winit::application::ApplicationHandler;
use winit::dpi::{LogicalSize, PhysicalSize};
use winit::event::{ElementState, MouseButton, MouseScrollDelta, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::keyboard::Key;
use winit::platform::pump_events::EventLoopExtPumpEvents;
use winit::raw_window_handle_05::{
    HasRawDisplayHandle, HasRawWindowHandle, RawDisplayHandle, RawWindowHandle,
};
use winit::window::{Window, WindowId};

#[cfg(target_os = "macos")]
use wry::WebViewBuilder;

#[derive(Serialize)]
#[serde(tag = "type")]
enum WindowEventRecord {
    #[serde(rename = "key")]
    Key { key: String, down: bool },
    #[serde(rename = "mouse_move")]
    MouseMove { x: f64, y: f64 },
    #[serde(rename = "mouse_button")]
    MouseButton {
        button: u32,
        down: bool,
        x: f64,
        y: f64,
    },
    #[serde(rename = "scroll")]
    Scroll { dx: f64, dy: f64 },
    #[serde(rename = "resize")]
    Resize { width: u32, height: u32 },
    #[serde(rename = "close")]
    Close,
}

struct WindowSlot {
    window: Option<Window>,
    window_id: Option<WindowId>,
    width: u32,
    height: u32,
    title: String,
    hide_on_close: bool,
    events: Vec<WindowEventRecord>,
    last_cursor: (f64, f64),
    should_close: bool,
    cached_window_handle: usize,
    cached_display_handle: usize,
    cached_window_system: u32,
}

impl WindowSlot {
    fn debug_enabled() -> bool {
        std::env::var("DENO_WINDOW_DEBUG").is_ok()
    }

    fn debug_log_handles(&self, label: &str) {
        if Self::debug_enabled() {
            eprintln!(
                "[deno_window] {label} window_handle=0x{:x} display_handle=0x{:x} system={}",
                self.cached_window_handle, self.cached_display_handle, self.cached_window_system
            );
        }
    }

    fn new(width: u32, height: u32, title: String, hide_on_close: bool) -> Self {
        Self {
            window: None,
            window_id: None,
            width,
            height,
            title,
            hide_on_close,
            events: Vec::new(),
            last_cursor: (0.0, 0.0),
            should_close: false,
            cached_window_handle: 0,
            cached_display_handle: 0,
            cached_window_system: 0,
        }
    }

    fn ensure_window(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() || self.should_close {
            return;
        }

        let attrs = Window::default_attributes()
            .with_title(self.title.clone())
            .with_inner_size(LogicalSize::new(self.width as f64, self.height as f64));
        match event_loop.create_window(attrs) {
            Ok(window) => {
                self.window_id = Some(window.id());
                let win_handle = window.raw_window_handle();
                let display_handle = window.raw_display_handle();
                self.cached_window_handle = handle_from_raw_window(win_handle);
                self.cached_display_handle = handle_from_raw_display(display_handle);
                self.cached_window_system = window_system_id(win_handle, display_handle);
                self.debug_log_handles("ensure_window");
                self.window = Some(window);
            }
            Err(err) => {
                eprintln!("Failed to create window: {err}");
            }
        }
    }

    fn record_key(&mut self, key: Key, down: bool) {
        let key_str = match key {
            Key::Character(text) => text.to_string(),
            other => format!("{other:?}"),
        };
        self.events
            .push(WindowEventRecord::Key { key: key_str, down });
    }

    fn record_resize(&mut self, size: PhysicalSize<u32>) {
        self.width = size.width;
        self.height = size.height;
        self.events.push(WindowEventRecord::Resize {
            width: size.width,
            height: size.height,
        });
    }

    fn take_events_json(&mut self) -> Vec<u8> {
        if self.events.is_empty() {
            return Vec::new();
        }
        let json = serde_json::to_string(&self.events).unwrap_or_else(|_| "[]".to_string());
        self.events.clear();
        json.into_bytes()
    }
}

struct MultiWindowApp {
    windows: HashMap<u64, WindowSlot>,
    window_id_to_token: HashMap<WindowId, u64>,
}

impl MultiWindowApp {
    fn new() -> Self {
        Self {
            windows: HashMap::new(),
            window_id_to_token: HashMap::new(),
        }
    }

    fn insert_window(
        &mut self,
        token: u64,
        width: u32,
        height: u32,
        title: String,
        hide_on_close: bool,
    ) {
        self.windows
            .insert(token, WindowSlot::new(width, height, title, hide_on_close));
    }

    fn remove_window(&mut self, token: u64) {
        if let Some(mut slot) = self.windows.remove(&token) {
            if let Some(window_id) = slot.window_id.take() {
                self.window_id_to_token.remove(&window_id);
            }
            slot.window = None;
        }
    }

    fn window_is_ready(&self, token: u64) -> bool {
        self.windows
            .get(&token)
            .map(|slot| slot.window.is_some() || slot.should_close)
            .unwrap_or(false)
    }

    fn ensure_windows(&mut self, event_loop: &ActiveEventLoop) {
        let pending: Vec<u64> = self
            .windows
            .iter()
            .filter_map(|(token, slot)| {
                if slot.window.is_none() && !slot.should_close {
                    Some(*token)
                } else {
                    None
                }
            })
            .collect();

        for token in pending {
            if let Some(slot) = self.windows.get_mut(&token) {
                slot.ensure_window(event_loop);
                if let Some(window_id) = slot.window_id {
                    self.window_id_to_token.insert(window_id, token);
                }
            }
        }
    }
}

impl ApplicationHandler for MultiWindowApp {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        event_loop.set_control_flow(ControlFlow::Poll);
        self.ensure_windows(event_loop);
    }

    fn window_event(
        &mut self,
        _event_loop: &ActiveEventLoop,
        window_id: WindowId,
        event: WindowEvent,
    ) {
        let Some(token) = self.window_id_to_token.get(&window_id).copied() else {
            return;
        };
        let Some(slot) = self.windows.get_mut(&token) else {
            return;
        };

        match event {
            WindowEvent::CloseRequested => {
                if slot.hide_on_close {
                    if let Some(window) = slot.window.as_ref() {
                        window.set_visible(false);
                    }
                    return;
                }
                slot.events.push(WindowEventRecord::Close);
                slot.should_close = true;
                if let Some(existing_id) = slot.window_id.take() {
                    self.window_id_to_token.remove(&existing_id);
                }
                slot.window = None;
            }
            WindowEvent::Resized(size) => slot.record_resize(size),
            WindowEvent::ScaleFactorChanged { .. } => {
                if let Some(window) = slot.window.as_ref() {
                    slot.record_resize(window.inner_size());
                }
            }
            WindowEvent::CursorMoved { position, .. } => {
                slot.last_cursor = (position.x, position.y);
                slot.events.push(WindowEventRecord::MouseMove {
                    x: position.x,
                    y: position.y,
                });
            }
            WindowEvent::MouseInput { state, button, .. } => {
                let button_id = match button {
                    MouseButton::Left => 0,
                    MouseButton::Right => 1,
                    MouseButton::Middle => 2,
                    MouseButton::Other(id) => id as u32,
                    _ => 0,
                };
                let down = matches!(state, ElementState::Pressed);
                let (x, y) = slot.last_cursor;
                slot.events.push(WindowEventRecord::MouseButton {
                    button: button_id,
                    down,
                    x,
                    y,
                });
            }
            WindowEvent::MouseWheel { delta, .. } => {
                let (dx, dy) = match delta {
                    MouseScrollDelta::LineDelta(x, y) => (x as f64, y as f64),
                    MouseScrollDelta::PixelDelta(pos) => (pos.x, pos.y),
                };
                slot.events.push(WindowEventRecord::Scroll { dx, dy });
            }
            WindowEvent::KeyboardInput { event, .. } => {
                let down = matches!(event.state, ElementState::Pressed);
                slot.record_key(event.logical_key, down);
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        self.ensure_windows(event_loop);
    }
}

struct GlobalRuntime {
    event_loop: EventLoop<()>,
    app: MultiWindowApp,
    next_token: u64,
}

impl GlobalRuntime {
    fn new(event_loop: EventLoop<()>) -> Self {
        Self {
            event_loop,
            app: MultiWindowApp::new(),
            next_token: 1,
        }
    }

    fn allocate_token(&mut self) -> u64 {
        let token = self.next_token;
        self.next_token = self.next_token.saturating_add(1);
        token
    }
}

thread_local! {
    static GLOBAL_RUNTIME: RefCell<Option<GlobalRuntime>> = const { RefCell::new(None) };
}

#[repr(C)]
pub struct WindowState {
    token: u64,
}

fn pump_once(runtime: &mut GlobalRuntime) {
    let _ = runtime
        .event_loop
        .pump_app_events(Some(Duration::ZERO), &mut runtime.app);
}

fn pump_for_webview(runtime: &mut GlobalRuntime) {
    let _ = runtime
        .event_loop
        .pump_app_events(Some(Duration::from_millis(1)), &mut runtime.app);
}

fn state_token(state: *mut WindowState) -> Option<u64> {
    if state.is_null() {
        return None;
    }
    Some(unsafe { (*state).token })
}

fn handle_from_raw_window(handle: RawWindowHandle) -> usize {
    match handle {
        RawWindowHandle::AppKit(handle) => handle.ns_view as usize,
        RawWindowHandle::UiKit(handle) => handle.ui_view as usize,
        RawWindowHandle::Wayland(handle) => handle.surface as usize,
        RawWindowHandle::Xcb(handle) => handle.window as usize,
        RawWindowHandle::Xlib(handle) => handle.window as usize,
        RawWindowHandle::Win32(handle) => handle.hwnd as usize,
        RawWindowHandle::WinRt(handle) => handle.core_window as usize,
        _ => 0,
    }
}

fn handle_from_raw_display(handle: RawDisplayHandle) -> usize {
    match handle {
        RawDisplayHandle::Wayland(handle) => handle.display as usize,
        RawDisplayHandle::Xcb(handle) => handle.connection as usize,
        RawDisplayHandle::Xlib(handle) => handle.display as usize,
        _ => 0,
    }
}

fn window_system_id(handle: RawWindowHandle, display: RawDisplayHandle) -> u32 {
    match (handle, display) {
        (RawWindowHandle::AppKit(_), _) | (RawWindowHandle::UiKit(_), _) => 0,
        (_, RawDisplayHandle::Wayland(_)) | (RawWindowHandle::Wayland(_), _) => 2,
        (_, RawDisplayHandle::Xcb(_))
        | (_, RawDisplayHandle::Xlib(_))
        | (RawWindowHandle::Xcb(_), _)
        | (RawWindowHandle::Xlib(_), _) => 1,
        _ => 0,
    }
}

#[no_mangle]
pub extern "C" fn create_window(
    width: u32,
    height: u32,
    title_ptr: *const u8,
    title_len: u32,
) -> *mut WindowState {
    let title = if title_ptr.is_null() || title_len == 0 {
        "Deno Window".to_string()
    } else {
        let slice = unsafe { slice::from_raw_parts(title_ptr, title_len as usize) };
        String::from_utf8_lossy(slice).to_string()
    };

    GLOBAL_RUNTIME.with(|cell| {
        let mut runtime_opt = cell.borrow_mut();
        if runtime_opt.is_none() {
            let event_loop = match EventLoop::new() {
                Ok(loop_handle) => loop_handle,
                Err(err) => {
                    eprintln!("Failed to create event loop: {err}");
                    return ptr::null_mut();
                }
            };
            *runtime_opt = Some(GlobalRuntime::new(event_loop));
        }

        let runtime = runtime_opt.as_mut().expect("runtime initialized");
        let token = runtime.allocate_token();
        runtime
            .app
            .insert_window(token, width, height, title, false);

        // Pump a few times to ensure the window is created.
        for _ in 0..8 {
            pump_once(runtime);
            if runtime.app.window_is_ready(token) {
                break;
            }
        }

        Box::into_raw(Box::new(WindowState { token }))
    })
}

#[no_mangle]
pub extern "C" fn get_raw_window_handle(state: *mut WindowState) -> usize {
    let Some(token) = state_token(state) else {
        return 0;
    };

    GLOBAL_RUNTIME.with(|cell| {
        let mut runtime_opt = cell.borrow_mut();
        let Some(runtime) = runtime_opt.as_mut() else {
            return 0;
        };

        for _ in 0..2 {
            let cached = runtime
                .app
                .windows
                .get(&token)
                .map(|slot| slot.cached_window_handle)
                .unwrap_or(0);
            if cached != 0 {
                return cached;
            }
            pump_once(runtime);
        }
        0
    })
}

#[no_mangle]
pub extern "C" fn get_raw_display_handle(state: *mut WindowState) -> usize {
    let Some(token) = state_token(state) else {
        return 0;
    };

    GLOBAL_RUNTIME.with(|cell| {
        let mut runtime_opt = cell.borrow_mut();
        let Some(runtime) = runtime_opt.as_mut() else {
            return 0;
        };

        for _ in 0..2 {
            let cached = runtime
                .app
                .windows
                .get(&token)
                .map(|slot| slot.cached_display_handle)
                .unwrap_or(0);
            if cached != 0 {
                return cached;
            }
            pump_once(runtime);
        }
        0
    })
}

#[no_mangle]
pub extern "C" fn get_window_system(state: *mut WindowState) -> u32 {
    let Some(token) = state_token(state) else {
        return 0;
    };

    GLOBAL_RUNTIME.with(|cell| {
        let mut runtime_opt = cell.borrow_mut();
        let Some(runtime) = runtime_opt.as_mut() else {
            return 0;
        };

        let has_window = runtime
            .app
            .windows
            .get(&token)
            .map(|slot| slot.window.is_some())
            .unwrap_or(false);
        if !has_window {
            pump_once(runtime);
        }

        let cached = runtime
            .app
            .windows
            .get(&token)
            .map(|slot| slot.cached_window_system)
            .unwrap_or(0);
        if cached != 0 {
            return cached;
        }

        pump_once(runtime);
        runtime
            .app
            .windows
            .get(&token)
            .map(|slot| slot.cached_window_system)
            .unwrap_or(0)
    })
}

#[no_mangle]
pub extern "C" fn poll_events(state: *mut WindowState, buf_ptr: *mut u8, buf_cap: u32) -> u32 {
    let Some(token) = state_token(state) else {
        return 0;
    };

    GLOBAL_RUNTIME.with(|cell| {
        let mut runtime_opt = cell.borrow_mut();
        let Some(runtime) = runtime_opt.as_mut() else {
            return 0;
        };

        pump_once(runtime);
        let payload = runtime
            .app
            .windows
            .get_mut(&token)
            .map(WindowSlot::take_events_json)
            .unwrap_or_default();
        if payload.is_empty() || buf_ptr.is_null() || buf_cap == 0 {
            return 0;
        }
        if payload.len() > buf_cap as usize {
            return 0;
        }
        unsafe {
            ptr::copy_nonoverlapping(payload.as_ptr(), buf_ptr, payload.len());
        }
        payload.len() as u32
    })
}

#[no_mangle]
pub extern "C" fn resize_window(state: *mut WindowState, width: u32, height: u32) {
    let Some(token) = state_token(state) else {
        return;
    };

    GLOBAL_RUNTIME.with(|cell| {
        let mut runtime_opt = cell.borrow_mut();
        let Some(runtime) = runtime_opt.as_mut() else {
            return;
        };

        if let Some(slot) = runtime.app.windows.get_mut(&token) {
            slot.width = width;
            slot.height = height;
            if let Some(window) = slot.window.as_ref() {
                let _ = window.request_inner_size(LogicalSize::new(width as f64, height as f64));
            }
        }
    });
}

#[no_mangle]
pub extern "C" fn get_window_size(state: *mut WindowState, out_w: *mut u32, out_h: *mut u32) {
    if out_w.is_null() || out_h.is_null() {
        return;
    }
    let Some(token) = state_token(state) else {
        return;
    };

    GLOBAL_RUNTIME.with(|cell| {
        let mut runtime_opt = cell.borrow_mut();
        let Some(runtime) = runtime_opt.as_mut() else {
            return;
        };

        if let Some(slot) = runtime.app.windows.get_mut(&token) {
            if let Some(window) = slot.window.as_ref() {
                let size = window.inner_size();
                slot.width = size.width;
                slot.height = size.height;
            }
            unsafe {
                *out_w = slot.width;
                *out_h = slot.height;
            }
        }
    });
}

#[no_mangle]
pub extern "C" fn destroy_window(state: *mut WindowState) {
    let Some(token) = state_token(state) else {
        return;
    };

    GLOBAL_RUNTIME.with(|cell| {
        let mut runtime_opt = cell.borrow_mut();
        if let Some(runtime) = runtime_opt.as_mut() {
            runtime.app.remove_window(token);
        }
    });

    unsafe {
        drop(Box::from_raw(state));
    }
}

// ── Webview (wry) FFI ──────────────────────────────────────────────────
//
// GPU windows cannot host a child WKWebView on macOS once WebGPU installs a
// CAMetalLayer. Instead, create a second ordinary winit window and attach the
// webview as a child of that window's content view. This keeps winit in charge
// of the native window while avoiding wry's non-child `build()` path, which
// replaces the content view and conflicts with winit.

#[cfg(target_os = "macos")]
mod webview_impl {
    use super::*;
    use wry::{
        dpi::{LogicalPosition as WebLogicalPosition, LogicalSize as WebLogicalSize},
        Rect,
    };

    pub struct WebviewState {
        pub token: u64,
        pub webview: Option<wry::WebView>,
        pub ipc_buffer: Arc<Mutex<Vec<String>>>,
    }

    fn bounds_for_size(width: u32, height: u32) -> Rect {
        Rect {
            position: WebLogicalPosition::new(0, 0).into(),
            size: WebLogicalSize::new(width, height).into(),
        }
    }

    fn logical_size_for_window(window: &Window, fallback_width: u32, fallback_height: u32) -> (u32, u32) {
        let size = window.inner_size();
        if size.width == 0 || size.height == 0 {
            return (fallback_width, fallback_height);
        }
        let logical = size.to_logical::<u32>(window.scale_factor());
        (logical.width, logical.height)
    }

    pub fn create(
        runtime: &mut GlobalRuntime,
        html: &str,
        width: u32,
        height: u32,
        title: &str,
    ) -> Option<Box<WebviewState>> {
        let webview_debug = std::env::var("DENO_WINDOW_WEBVIEW_DEBUG").is_ok();
        let token = runtime.allocate_token();
        runtime
            .app
            .insert_window(token, width, height, title.to_string(), true);

        for _ in 0..8 {
            pump_once(runtime);
            if runtime.app.window_is_ready(token) {
                break;
            }
        }

        let ipc_buffer: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let ipc_buf_clone = ipc_buffer.clone();
        let result = {
            let Some(slot) = runtime.app.windows.get(&token) else {
                eprintln!("[deno_window] create_webview: panel slot missing");
                runtime.app.remove_window(token);
                return None;
            };
            let Some(window) = slot.window.as_ref() else {
                eprintln!("[deno_window] create_webview: panel window was not created");
                runtime.app.remove_window(token);
                return None;
            };

            let (logical_width, logical_height) = logical_size_for_window(window, width, height);
            let bounds = bounds_for_size(logical_width, logical_height);

            let mut builder =
                WebViewBuilder::new()
                    .with_bounds(bounds)
                    .with_ipc_handler(move |request| {
                        if let Ok(mut buf) = ipc_buf_clone.lock() {
                            buf.push(request.body().to_string());
                        }
                    });

            if webview_debug {
                builder = builder.with_on_page_load_handler(|event, url| {
                    let label = match event {
                        wry::PageLoadEvent::Started => "started",
                        wry::PageLoadEvent::Finished => "finished",
                    };
                    eprintln!("[deno_window] webview page load: {label} {url}");
                });
            }

            builder.with_html(html).build_as_child(window)
        };

        match result {
            Ok(webview) => {
                let _ = webview.focus();
                pump_once(runtime);
                Some(Box::new(WebviewState {
                    token,
                    webview: Some(webview),
                    ipc_buffer,
                }))
            }
            Err(err) => {
                eprintln!("[deno_window] create_webview: build failed: {err}");
                runtime.app.remove_window(token);
                None
            }
        }
    }

    pub fn sync_bounds(runtime: &mut GlobalRuntime, state: &WebviewState) {
        let Some(webview) = state.webview.as_ref() else {
            return;
        };
        let Some(slot) = runtime.app.windows.get_mut(&state.token) else {
            return;
        };
        let Some(window) = slot.window.as_ref() else {
            return;
        };

        let (logical_width, logical_height) = logical_size_for_window(window, slot.width, slot.height);
        slot.width = logical_width;
        slot.height = logical_height;

        let _ = webview.set_bounds(bounds_for_size(logical_width, logical_height));
    }

    pub fn set_window_size(runtime: &mut GlobalRuntime, state: &WebviewState, width: u32, height: u32) {
        let Some(slot) = runtime.app.windows.get_mut(&state.token) else {
            return;
        };
        let Some(window) = slot.window.as_ref() else {
            return;
        };

        slot.width = width;
        slot.height = height;
        let _ = window.request_inner_size(LogicalSize::new(width as f64, height as f64));
    }

    pub fn set_window_visible(runtime: &mut GlobalRuntime, token: u64, visible: bool) {
        let Some(slot) = runtime.app.windows.get(&token) else {
            return;
        };
        let Some(window) = slot.window.as_ref() else {
            return;
        };

        window.set_visible(visible);
        if visible {
            window.focus_window();
        }
    }

    pub fn destroy(runtime: &mut GlobalRuntime, token: u64) {
        runtime.app.remove_window(token);
    }
}

#[cfg(target_os = "macos")]
use webview_impl::WebviewState;

#[cfg(not(target_os = "macos"))]
pub struct WebviewState;

#[cfg(target_os = "macos")]
#[no_mangle]
pub extern "C" fn create_webview(
    _parent_state: *mut WindowState,
    html_ptr: *const u8,
    html_len: u32,
    width: u32,
    height: u32,
    title_ptr: *const u8,
    title_len: u32,
) -> *mut WebviewState {
    if html_ptr.is_null() || html_len == 0 {
        return ptr::null_mut();
    }
    let html = unsafe {
        let slice = slice::from_raw_parts(html_ptr, html_len as usize);
        match std::str::from_utf8(slice) {
            Ok(s) => s,
            Err(_) => return ptr::null_mut(),
        }
    };
    let title = if title_ptr.is_null() || title_len == 0 {
        "Controls"
    } else {
        let slice = unsafe { slice::from_raw_parts(title_ptr, title_len as usize) };
        std::str::from_utf8(slice).unwrap_or("Controls")
    };

    GLOBAL_RUNTIME.with(|cell| {
        let mut runtime_opt = cell.borrow_mut();
        if runtime_opt.is_none() {
            let event_loop = match EventLoop::new() {
                Ok(loop_handle) => loop_handle,
                Err(err) => {
                    eprintln!("Failed to create event loop: {err}");
                    return ptr::null_mut();
                }
            };
            *runtime_opt = Some(GlobalRuntime::new(event_loop));
        }

        let runtime = runtime_opt.as_mut().expect("runtime initialized");
        match webview_impl::create(runtime, html, width, height, title) {
            Some(state) => Box::into_raw(state),
            None => ptr::null_mut(),
        }
    })
}

#[cfg(not(target_os = "macos"))]
#[no_mangle]
pub extern "C" fn create_webview(
    _parent_state: *mut WindowState,
    _html_ptr: *const u8,
    _html_len: u32,
    _width: u32,
    _height: u32,
    _title_ptr: *const u8,
    _title_len: u32,
) -> *mut WebviewState {
    ptr::null_mut()
}

#[cfg(target_os = "macos")]
#[no_mangle]
pub extern "C" fn webview_evaluate_script(
    state: *mut WebviewState,
    js_ptr: *const u8,
    js_len: u32,
) -> u32 {
    if state.is_null() || js_ptr.is_null() || js_len == 0 {
        return 0;
    }
    let js = unsafe {
        let slice = slice::from_raw_parts(js_ptr, js_len as usize);
        match std::str::from_utf8(slice) {
            Ok(s) => s,
            Err(_) => return 0,
        }
    };
    let wv_state = unsafe { &*state };
    let Some(webview) = wv_state.webview.as_ref() else {
        return 0;
    };
    match webview.evaluate_script(js) {
        Ok(()) => 1,
        Err(err) => {
            eprintln!("[deno_window] evaluate_script failed: {err}");
            0
        }
    }
}

#[cfg(not(target_os = "macos"))]
#[no_mangle]
pub extern "C" fn webview_evaluate_script(
    _state: *mut WebviewState,
    _js_ptr: *const u8,
    _js_len: u32,
) -> u32 {
    0
}

#[no_mangle]
pub extern "C" fn webview_poll_ipc(
    state: *mut WebviewState,
    buf_ptr: *mut u8,
    buf_cap: u32,
) -> u32 {
    if state.is_null() || buf_ptr.is_null() || buf_cap == 0 {
        return 0;
    }
    let wv_state = unsafe { &*state };
    let mut ipc = match wv_state.ipc_buffer.lock() {
        Ok(guard) => guard,
        Err(_) => return 0,
    };
    if ipc.is_empty() {
        return 0;
    }
    let joined = ipc.join("\n");
    ipc.clear();
    drop(ipc);
    let bytes = joined.as_bytes();
    if bytes.len() > buf_cap as usize {
        return 0;
    }
    unsafe {
        ptr::copy_nonoverlapping(bytes.as_ptr(), buf_ptr, bytes.len());
    }
    bytes.len() as u32
}

#[cfg(target_os = "macos")]
#[no_mangle]
pub extern "C" fn webview_set_visible(state: *mut WebviewState, visible: u32) {
    if state.is_null() {
        return;
    }
    let wv_state = unsafe { &*state };
    GLOBAL_RUNTIME.with(|cell| {
        let mut runtime_opt = cell.borrow_mut();
        let Some(runtime) = runtime_opt.as_mut() else {
            return;
        };
        let should_show = visible != 0;
        webview_impl::set_window_visible(runtime, wv_state.token, should_show);
        if should_show {
            if let Some(webview) = wv_state.webview.as_ref() {
                let _ = webview.focus();
            }
        }
    });
}

#[cfg(not(target_os = "macos"))]
#[no_mangle]
pub extern "C" fn webview_set_visible(_state: *mut WebviewState, _visible: u32) {}

#[cfg(target_os = "macos")]
#[no_mangle]
pub extern "C" fn webview_pump() {
    GLOBAL_RUNTIME.with(|cell| {
        let mut runtime_opt = cell.borrow_mut();
        let Some(runtime) = runtime_opt.as_mut() else {
            return;
        };
        pump_for_webview(runtime);
    });

    unsafe {
        core_foundation::runloop::CFRunLoopRunInMode(
            core_foundation::runloop::kCFRunLoopDefaultMode,
            0.002,
            0,
        );
    }
}

#[cfg(not(target_os = "macos"))]
#[no_mangle]
pub extern "C" fn webview_pump() {}

#[cfg(target_os = "macos")]
#[no_mangle]
pub extern "C" fn webview_sync_bounds(state: *mut WebviewState) {
    if state.is_null() {
        return;
    }
    let wv_state = unsafe { &*state };
    GLOBAL_RUNTIME.with(|cell| {
        let mut runtime_opt = cell.borrow_mut();
        let Some(runtime) = runtime_opt.as_mut() else {
            return;
        };
        webview_impl::sync_bounds(runtime, wv_state);
    });
}

#[cfg(not(target_os = "macos"))]
#[no_mangle]
pub extern "C" fn webview_sync_bounds(_state: *mut WebviewState) {}

#[cfg(target_os = "macos")]
#[no_mangle]
pub extern "C" fn webview_set_size(state: *mut WebviewState, width: u32, height: u32) {
    if state.is_null() || width == 0 || height == 0 {
        return;
    }
    let wv_state = unsafe { &*state };
    GLOBAL_RUNTIME.with(|cell| {
        let mut runtime_opt = cell.borrow_mut();
        let Some(runtime) = runtime_opt.as_mut() else {
            return;
        };
        webview_impl::set_window_size(runtime, wv_state, width, height);
        pump_for_webview(runtime);
        webview_impl::sync_bounds(runtime, wv_state);
    });
}

#[cfg(not(target_os = "macos"))]
#[no_mangle]
pub extern "C" fn webview_set_size(_state: *mut WebviewState, _width: u32, _height: u32) {}

#[cfg(target_os = "macos")]
#[no_mangle]
pub extern "C" fn webview_destroy(state: *mut WebviewState) {
    if state.is_null() {
        return;
    }
    let mut wv_state = unsafe { Box::from_raw(state) };
    let token = wv_state.token;
    wv_state.webview = None;
    GLOBAL_RUNTIME.with(|cell| {
        let mut runtime_opt = cell.borrow_mut();
        let Some(runtime) = runtime_opt.as_mut() else {
            return;
        };
        webview_impl::destroy(runtime, token);
    });
}

#[cfg(not(target_os = "macos"))]
#[no_mangle]
pub extern "C" fn webview_destroy(_state: *mut WebviewState) {}

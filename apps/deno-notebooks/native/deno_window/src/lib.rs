use serde::Serialize;
use std::cell::RefCell;
use std::collections::HashMap;
use std::ptr;
use std::slice;
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

#[derive(Serialize)]
#[serde(tag = "type")]
enum WindowEventRecord {
    #[serde(rename = "key")]
    Key { key: String, down: bool },
    #[serde(rename = "mouse_move")]
    MouseMove { x: f64, y: f64 },
    #[serde(rename = "mouse_button")]
    MouseButton { button: u32, down: bool, x: f64, y: f64 },
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

    fn new(width: u32, height: u32, title: String) -> Self {
        Self {
            window: None,
            window_id: None,
            width,
            height,
            title,
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
        self.events.push(WindowEventRecord::Key { key: key_str, down });
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

    fn insert_window(&mut self, token: u64, width: u32, height: u32, title: String) {
        self.windows
            .insert(token, WindowSlot::new(width, height, title));
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
        runtime.app.insert_window(token, width, height, title);

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

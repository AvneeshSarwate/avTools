use winit::raw_window_handle_05::{
    HasRawDisplayHandle, HasRawWindowHandle, RawDisplayHandle, RawWindowHandle,
};
use serde::Serialize;
use std::ptr;
use std::slice;
use std::time::Duration;
use winit::application::ApplicationHandler;
use winit::dpi::{LogicalSize, PhysicalSize};
use winit::event::{ElementState, MouseButton, MouseScrollDelta, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::keyboard::Key;
use winit::platform::pump_events::EventLoopExtPumpEvents;
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

struct WindowApp {
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

impl WindowApp {
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
        if self.window.is_some() {
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
            other => format!("{:?}", other),
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

impl ApplicationHandler for WindowApp {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        event_loop.set_control_flow(ControlFlow::Poll);
        self.ensure_window(event_loop);
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, window_id: WindowId, event: WindowEvent) {
        if Some(window_id) != self.window_id {
            return;
        }

        match event {
            WindowEvent::CloseRequested => {
                self.events.push(WindowEventRecord::Close);
                self.should_close = true;
                event_loop.exit();
            }
            WindowEvent::Resized(size) => self.record_resize(size),
            WindowEvent::ScaleFactorChanged { .. } => {
                if let Some(window) = self.window.as_ref() {
                    self.record_resize(window.inner_size());
                }
            }
            WindowEvent::CursorMoved { position, .. } => {
                self.last_cursor = (position.x, position.y);
                self.events.push(WindowEventRecord::MouseMove { x: position.x, y: position.y });
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
                let (x, y) = self.last_cursor;
                self.events.push(WindowEventRecord::MouseButton {
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
                self.events.push(WindowEventRecord::Scroll { dx, dy });
            }
            WindowEvent::KeyboardInput { event, .. } => {
                let down = matches!(event.state, ElementState::Pressed);
                self.record_key(event.logical_key, down);
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        if self.should_close {
            event_loop.exit();
        }
    }
}

#[repr(C)]
pub struct WindowState {
    event_loop: EventLoop<()>,
    app: WindowApp,
}

fn pump_once(state: &mut WindowState) {
    let _ = state
        .event_loop
        .pump_app_events(Some(Duration::ZERO), &mut state.app);
    if state.app.cached_window_handle == 0 {
        if let Some(window) = state.app.window.as_ref() {
            let win_handle = window.raw_window_handle();
            let display_handle = window.raw_display_handle();
            state.app.cached_window_handle = handle_from_raw_window(win_handle);
            state.app.cached_display_handle = handle_from_raw_display(display_handle);
            state.app.cached_window_system = window_system_id(win_handle, display_handle);
            state.app.debug_log_handles("pump_once");
        }
    }
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
        (_, RawDisplayHandle::Xcb(_)) | (_, RawDisplayHandle::Xlib(_)) | (RawWindowHandle::Xcb(_), _) | (RawWindowHandle::Xlib(_), _) => 1,
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

    let mut event_loop = match EventLoop::new() {
        Ok(loop_handle) => loop_handle,
        Err(err) => {
            eprintln!("Failed to create event loop: {err}");
            return ptr::null_mut();
        }
    };
    let mut app = WindowApp::new(width, height, title);

    // Pump a few times to ensure the window is created.
    for _ in 0..8 {
        let _ = event_loop.pump_app_events(Some(Duration::ZERO), &mut app);
        if app.window.is_some() {
            break;
        }
    }

    Box::into_raw(Box::new(WindowState { event_loop, app }))
}

#[no_mangle]
pub extern "C" fn get_raw_window_handle(state: *mut WindowState) -> usize {
    if state.is_null() {
        return 0;
    }
    let state = unsafe { &mut *state };
    for _ in 0..2 {
        if state.app.cached_window_handle != 0 {
            return state.app.cached_window_handle;
        }
        pump_once(state);
    }
    0
}

#[no_mangle]
pub extern "C" fn get_raw_display_handle(state: *mut WindowState) -> usize {
    if state.is_null() {
        return 0;
    }
    let state = unsafe { &mut *state };
    for _ in 0..2 {
        if state.app.cached_display_handle != 0 {
            return state.app.cached_display_handle;
        }
        pump_once(state);
    }
    0
}

#[no_mangle]
pub extern "C" fn get_window_system(state: *mut WindowState) -> u32 {
    if state.is_null() {
        return 0;
    }
    let state = unsafe { &mut *state };
    if state.app.window.is_none() {
        pump_once(state);
    }
    if state.app.cached_window_system != 0 {
        return state.app.cached_window_system;
    }
    pump_once(state);
    state.app.cached_window_system
}

#[no_mangle]
pub extern "C" fn poll_events(state: *mut WindowState, buf_ptr: *mut u8, buf_cap: u32) -> u32 {
    if state.is_null() {
        return 0;
    }
    let state = unsafe { &mut *state };
    let _ = state
        .event_loop
        .pump_app_events(Some(Duration::ZERO), &mut state.app);
    let payload = state.app.take_events_json();
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
}

#[no_mangle]
pub extern "C" fn resize_window(state: *mut WindowState, width: u32, height: u32) {
    if state.is_null() {
        return;
    }
    let state = unsafe { &mut *state };
    if let Some(window) = state.app.window.as_ref() {
        let _ = window.request_inner_size(LogicalSize::new(width as f64, height as f64));
    }
}

#[no_mangle]
pub extern "C" fn get_window_size(state: *mut WindowState, out_w: *mut u32, out_h: *mut u32) {
    if state.is_null() || out_w.is_null() || out_h.is_null() {
        return;
    }
    let state = unsafe { &mut *state };
    if let Some(window) = state.app.window.as_ref() {
        let size = window.inner_size();
        unsafe {
            *out_w = size.width;
            *out_h = size.height;
        }
    }
}

#[no_mangle]
pub extern "C" fn destroy_window(state: *mut WindowState) {
    if state.is_null() {
        return;
    }
    unsafe {
        drop(Box::from_raw(state));
    }
}

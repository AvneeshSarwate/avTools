use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use winit::application::ApplicationHandler;
use winit::dpi::LogicalSize;
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::window::{Window, WindowId};
use wry::{
    dpi::{LogicalPosition, LogicalSize as WebLogicalSize},
    Rect, WebView, WebViewBuilder,
};

const HTML: &str = r#"<!doctype html>
<html>
<body>smoke</body>
<script>
  setTimeout(() => {
    window.ipc.postMessage(JSON.stringify({type: "smoke", ok: true}));
  }, 150);
</script>
</html>"#;

struct App {
    window: Option<Window>,
    webview: Option<WebView>,
    message: Arc<Mutex<Option<String>>>,
    deadline: Instant,
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        event_loop.set_control_flow(ControlFlow::Poll);

        if self.window.is_some() {
            return;
        }

        let window = event_loop
            .create_window(
                Window::default_attributes()
                    .with_title("wry-smoke")
                    .with_inner_size(LogicalSize::new(320.0, 200.0)),
            )
            .expect("create window");

        let message = self.message.clone();
        let webview = WebViewBuilder::new()
            .with_bounds(Rect {
                position: LogicalPosition::new(0, 0).into(),
                size: WebLogicalSize::new(320, 200).into(),
            })
            .with_on_page_load_handler(|event, url| {
                let label = match event {
                    wry::PageLoadEvent::Started => "started",
                    wry::PageLoadEvent::Finished => "finished",
                };
                eprintln!("[wry_smoke] page load: {label} {url}");
            })
            .with_ipc_handler(move |request| {
                eprintln!("[wry_smoke] ipc: {}", request.body());
                *message.lock().unwrap() = Some(request.body().to_string());
            })
            .with_html(HTML)
            .build_as_child(&window)
            .expect("build webview");

        self.webview = Some(webview);
        self.window = Some(window);
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        if let Some(message) = self.message.lock().unwrap().take() {
            println!("{message}");
            event_loop.exit();
            return;
        }

        if Instant::now() >= self.deadline {
            eprintln!("[wry_smoke] timeout");
            event_loop.exit();
        }
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        event: WindowEvent,
    ) {
        if matches!(event, WindowEvent::CloseRequested) {
            event_loop.exit();
        }
    }
}

fn main() {
    let event_loop = EventLoop::new().expect("event loop");
    let mut app = App {
        window: None,
        webview: None,
        message: Arc::new(Mutex::new(None)),
        deadline: Instant::now() + Duration::from_secs(5),
    };

    event_loop.run_app(&mut app).expect("run app");

    if app.message.lock().unwrap().is_none() && Instant::now() >= app.deadline {
        std::process::exit(1);
    }
}

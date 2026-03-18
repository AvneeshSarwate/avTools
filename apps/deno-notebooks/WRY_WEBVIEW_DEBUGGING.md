# Wry Webview in Deno/Winit — Debugging Log

## Goal

Add a tweakpane parameter UI panel to native p5gpu sketch windows. The webview (via wry) should display HTML content (tweakpane controls) that communicates with the Deno process via IPC.

## Architecture

- **Main GPU windows**: Created by winit, surface created by Deno's WebGPU (`Deno.UnsafeWindowSurface`). These have a `CAMetalLayer` backing the NSView.
- **Webview panel**: Should display tweakpane controls in a separate window or overlay.
- **Communication**: wry IPC (`window.ipc.postMessage` → Rust handler, `evaluate_script` for Rust→JS).
- **Platform**: macOS (Darwin 23.6.0, Apple Silicon), winit 0.30, wry 0.54.

## What Was Tried

### Attempt 1: `build_as_child` on the GPU window

```rust
WebViewBuilder::new()
    .with_bounds(Rect { ... })
    .with_transparent(true)
    .with_html(&html)
    .with_ipc_handler(...)
    .build_as_child(window)  // winit Window
```

**Result**: `build_as_child` returns Ok, but webview is completely invisible. No background, no content, nothing.

**Root cause**: macOS layer-hosting constraint. When Deno's WebGPU creates a surface from the window handle, it sets a `CAMetalLayer` on the NSView via `setLayer:` + `setWantsLayer:YES`, making it a **layer-hosting view**. Apple's Core Animation docs state: "a layer-hosting view is a leaf node in the view tree — you cannot add subviews to it." `addSubview` silently succeeds but the WKWebView never renders.

Confirmed by: [wry issue #1335](https://github.com/tauri-apps/wry/issues/1335) (Godot), [bevy issue #17686](https://github.com/bevyengine/bevy/issues/17686).

### Attempt 2: `build` on a second winit window (no GPU surface)

Created a second winit window (no WebGPU surface, so no CAMetalLayer), used `build(&window)` instead of `build_as_child`.

**Result**: Window appears but webview content is invisible. Switching focus to the GPU window crashes Deno.

**Root cause**: wry's `build()` replaces the window's `contentView` with a `WryWebViewParent` containing the WKWebView. Winit still thinks it owns the original contentView and crashes when processing events for the modified window.

### Attempt 3: Raw NSWindow via `cocoa` crate (completely outside winit)

Created an NSWindow using the `cocoa` crate directly (not through winit), got its `contentView`, wrapped it in a `HasWindowHandle` impl, passed to `build()`.

```rust
// In webview_impl module:
let ns_window = NSWindow::alloc(nil).initWithContentRect_styleMask_backing_defer_(...);
let content_view = ns_window.contentView();
let view_handle = NsViewHandle(content_view); // implements HasWindowHandle
WebViewBuilder::new().with_html(&html).build(&view_handle)
```

**Result**: Window appears. The webview's **background color renders** (the default white/gray WKWebView background is visible), but **no HTML content** — no text, no CSS backgrounds from the HTML, no JavaScript execution. IPC `connectionReady` message is never received.

**Hypothesis**: WKWebView renders content in a separate WebContent process. Communication happens via Mach port IPC serviced by the main thread's CFRunLoop. Since winit's `pump_app_events(Duration::ZERO)` stops the NSApplication run loop immediately, and the raw NSWindow is not managed by winit at all, the run loop sources for WKWebView's IPC never get serviced.

**Attempted fix**: Added explicit CFRunLoop pumping:
```rust
// After build():
for _ in 0..50 {
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.01, 0); // 10ms x 50 = 500ms
}

// Per-frame pump in webview_pump() FFI:
CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.001, 0);
```

**Result**: Still no HTML content rendered. The 500ms of pumping after creation + per-frame pumping does not cause the HTML to load.

## Current State

- Raw NSWindow is created and visible ✓
- wry `build()` succeeds ✓
- Webview occupies the window (background visible) ✓
- HTML content does NOT render ✗
- JavaScript does NOT execute ✗
- IPC messages are NOT received ✗
- No crash when switching between windows ✓

## Open Questions

1. **Is `loadHTMLString:baseURL:` actually being called?** wry calls this internally during `build()`. The call should happen before `build()` returns. But does it succeed?

2. **Is the NSView/contentView properly set up?** wry's `build()` (non-child) flow:
   - Gets `ns_view.window()` to find the NSWindow
   - Creates a `WryWebViewParent` view
   - Adds the WKWebView as subview of parent
   - Calls `ns_window.setContentView(Some(&parent_view))`
   - Calls `ns_window.makeFirstResponder(Some(&webview))`

   Does `ns_view.window()` return the right NSWindow when the NSView comes from `ns_window.contentView()` via the `cocoa` crate? The `HasWindowHandle` returns the NSView pointer — wry then calls `.window()` on it.

3. **Is there an `objc` vs `objc2` conflict?** The `cocoa` crate uses `objc` 0.2 (old), wry uses `objc2` 0.6 (new). The NSView pointer from `cocoa`'s `contentView()` is `*mut objc::runtime::Object`. Wry casts it to `*mut objc2_app_kit::NSView`. These are different Rust types wrapping the same ObjC pointer — should be compatible at the raw pointer level, but could there be vtable/method resolution issues?

4. **Does WKWebView need something beyond CFRunLoop pumping to render?** Some Apple forum posts suggest WKWebView needs the NSApplication to be in a specific state (activated, running). Our NSApplication is managed by winit via `pump_app_events` which repeatedly starts and stops it.

5. **Would `with_url` to a localhost server work where `with_html` doesn't?** `loadHTMLString:baseURL:` and `loadRequest:` (for URLs) take different code paths in WKWebView. Maybe the string loading path has requirements we're not meeting.

## Files

- **Rust**: `apps/deno-notebooks/native/deno_window/src/lib.rs` — FFI functions, raw NSWindow creation, wry integration
- **Rust**: `apps/deno-notebooks/native/deno_window/Cargo.toml` — dependencies (winit, wry, cocoa, objc, raw-window-handle, core-foundation)
- **TypeScript**: `apps/deno-notebooks/window/panel.ts` — WindowPanel class
- **TypeScript**: `apps/deno-notebooks/window/panel_html.ts` — HTML template generation
- **TypeScript**: `apps/deno-notebooks/window/tweakpane_panel.ts` — WindowTweakpane proxy + factory
- **TypeScript**: `apps/deno-notebooks/window/ffi.ts` — FFI symbol definitions
- **Example**: `apps/deno-notebooks/examples/p5gpu_tweakpane_panel.ts`
- **Wry source (local)**: `clonedCompanionRepos/wry/src/wkwebview/mod.rs` — macOS WKWebView implementation

## Wry `build()` Internal Flow (from source)

File: `clonedCompanionRepos/wry/src/wkwebview/mod.rs`

1. `new()` (line 162): extracts `ns_view` pointer from `HasWindowHandle`
2. `new_ns_view()` (line 194): main setup function
3. Lines 200-657: creates WKWebViewConfiguration, registers protocols, creates WKWebView, sets up delegates, IPC handler, initialization scripts, navigates to HTML
4. Line 655-657: `if let Some(html) = attributes.html { w.navigate_to_string(&html); }` — calls `loadHTMLString:baseURL:`
5. Lines 664-689 (non-child path):
   - `ns_view.window().unwrap()` — gets NSWindow from the NSView
   - Creates `WryWebViewParent`
   - `parent_view.addSubview(&webview)`
   - `ns_window.setContentView(Some(&parent_view))`
   - `ns_window.makeFirstResponder(Some(&webview))`
6. Lines 692-700: activates the NSApplication

#![allow(clippy::missing_safety_doc)]
#![allow(unexpected_cfgs)]

#[cfg(target_os = "macos")]
mod macos {
    use libc::{c_int, c_void};
    use objc::declare::ClassDecl;
    use objc::runtime::{Class, Object, Sel, BOOL, NO, YES};
    use objc::{class, msg_send, sel, sel_impl};
    use once_cell::sync::Lazy;
    use serde::Serialize;
    use std::collections::HashMap;
    use std::ffi::CStr;
    use std::path::{Path, PathBuf};
    use std::ptr;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::{Arc, Mutex, OnceLock, Weak};

    const INTERCEPTING_LAYER_CLASS_NAME: &str = "AvToolsInterceptingMetalLayer";
    const NS_UTF8_STRING_ENCODING: usize = 4;
    const RING_SIZE: usize = 3;

    unsafe extern "C" {
        fn MTLCreateSystemDefaultDevice() -> *mut Object;
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct NSPoint {
        x: f64,
        y: f64,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct NSSize {
        width: f64,
        height: f64,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct NSRect {
        origin: NSPoint,
        size: NSSize,
    }

    #[derive(Clone, Copy)]
    struct RingEntry {
        frame_id: u64,
        drawable: usize,
    }

    impl Default for RingEntry {
        fn default() -> Self {
            Self {
                frame_id: 0,
                drawable: 0,
            }
        }
    }

    struct DrawableRingInner {
        entries: [RingEntry; RING_SIZE],
        write_idx: usize,
        next_frame_id: u64,
        intercept_count: u64,
    }

    struct DrawableRing {
        inner: Mutex<DrawableRingInner>,
    }

    impl DrawableRing {
        fn new() -> Self {
            Self {
                inner: Mutex::new(DrawableRingInner {
                    entries: [RingEntry::default(); RING_SIZE],
                    write_idx: 0,
                    next_frame_id: 1,
                    intercept_count: 0,
                }),
            }
        }

        fn record_drawable(&self, drawable: *mut Object) {
            if drawable.is_null() {
                return;
            }

            let mut inner = self.inner.lock().unwrap();
            let idx = inner.write_idx;

            let _: () = unsafe { msg_send![drawable, retain] };

            let previous = inner.entries[idx].drawable as *mut Object;
            if !previous.is_null() {
                let _: () = unsafe { msg_send![previous, release] };
            }

            let frame_id = inner.next_frame_id;
            inner.next_frame_id = inner.next_frame_id.saturating_add(1);
            inner.intercept_count = inner.intercept_count.saturating_add(1);

            inner.entries[idx] = RingEntry {
                frame_id,
                drawable: drawable as usize,
            };
            inner.write_idx = (inner.write_idx + 1) % RING_SIZE;
        }

        fn take_latest(&self) -> Option<(u64, *mut Object)> {
            let mut inner = self.inner.lock().unwrap();
            if inner.intercept_count == 0 {
                return None;
            }
            let latest_idx = (inner.write_idx + RING_SIZE - 1) % RING_SIZE;
            let entry = &mut inner.entries[latest_idx];
            if entry.drawable == 0 {
                return None;
            }
            let frame_id = entry.frame_id;
            let drawable = entry.drawable as *mut Object;
            entry.drawable = 0;
            Some((frame_id, drawable))
        }

        fn intercept_count(&self) -> u64 {
            let inner = self.inner.lock().unwrap();
            inner.intercept_count
        }
    }

    impl Drop for DrawableRing {
        fn drop(&mut self) {
            let mut inner = self.inner.lock().unwrap();
            for entry in &mut inner.entries {
                if entry.drawable != 0 {
                    let drawable = entry.drawable as *mut Object;
                    let _: () = unsafe { msg_send![drawable, release] };
                    entry.drawable = 0;
                }
            }
        }
    }

    static LAYER_RINGS: Lazy<Mutex<HashMap<usize, Weak<DrawableRing>>>> =
        Lazy::new(|| Mutex::new(HashMap::new()));

    pub struct SyphonState {
        ns_view: *mut Object,
        layer: *mut Object,
        ring: Arc<DrawableRing>,
        server_name: String,
        framework_hint: Option<String>,
        loaded_framework_path: Option<String>,
        command_queue: *mut Object,
        syphon_server: *mut Object,
        last_width: AtomicU32,
        last_height: AtomicU32,
    }

    pub struct SyphonClientState {
        client: *mut Object,
    }

    #[derive(Serialize)]
    struct ServerEntry {
        name: String,
        #[serde(rename = "appName")]
        app_name: String,
        uuid: String,
    }

    impl Drop for SyphonState {
        fn drop(&mut self) {
            unregister_layer_ring(self.layer);
            if !self.syphon_server.is_null() {
                unsafe {
                    if responds_to_selector(self.syphon_server, sel!(stop)) {
                        let _: () = msg_send![self.syphon_server, stop];
                    }
                    let _: () = msg_send![self.syphon_server, release];
                }
                self.syphon_server = ptr::null_mut();
            }
            if !self.command_queue.is_null() {
                unsafe {
                    let _: () = msg_send![self.command_queue, release];
                }
                self.command_queue = ptr::null_mut();
            }
            if !self.layer.is_null() {
                unsafe {
                    let _: () = msg_send![self.layer, release];
                }
                self.layer = ptr::null_mut();
            }
            self.ns_view = ptr::null_mut();
        }
    }

    impl Drop for SyphonClientState {
        fn drop(&mut self) {
            if self.client.is_null() {
                return;
            }
            unsafe {
                if responds_to_selector(self.client, sel!(stop)) {
                    let _: () = msg_send![self.client, stop];
                }
                let _: () = msg_send![self.client, release];
            }
            self.client = ptr::null_mut();
        }
    }

    impl SyphonState {
        unsafe fn refresh_layer_pointer(&mut self) {
            if self.ns_view.is_null() {
                return;
            }
            let current_layer: *mut Object = msg_send![self.ns_view, layer];
            if current_layer.is_null() {
                return;
            }
            if current_layer == self.layer {
                return;
            }

            unregister_layer_ring(self.layer);
            register_layer_ring(current_layer, &self.ring);
            self.layer = current_layer;
        }

        unsafe fn maybe_load_framework(&mut self) {
            if Class::get("SyphonMetalServer").is_some() {
                return;
            }

            if let Some(path) = load_syphon_framework(self.framework_hint.as_deref()) {
                self.loaded_framework_path = Some(path);
            }
        }

        unsafe fn ensure_server_ready(&mut self) -> bool {
            if !self.syphon_server.is_null() {
                return true;
            }

            self.maybe_load_framework();
            let server_class = match Class::get("SyphonMetalServer") {
                Some(cls) => cls,
                None => return false,
            };

            self.refresh_layer_pointer();

            if self.layer.is_null() {
                return false;
            }

            let device: *mut Object = msg_send![self.layer, device];
            if device.is_null() {
                return false;
            }

            let queue: *mut Object = msg_send![device, newCommandQueue];
            if queue.is_null() {
                return false;
            }

            let name = nsstring_from_str(&self.server_name);
            if name.is_null() {
                let _: () = msg_send![queue, release];
                return false;
            }

            let server_alloc: *mut Object = msg_send![server_class, alloc];
            let server: *mut Object = msg_send![
                server_alloc,
                initWithName: name
                device: device
                options: ptr::null::<Object>()
            ];
            let _: () = msg_send![name, release];

            if server.is_null() {
                let _: () = msg_send![queue, release];
                return false;
            }

            self.command_queue = queue;
            self.syphon_server = server;
            true
        }

        unsafe fn publish_latest(&mut self) -> u64 {
            if !self.ensure_server_ready() {
                return 0;
            }

            let (frame_id, drawable) = match self.ring.take_latest() {
                Some(v) => v,
                None => return 0,
            };

            if drawable.is_null() {
                return 0;
            }

            let texture: *mut Object = msg_send![drawable, texture];
            if texture.is_null() {
                let _: () = msg_send![drawable, release];
                return 0;
            }

            let width: u64 = msg_send![texture, width];
            let height: u64 = msg_send![texture, height];
            self.last_width.store(width as u32, Ordering::Relaxed);
            self.last_height.store(height as u32, Ordering::Relaxed);

            let cmd_buf: *mut Object = msg_send![self.command_queue, commandBuffer];
            if cmd_buf.is_null() {
                let _: () = msg_send![drawable, release];
                return 0;
            }

            let image_region = NSRect {
                origin: NSPoint { x: 0.0, y: 0.0 },
                size: NSSize {
                    width: width as f64,
                    height: height as f64,
                },
            };

            let _: () = msg_send![
                self.syphon_server,
                publishFrameTexture: texture
                onCommandBuffer: cmd_buf
                imageRegion: image_region
                flipped: NO
            ];

            let _: () = msg_send![cmd_buf, commit];
            let _: () = msg_send![drawable, release];

            frame_id
        }

        unsafe fn has_clients(&mut self) -> bool {
            if !self.ensure_server_ready() {
                return false;
            }
            let has_clients: BOOL = msg_send![self.syphon_server, hasClients];
            has_clients == YES
        }

        unsafe fn set_name(&mut self, name: String) {
            if name.is_empty() {
                return;
            }
            self.server_name = name;
            if self.syphon_server.is_null() {
                return;
            }

            if !responds_to_selector(self.syphon_server, sel!(setName:)) {
                return;
            }

            let ns_name = nsstring_from_str(&self.server_name);
            if ns_name.is_null() {
                return;
            }

            let _: () = msg_send![self.syphon_server, setName: ns_name];
            let _: () = msg_send![ns_name, release];
        }
    }

    fn register_layer_ring(layer: *mut Object, ring: &Arc<DrawableRing>) {
        if layer.is_null() {
            return;
        }
        let mut map = LAYER_RINGS.lock().unwrap();
        map.insert(layer as usize, Arc::downgrade(ring));
    }

    fn unregister_layer_ring(layer: *mut Object) {
        if layer.is_null() {
            return;
        }
        let mut map = LAYER_RINGS.lock().unwrap();
        map.remove(&(layer as usize));
    }

    extern "C" fn intercept_next_drawable(this: &Object, _cmd: Sel) -> *mut Object {
        let superclass = match Class::get("CAMetalLayer") {
            Some(cls) => cls,
            None => return ptr::null_mut(),
        };
        let drawable: *mut Object = unsafe { msg_send![super(this, superclass), nextDrawable] };
        if !drawable.is_null() {
            if let Some(ring) = LAYER_RINGS
                .lock()
                .unwrap()
                .get(&(this as *const Object as usize))
                .and_then(Weak::upgrade)
            {
                ring.record_drawable(drawable);
            }
        }
        drawable
    }

    fn ensure_intercepting_layer_class() -> &'static Class {
        static CLASS: OnceLock<&'static Class> = OnceLock::new();
        CLASS.get_or_init(|| {
            if let Some(existing) = Class::get(INTERCEPTING_LAYER_CLASS_NAME) {
                return existing;
            }

            let superclass = Class::get("CAMetalLayer").expect("CAMetalLayer missing");
            let mut decl = ClassDecl::new(INTERCEPTING_LAYER_CLASS_NAME, superclass)
                .expect("failed to create intercepting layer class");

            unsafe {
                decl.add_method(
                    sel!(nextDrawable),
                    intercept_next_drawable as extern "C" fn(&Object, Sel) -> *mut Object,
                );
            }

            decl.register()
        })
    }

    unsafe fn responds_to_selector(obj: *mut Object, selector: Sel) -> bool {
        if obj.is_null() {
            return false;
        }
        let responds: BOOL = msg_send![obj, respondsToSelector: selector];
        responds == YES
    }

    unsafe fn nsstring_from_str(s: &str) -> *mut Object {
        let ns_string: *mut Object = msg_send![class!(NSString), alloc];
        if ns_string.is_null() {
            return ptr::null_mut();
        }
        let ns_string: *mut Object = msg_send![
            ns_string,
            initWithBytes: s.as_ptr()
            length: s.len()
            encoding: NS_UTF8_STRING_ENCODING
        ];
        ns_string
    }

    unsafe fn bytes_to_string(ptr: *const u8, len: u32) -> String {
        if ptr.is_null() || len == 0 {
            return String::new();
        }
        let bytes = std::slice::from_raw_parts(ptr, len as usize);
        String::from_utf8_lossy(bytes).to_string()
    }

    unsafe fn nsstring_to_string(string_obj: *mut Object) -> String {
        if string_obj.is_null() {
            return String::new();
        }
        let utf8_ptr: *const i8 = msg_send![string_obj, UTF8String];
        if utf8_ptr.is_null() {
            return String::new();
        }
        CStr::from_ptr(utf8_ptr).to_string_lossy().to_string()
    }

    unsafe fn nsobject_to_string(obj: *mut Object) -> String {
        if obj.is_null() {
            return String::new();
        }
        let desc: *mut Object = msg_send![obj, description];
        nsstring_to_string(desc)
    }

    unsafe fn array_count(array: *mut Object) -> usize {
        if array.is_null() {
            return 0;
        }
        msg_send![array, count]
    }

    unsafe fn array_object_at(array: *mut Object, index: usize) -> *mut Object {
        if array.is_null() {
            return ptr::null_mut();
        }
        msg_send![array, objectAtIndex: index]
    }

    unsafe fn dictionary_get_keys(dict: *mut Object) -> *mut Object {
        if dict.is_null() {
            return ptr::null_mut();
        }
        msg_send![dict, allKeys]
    }

    unsafe fn dictionary_value_for_key(dict: *mut Object, key: *mut Object) -> *mut Object {
        if dict.is_null() || key.is_null() {
            return ptr::null_mut();
        }
        msg_send![dict, objectForKey: key]
    }

    fn looks_like_uuid(value: &str) -> bool {
        if value.len() != 36 {
            return false;
        }
        value.chars().enumerate().all(|(i, c)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                c == '-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
    }

    fn write_json_buffer(payload: &[u8], out_ptr: *mut u8, out_cap: u32) -> u32 {
        let needed = payload.len() as u32;
        if out_ptr.is_null() || out_cap < needed {
            return needed;
        }
        unsafe {
            ptr::copy_nonoverlapping(payload.as_ptr(), out_ptr, payload.len());
        }
        needed
    }

    unsafe fn collect_server_entries() -> Vec<ServerEntry> {
        let mut out = Vec::new();

        let directory_cls = match Class::get("SyphonServerDirectory") {
            Some(cls) => cls,
            None => return out,
        };
        let directory: *mut Object = msg_send![directory_cls, sharedDirectory];
        if directory.is_null() {
            return out;
        }

        let servers: *mut Object = msg_send![directory, servers];
        let server_count = array_count(servers);
        for i in 0..server_count {
            let server_desc = array_object_at(servers, i);
            if server_desc.is_null() {
                continue;
            }

            let keys = dictionary_get_keys(server_desc);
            let key_count = array_count(keys);

            let mut name = String::new();
            let mut app_name = String::new();
            let mut uuid = String::new();

            for k in 0..key_count {
                let key_obj = array_object_at(keys, k);
                if key_obj.is_null() {
                    continue;
                }
                let value_obj = dictionary_value_for_key(server_desc, key_obj);
                let key = nsobject_to_string(key_obj);
                let value = nsobject_to_string(value_obj);
                let key_lc = key.to_lowercase();

                if uuid.is_empty() && (key_lc.contains("uuid") || looks_like_uuid(&value)) {
                    uuid = value.clone();
                }
                if name.is_empty() && key_lc.contains("name") && !key_lc.contains("app") {
                    name = value.clone();
                }
                if app_name.is_empty() && key_lc.contains("app") {
                    app_name = value.clone();
                }
                if name.is_empty() && !value.is_empty() && !looks_like_uuid(&value) {
                    name = value.clone();
                }
            }

            if uuid.is_empty() {
                uuid = format!("server-{i}");
            }
            if name.is_empty() {
                name = "Unnamed".to_string();
            }

            out.push(ServerEntry {
                name,
                app_name,
                uuid,
            });
        }

        out
    }

    unsafe fn find_server_description_by_uuid(server_uuid: &str) -> *mut Object {
        if server_uuid.is_empty() {
            return ptr::null_mut();
        }

        let directory_cls = match Class::get("SyphonServerDirectory") {
            Some(cls) => cls,
            None => return ptr::null_mut(),
        };
        let directory: *mut Object = msg_send![directory_cls, sharedDirectory];
        if directory.is_null() {
            return ptr::null_mut();
        }
        let servers: *mut Object = msg_send![directory, servers];
        let server_count = array_count(servers);

        for i in 0..server_count {
            let server_desc = array_object_at(servers, i);
            if server_desc.is_null() {
                continue;
            }
            let keys = dictionary_get_keys(server_desc);
            let key_count = array_count(keys);
            for k in 0..key_count {
                let key_obj = array_object_at(keys, k);
                let value_obj = dictionary_value_for_key(server_desc, key_obj);
                let value = nsobject_to_string(value_obj);
                if value == server_uuid {
                    return server_desc;
                }
            }
        }

        ptr::null_mut()
    }

    fn candidate_framework_paths(explicit_hint: Option<&str>) -> Vec<PathBuf> {
        let mut candidates = Vec::<PathBuf>::new();

        if let Some(path) = explicit_hint {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                candidates.push(PathBuf::from(trimmed));
            }
        }

        if let Some(dylib_dir) = dylib_directory() {
            candidates.push(dylib_dir.join("frameworks/Syphon.framework"));
        }

        if let Ok(cwd) = std::env::current_dir() {
            candidates.push(
                cwd.join("apps/deno-notebooks/native/syphon_bridge/frameworks/Syphon.framework"),
            );
        }

        if let Ok(home) = std::env::var("HOME") {
            candidates.push(PathBuf::from(home).join("Library/Frameworks/Syphon.framework"));
        }

        candidates.push(PathBuf::from("/Library/Frameworks/Syphon.framework"));

        // preserve order while deduplicating
        let mut out = Vec::<PathBuf>::new();
        for path in candidates {
            if !out.iter().any(|existing| existing == &path) {
                out.push(path);
            }
        }
        out
    }

    fn dylib_directory() -> Option<PathBuf> {
        unsafe {
            let mut info = std::mem::MaybeUninit::<libc::Dl_info>::zeroed();
            let target = syphon_init as *const () as *const c_void;
            let ok: c_int = libc::dladdr(target, info.as_mut_ptr());
            if ok == 0 {
                return None;
            }
            let info = info.assume_init();
            if info.dli_fname.is_null() {
                return None;
            }
            let cstr = CStr::from_ptr(info.dli_fname);
            let full = PathBuf::from(cstr.to_string_lossy().to_string());
            full.parent().map(Path::to_path_buf)
        }
    }

    fn load_syphon_framework(explicit_hint: Option<&str>) -> Option<String> {
        for path in candidate_framework_paths(explicit_hint) {
            if !path.exists() {
                continue;
            }

            let loaded = unsafe {
                let ns_path = nsstring_from_str(path.to_string_lossy().as_ref());
                if ns_path.is_null() {
                    false
                } else {
                    let bundle: *mut Object = msg_send![class!(NSBundle), bundleWithPath: ns_path];
                    let _: () = msg_send![ns_path, release];
                    if bundle.is_null() {
                        false
                    } else {
                        let did_load: BOOL = msg_send![bundle, load];
                        did_load == YES
                    }
                }
            };

            if loaded && Class::get("SyphonMetalServer").is_some() {
                return Some(path.to_string_lossy().to_string());
            }
        }

        if Class::get("SyphonMetalServer").is_some() {
            return Some("already-loaded".to_string());
        }

        None
    }

    #[no_mangle]
    pub extern "C" fn syphon_init(
        ns_view_ptr: usize,
        name_ptr: *const u8,
        name_len: u32,
        framework_path_ptr: *const u8,
        framework_path_len: u32,
    ) -> *mut SyphonState {
        if ns_view_ptr == 0 {
            return ptr::null_mut();
        }

        let server_name = unsafe {
            let decoded = bytes_to_string(name_ptr, name_len);
            if decoded.is_empty() {
                "Deno Syphon".to_string()
            } else {
                decoded
            }
        };

        let framework_hint = unsafe {
            let decoded = bytes_to_string(framework_path_ptr, framework_path_len);
            if decoded.is_empty() {
                None
            } else {
                Some(decoded)
            }
        };

        let loaded_framework_path = load_syphon_framework(framework_hint.as_deref());

        let intercepting_cls = ensure_intercepting_layer_class();
        let layer: *mut Object = unsafe { msg_send![intercepting_cls, new] };
        if layer.is_null() {
            return ptr::null_mut();
        }

        let ns_view = ns_view_ptr as *mut Object;
        unsafe {
            let _: () = msg_send![ns_view, setWantsLayer: YES];
            let _: () = msg_send![ns_view, setLayer: layer];
            if responds_to_selector(layer, sel!(setFramebufferOnly:)) {
                let _: () = msg_send![layer, setFramebufferOnly: NO];
            }
            if responds_to_selector(layer, sel!(setAllowsNextDrawableTimeout:)) {
                let _: () = msg_send![layer, setAllowsNextDrawableTimeout: NO];
            }
        }

        let ring = Arc::new(DrawableRing::new());
        register_layer_ring(layer, &ring);

        let state = SyphonState {
            ns_view,
            layer,
            ring,
            server_name,
            framework_hint,
            loaded_framework_path,
            command_queue: ptr::null_mut(),
            syphon_server: ptr::null_mut(),
            last_width: AtomicU32::new(0),
            last_height: AtomicU32::new(0),
        };

        Box::into_raw(Box::new(state))
    }

    #[no_mangle]
    pub extern "C" fn syphon_destroy(state: *mut SyphonState) {
        if state.is_null() {
            return;
        }
        unsafe {
            drop(Box::from_raw(state));
        }
    }

    #[no_mangle]
    pub extern "C" fn syphon_latch_and_publish(state: *mut SyphonState) -> u64 {
        if state.is_null() {
            return 0;
        }
        let state = unsafe { &mut *state };
        unsafe { state.publish_latest() }
    }

    #[no_mangle]
    pub extern "C" fn syphon_has_clients(state: *mut SyphonState) -> u32 {
        if state.is_null() {
            return 0;
        }
        let state = unsafe { &mut *state };
        unsafe { u32::from(state.has_clients()) }
    }

    #[no_mangle]
    pub extern "C" fn syphon_set_name(state: *mut SyphonState, name_ptr: *const u8, name_len: u32) {
        if state.is_null() {
            return;
        }
        let new_name = unsafe { bytes_to_string(name_ptr, name_len) };
        if new_name.is_empty() {
            return;
        }
        let state = unsafe { &mut *state };
        unsafe { state.set_name(new_name) };
    }

    #[no_mangle]
    pub extern "C" fn syphon_get_intercept_count(state: *mut SyphonState) -> u64 {
        if state.is_null() {
            return 0;
        }
        let state = unsafe { &*state };
        state.ring.intercept_count()
    }

    #[no_mangle]
    pub extern "C" fn syphon_is_server_ready(state: *mut SyphonState) -> u32 {
        if state.is_null() {
            return 0;
        }
        let state = unsafe { &*state };
        u32::from(!state.syphon_server.is_null())
    }

    #[no_mangle]
    pub extern "C" fn syphon_get_last_texture_size(
        state: *mut SyphonState,
        out_w: *mut u32,
        out_h: *mut u32,
    ) {
        if state.is_null() || out_w.is_null() || out_h.is_null() {
            return;
        }
        let state = unsafe { &*state };
        unsafe {
            *out_w = state.last_width.load(Ordering::Relaxed);
            *out_h = state.last_height.load(Ordering::Relaxed);
        }
    }

    #[no_mangle]
    pub extern "C" fn syphon_get_server_name(
        state: *mut SyphonState,
        buf_ptr: *mut u8,
        buf_cap: u32,
    ) -> u32 {
        if state.is_null() {
            return 0;
        }
        let state = unsafe { &*state };
        let bytes = state.server_name.as_bytes();
        let needed = bytes.len() as u32;

        if buf_ptr.is_null() || buf_cap < needed {
            return needed;
        }

        unsafe {
            ptr::copy_nonoverlapping(bytes.as_ptr(), buf_ptr, bytes.len());
        }

        needed
    }

    #[no_mangle]
    pub extern "C" fn syphon_list_servers(buf_ptr: *mut u8, buf_cap: u32) -> u32 {
        let _ = load_syphon_framework(None);
        let entries = unsafe { collect_server_entries() };
        let json = serde_json::to_vec(&entries).unwrap_or_else(|_| b"[]".to_vec());
        write_json_buffer(&json, buf_ptr, buf_cap)
    }

    #[no_mangle]
    pub extern "C" fn syphon_client_create(
        server_uuid_ptr: *const u8,
        server_uuid_len: u32,
        framework_path_ptr: *const u8,
        framework_path_len: u32,
    ) -> *mut SyphonClientState {
        let uuid = unsafe { bytes_to_string(server_uuid_ptr, server_uuid_len) };
        if uuid.is_empty() {
            return ptr::null_mut();
        }

        let framework_hint = unsafe { bytes_to_string(framework_path_ptr, framework_path_len) };
        let framework_hint = if framework_hint.is_empty() {
            None
        } else {
            Some(framework_hint)
        };

        let _ = load_syphon_framework(framework_hint.as_deref());
        if Class::get("SyphonMetalClient").is_none() {
            return ptr::null_mut();
        }

        let server_desc = unsafe { find_server_description_by_uuid(&uuid) };
        if server_desc.is_null() {
            return ptr::null_mut();
        }

        let device = unsafe { MTLCreateSystemDefaultDevice() };
        if device.is_null() {
            return ptr::null_mut();
        }

        let client_cls = match Class::get("SyphonMetalClient") {
            Some(cls) => cls,
            None => return ptr::null_mut(),
        };

        let client_alloc: *mut Object = unsafe { msg_send![client_cls, alloc] };
        let client: *mut Object = unsafe {
            msg_send![
                client_alloc,
                initWithServerDescription: server_desc
                device: device
                options: ptr::null::<Object>()
                newFrameHandler: ptr::null::<c_void>()
            ]
        };
        if client.is_null() {
            return ptr::null_mut();
        }

        let valid: BOOL = unsafe { msg_send![client, isValid] };
        if valid != YES {
            unsafe {
                let _: () = msg_send![client, release];
            }
            return ptr::null_mut();
        }

        Box::into_raw(Box::new(SyphonClientState { client }))
    }

    #[no_mangle]
    pub extern "C" fn syphon_client_has_new_frame(state: *mut SyphonClientState) -> u32 {
        if state.is_null() {
            return 0;
        }
        let state = unsafe { &*state };
        if state.client.is_null() {
            return 0;
        }
        let has_new_frame: BOOL = unsafe { msg_send![state.client, hasNewFrame] };
        u32::from(has_new_frame == YES)
    }

    #[no_mangle]
    pub extern "C" fn syphon_client_get_frame_size(
        state: *mut SyphonClientState,
        out_w: *mut u32,
        out_h: *mut u32,
    ) -> u32 {
        if state.is_null() || out_w.is_null() || out_h.is_null() {
            return 0;
        }
        let state = unsafe { &*state };
        if state.client.is_null() {
            return 0;
        }

        let texture: *mut Object = unsafe { msg_send![state.client, newFrameImage] };
        if texture.is_null() {
            return 0;
        }
        let width: u64 = unsafe { msg_send![texture, width] };
        let height: u64 = unsafe { msg_send![texture, height] };
        unsafe {
            *out_w = width as u32;
            *out_h = height as u32;
            let _: () = msg_send![texture, release];
        }
        1
    }

    #[no_mangle]
    pub extern "C" fn syphon_client_destroy(state: *mut SyphonClientState) {
        if state.is_null() {
            return;
        }
        unsafe {
            drop(Box::from_raw(state));
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn ring_buffer_wraps_correctly() {
            let ring = DrawableRing::new();
            assert_eq!(ring.intercept_count(), 0);
            assert!(ring.take_latest().is_none());

            // Use a harmless NSObject allocation as a stand-in drawable.
            let obj: *mut Object = unsafe { msg_send![class!(NSObject), new] };
            ring.record_drawable(obj);
            unsafe {
                let _: () = msg_send![obj, release];
            }

            assert_eq!(ring.intercept_count(), 1);
            let first = ring.take_latest();
            assert!(first.is_some());
            let (frame_id, drawable) = first.unwrap();
            assert_eq!(frame_id, 1);
            assert!(!drawable.is_null());
            unsafe {
                let _: () = msg_send![drawable, release];
            }
            assert!(ring.take_latest().is_none());
        }

        #[test]
        fn framework_candidate_order_includes_system_path() {
            let paths = candidate_framework_paths(None);
            assert!(paths
                .iter()
                .any(|p| p == &PathBuf::from("/Library/Frameworks/Syphon.framework")));
        }

        #[test]
        fn intercepting_class_registers() {
            let cls = ensure_intercepting_layer_class();
            assert_eq!(cls.name(), INTERCEPTING_LAYER_CLASS_NAME);
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod macos {
    use std::ptr;

    pub enum SyphonState {}
    pub enum SyphonClientState {}

    #[no_mangle]
    pub extern "C" fn syphon_init(
        _ns_view_ptr: usize,
        _name_ptr: *const u8,
        _name_len: u32,
        _framework_path_ptr: *const u8,
        _framework_path_len: u32,
    ) -> *mut SyphonState {
        ptr::null_mut()
    }

    #[no_mangle]
    pub extern "C" fn syphon_destroy(_state: *mut SyphonState) {}

    #[no_mangle]
    pub extern "C" fn syphon_latch_and_publish(_state: *mut SyphonState) -> u64 {
        0
    }

    #[no_mangle]
    pub extern "C" fn syphon_has_clients(_state: *mut SyphonState) -> u32 {
        0
    }

    #[no_mangle]
    pub extern "C" fn syphon_set_name(
        _state: *mut SyphonState,
        _name_ptr: *const u8,
        _name_len: u32,
    ) {
    }

    #[no_mangle]
    pub extern "C" fn syphon_get_intercept_count(_state: *mut SyphonState) -> u64 {
        0
    }

    #[no_mangle]
    pub extern "C" fn syphon_is_server_ready(_state: *mut SyphonState) -> u32 {
        0
    }

    #[no_mangle]
    pub extern "C" fn syphon_get_last_texture_size(
        _state: *mut SyphonState,
        _out_w: *mut u32,
        _out_h: *mut u32,
    ) {
    }

    #[no_mangle]
    pub extern "C" fn syphon_get_server_name(
        _state: *mut SyphonState,
        _buf_ptr: *mut u8,
        _buf_cap: u32,
    ) -> u32 {
        0
    }

    #[no_mangle]
    pub extern "C" fn syphon_list_servers(_buf_ptr: *mut u8, _buf_cap: u32) -> u32 {
        0
    }

    #[no_mangle]
    pub extern "C" fn syphon_client_create(
        _server_uuid_ptr: *const u8,
        _server_uuid_len: u32,
        _framework_path_ptr: *const u8,
        _framework_path_len: u32,
    ) -> *mut SyphonClientState {
        ptr::null_mut()
    }

    #[no_mangle]
    pub extern "C" fn syphon_client_has_new_frame(_state: *mut SyphonClientState) -> u32 {
        0
    }

    #[no_mangle]
    pub extern "C" fn syphon_client_get_frame_size(
        _state: *mut SyphonClientState,
        _out_w: *mut u32,
        _out_h: *mut u32,
    ) -> u32 {
        0
    }

    #[no_mangle]
    pub extern "C" fn syphon_client_destroy(_state: *mut SyphonClientState) {}
}

pub use macos::*;

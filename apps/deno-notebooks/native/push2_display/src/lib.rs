use nusb::transfer::{Bulk, Out};
use nusb::{Device, Interface, MaybeFuture};
use std::time::Duration;

const VENDOR_ID: u16 = 0x2982;
const PRODUCT_ID: u16 = 0x1967;
const ENDPOINT_OUT: u8 = 0x01;

const DISPLAY_WIDTH: usize = 960;
const DISPLAY_HEIGHT: usize = 160;
const BYTES_PER_LINE: usize = 2048; // 960 pixels * 2 bytes + 128 filler
const FRAME_TOTAL_BYTES: usize = BYTES_PER_LINE * DISPLAY_HEIGHT; // 327,680

const FRAME_HEADER: [u8; 16] = [
    0xFF, 0xCC, 0xAA, 0x88, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00,
];

const XOR_EVEN: u16 = 0xE7F3;
const XOR_ODD: u16 = 0xE7FF;

const USB_TIMEOUT: Duration = Duration::from_millis(1000);

pub struct Push2DisplayState {
    _device: Device,
    interface: Interface,
}

#[no_mangle]
pub extern "C" fn push2_display_open() -> *mut Push2DisplayState {
    match open_device() {
        Ok(state) => Box::into_raw(Box::new(state)),
        Err(e) => {
            eprintln!("push2_display_open: {e}");
            std::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn push2_display_close(state: *mut Push2DisplayState) {
    if !state.is_null() {
        drop(Box::from_raw(state));
    }
}

#[no_mangle]
pub unsafe extern "C" fn push2_display_send_rgba_frame(
    state: *mut Push2DisplayState,
    rgba_ptr: *const u8,
    width: u32,
    height: u32,
) -> i32 {
    if state.is_null() || rgba_ptr.is_null() {
        return -1;
    }
    if width as usize != DISPLAY_WIDTH || height as usize != DISPLAY_HEIGHT {
        return -2;
    }
    let state = &mut *state;
    let rgba = std::slice::from_raw_parts(rgba_ptr, DISPLAY_WIDTH * DISPLAY_HEIGHT * 4);
    match send_frame(state, rgba) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("push2_display_send_rgba_frame: {e}");
            -3
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn push2_display_is_connected(state: *mut Push2DisplayState) -> u32 {
    if state.is_null() {
        return 0;
    }
    // nusb doesn't have a direct "is_connected" check; we rely on transfer errors.
    // Return 1 optimistically; errors will be caught on next send.
    1
}

fn open_device() -> Result<Push2DisplayState, String> {
    let device_info = nusb::list_devices()
        .wait()
        .map_err(|e| format!("list_devices: {e}"))?
        .find(|d| d.vendor_id() == VENDOR_ID && d.product_id() == PRODUCT_ID)
        .ok_or_else(|| "Push 2 not found (vendor 0x2982, product 0x1967)".to_string())?;

    let device = device_info
        .open()
        .wait()
        .map_err(|e| format!("open device: {e}"))?;

    let interface = device
        .claim_interface(0)
        .wait()
        .map_err(|e| format!("claim interface 0: {e}"))?;

    Ok(Push2DisplayState {
        _device: device,
        interface,
    })
}

fn send_frame(state: &mut Push2DisplayState, rgba: &[u8]) -> Result<(), String> {
    let mut frame_buf = vec![0u8; FRAME_TOTAL_BYTES];

    for line in 0..DISPLAY_HEIGHT {
        for px in 0..DISPLAY_WIDTH {
            let src = (line * DISPLAY_WIDTH + px) * 4;
            let r = (rgba[src] >> 3) as u16;
            let g = (rgba[src + 1] >> 2) as u16;
            let b = (rgba[src + 2] >> 3) as u16;
            let bgr565 = (b << 11) | (g << 5) | r;
            let xor_val = if px % 2 == 0 { XOR_EVEN } else { XOR_ODD };
            let pixel = bgr565 ^ xor_val;

            let dst = line * BYTES_PER_LINE + px * 2;
            frame_buf[dst] = (pixel & 0xFF) as u8;
            frame_buf[dst + 1] = (pixel >> 8) as u8;
        }
    }

    let mut ep: nusb::Endpoint<Bulk, Out> = state
        .interface
        .endpoint::<Bulk, Out>(ENDPOINT_OUT)
        .map_err(|e| format!("endpoint: {e}"))?;

    // Send header
    let header_result = ep.transfer_blocking(FRAME_HEADER.to_vec().into(), USB_TIMEOUT);
    header_result
        .into_result()
        .map_err(|e| format!("header transfer: {e}"))?;

    // Send frame data
    let frame_result = ep.transfer_blocking(frame_buf.into(), USB_TIMEOUT);
    frame_result
        .into_result()
        .map_err(|e| format!("frame transfer: {e}"))?;

    Ok(())
}

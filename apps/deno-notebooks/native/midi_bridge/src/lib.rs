mod input;
mod output;
mod packet;
mod ports;

use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use input::InputHandle;
use output::OutputHandle;

pub type Callback = extern "C" fn(*const u8, u32);

static NEXT_HANDLE: AtomicU32 = AtomicU32::new(1);
static INPUTS: Lazy<Mutex<HashMap<u32, InputHandle>>> = Lazy::new(|| Mutex::new(HashMap::new()));
static OUTPUTS: Lazy<Mutex<HashMap<u32, OutputHandle>>> = Lazy::new(|| Mutex::new(HashMap::new()));

fn next_handle() -> u32 {
    NEXT_HANDLE.fetch_add(1, Ordering::Relaxed)
}

#[no_mangle]
pub unsafe extern "C" fn midi_list_inputs(out_ptr: *mut u8, out_cap: u32) -> u32 {
    write_json_buffer(ports::list_inputs_json(), out_ptr, out_cap)
}

#[no_mangle]
pub unsafe extern "C" fn midi_list_outputs(out_ptr: *mut u8, out_cap: u32) -> u32 {
    write_json_buffer(ports::list_outputs_json(), out_ptr, out_cap)
}

#[no_mangle]
pub unsafe extern "C" fn midi_open_input(
    port_id_ptr: *const u8,
    port_id_len: u32,
    rate_hz: u32,
    flags: u32,
    cb: Callback,
) -> u32 {
    if port_id_ptr.is_null() || port_id_len == 0 {
        return 0;
    }
    let bytes = std::slice::from_raw_parts(port_id_ptr, port_id_len as usize);
    let port_id = match std::str::from_utf8(bytes) {
        Ok(s) => s,
        Err(_) => return 0,
    };
    match input::open_input(port_id, rate_hz, flags, cb) {
        Ok(handle) => {
            let id = next_handle();
            INPUTS.lock().unwrap().insert(id, handle);
            id
        }
        Err(_) => 0,
    }
}

#[no_mangle]
pub unsafe extern "C" fn midi_close_input(handle: u32) {
    if let Some(input) = INPUTS.lock().unwrap().remove(&handle) {
        input.close();
    }
}

#[no_mangle]
pub unsafe extern "C" fn midi_open_output(port_id_ptr: *const u8, port_id_len: u32) -> u32 {
    if port_id_ptr.is_null() || port_id_len == 0 {
        return 0;
    }
    let bytes = std::slice::from_raw_parts(port_id_ptr, port_id_len as usize);
    let port_id = match std::str::from_utf8(bytes) {
        Ok(s) => s,
        Err(_) => return 0,
    };
    match OutputHandle::open(port_id) {
        Ok(handle) => {
            let id = next_handle();
            OUTPUTS.lock().unwrap().insert(id, handle);
            id
        }
        Err(_) => 0,
    }
}

#[no_mangle]
pub unsafe extern "C" fn midi_close_output(handle: u32) {
    let _ = OUTPUTS.lock().unwrap().remove(&handle);
}

#[no_mangle]
pub unsafe extern "C" fn midi_send(handle: u32, bytes_ptr: *const u8, len: u32) -> i32 {
    if bytes_ptr.is_null() || len == 0 {
        return -1;
    }
    let bytes = std::slice::from_raw_parts(bytes_ptr, len as usize);
    let mut outputs = OUTPUTS.lock().unwrap();
    let output = match outputs.get_mut(&handle) {
        Some(o) => o,
        None => return -1,
    };
    match output.send(bytes) {
        Ok(_) => 0,
        Err(_) => -1,
    }
}

fn write_json_buffer(bytes: Vec<u8>, out_ptr: *mut u8, out_cap: u32) -> u32 {
    let needed = bytes.len() as u32;
    if out_ptr.is_null() || out_cap == 0 {
        return needed;
    }
    if out_cap < needed {
        return needed;
    }
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), out_ptr, bytes.len());
    }
    needed
}

use crossbeam_channel::{bounded, Receiver};
use midir::{Ignore, MidiInput, MidiInputConnection};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::packet::{
    encode_packet, Record, KIND_CC, KIND_CH_PRESS, KIND_NOTE, KIND_PB, KIND_POLY_PRESS, KIND_PROG,
};
use crate::Callback;

const RAW_QUEUE_CAP: usize = 4096;
const NOTE_QUEUE_CAP: usize = 4096;

pub struct InputHandle {
    stop: Arc<AtomicBool>,
    callback_enabled: Arc<AtomicBool>,
    conn: Option<MidiInputConnection<()>>,
    coalescer_join: Option<JoinHandle<()>>,
    dispatch_join: Option<JoinHandle<()>>,
}

impl InputHandle {
    pub fn close(mut self) {
        self.callback_enabled.store(false, Ordering::Relaxed);
        self.stop.store(true, Ordering::Relaxed);
        drop(self.conn.take());
        let _ = self.coalescer_join.take();
        let _ = self.dispatch_join.take();
    }
}

struct RawMsg {
    ts_us: u64,
    status: u8,
    data1: u8,
    data2: u8,
    len: u8,
}

struct NoteEdge {
    ts_us: u64,
    channel: u8,
    note: u8,
    velocity: u8,
    on: bool,
}

struct SharedState {
    state: Mutex<State>,
    notes: Mutex<VecDeque<NoteEdge>>,
    dropped_raw: AtomicU32,
    dropped_note: AtomicU32,
}

impl SharedState {
    fn new() -> Self {
        Self {
            state: Mutex::new(State::default()),
            notes: Mutex::new(VecDeque::with_capacity(NOTE_QUEUE_CAP)),
            dropped_raw: AtomicU32::new(0),
            dropped_note: AtomicU32::new(0),
        }
    }
}

#[derive(Clone)]
struct State {
    cc: [[u8; 128]; 16],
    cc_ts: [[u64; 128]; 16],
    cc_dirty: [[u64; 2]; 16],
    pb: [i16; 16],
    pb_ts: [u64; 16],
    pb_dirty: [bool; 16],
    ch_pressure: [u8; 16],
    ch_pressure_ts: [u64; 16],
    ch_pressure_dirty: [bool; 16],
    program: [u8; 16],
    program_ts: [u64; 16],
    program_dirty: [bool; 16],
    poly_pressure: [[u8; 128]; 16],
    poly_pressure_ts: [[u64; 128]; 16],
    poly_pressure_dirty: [[u64; 2]; 16],
}

impl Default for State {
    fn default() -> Self {
        Self {
            cc: [[0; 128]; 16],
            cc_ts: [[0; 128]; 16],
            cc_dirty: [[0; 2]; 16],
            pb: [0; 16],
            pb_ts: [0; 16],
            pb_dirty: [false; 16],
            ch_pressure: [0; 16],
            ch_pressure_ts: [0; 16],
            ch_pressure_dirty: [false; 16],
            program: [0; 16],
            program_ts: [0; 16],
            program_dirty: [false; 16],
            poly_pressure: [[0; 128]; 16],
            poly_pressure_ts: [[0; 128]; 16],
            poly_pressure_dirty: [[0; 2]; 16],
        }
    }
}

pub fn open_input(
    port_id: &str,
    rate_hz: u32,
    _flags: u32,
    cb: Callback,
) -> Result<InputHandle, String> {
    let mut midi_in = MidiInput::new("midi-bridge-in")
        .map_err(|e| format!("midi input init failed: {e:?}"))?;
    midi_in.ignore(Ignore::None);
    let port = midi_in
        .find_port_by_id(port_id.to_string())
        .ok_or_else(|| "input port not found".to_string())?;

    let shared = Arc::new(SharedState::new());
    let stop = Arc::new(AtomicBool::new(false));
    let (raw_tx, raw_rx) = bounded::<RawMsg>(RAW_QUEUE_CAP);
    let callback_enabled = Arc::new(AtomicBool::new(true));

    let cb_stop = stop.clone();
    let cb_shared = shared.clone();

    let conn = midi_in
        .connect(
            &port,
            "midi-bridge-in",
            move |ts, msg, _| {
                if cb_stop.load(Ordering::Relaxed) {
                    return;
                }
                if msg.is_empty() {
                    return;
                }
                let status = msg[0];
                if status < 0x80 || status >= 0xF0 {
                    return;
                }
                let len = msg.len();
                let data1 = if len > 1 { msg[1] } else { 0 };
                let data2 = if len > 2 { msg[2] } else { 0 };
                let raw = RawMsg {
                    ts_us: ts,
                    status,
                    data1,
                    data2,
                    len: len.min(255) as u8,
                };
                if raw_tx.try_send(raw).is_err() {
                    cb_shared.dropped_raw.fetch_add(1, Ordering::Relaxed);
                }
            },
            (),
        )
        .map_err(|e| format!("input connect failed: {e:?}"))?;

    let coalescer_shared = shared.clone();
    let coalescer_stop = stop.clone();
    let coalescer_join = thread::spawn(move || coalescer_loop(raw_rx, coalescer_shared, coalescer_stop));

    let dispatch_shared = shared.clone();
    let dispatch_stop = stop.clone();
    let dispatch_cb_enabled = callback_enabled.clone();
    let rate = if rate_hz == 0 { 250 } else { rate_hz };
    let start = Instant::now();
    let dispatch_join = thread::spawn(move || {
        dispatch_loop(
            dispatch_shared,
            dispatch_stop,
            dispatch_cb_enabled,
            cb,
            start,
            rate,
        )
    });

    Ok(InputHandle {
        stop,
        callback_enabled,
        conn: Some(conn),
        coalescer_join: Some(coalescer_join),
        dispatch_join: Some(dispatch_join),
    })
}

fn coalescer_loop(raw_rx: Receiver<RawMsg>, shared: Arc<SharedState>, stop: Arc<AtomicBool>) {
    while !stop.load(Ordering::Relaxed) {
        match raw_rx.recv_timeout(Duration::from_millis(5)) {
            Ok(raw) => {
                handle_raw(raw, &shared);
                for raw in raw_rx.try_iter() {
                    handle_raw(raw, &shared);
                }
            }
            Err(crossbeam_channel::RecvTimeoutError::Timeout) => {}
            Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn handle_raw(raw: RawMsg, shared: &SharedState) {
    let status = raw.status & 0xF0;
    let channel = raw.status & 0x0F;
    match status {
        0x80 => {
            if raw.len >= 3 {
                push_note(shared, raw.ts_us, channel, raw.data1, raw.data2, false);
            }
        }
        0x90 => {
            if raw.len >= 3 {
                let on = raw.data2 != 0;
                push_note(shared, raw.ts_us, channel, raw.data1, raw.data2, on);
            }
        }
        0xA0 => {
            if raw.len >= 3 {
                let mut state = shared.state.lock().unwrap();
                update_poly_pressure(&mut state, channel, raw.data1, raw.data2, raw.ts_us);
            }
        }
        0xB0 => {
            if raw.len >= 3 {
                let mut state = shared.state.lock().unwrap();
                update_cc(&mut state, channel, raw.data1, raw.data2, raw.ts_us);
            }
        }
        0xC0 => {
            if raw.len >= 2 {
                let mut state = shared.state.lock().unwrap();
                update_program(&mut state, channel, raw.data1, raw.ts_us);
            }
        }
        0xD0 => {
            if raw.len >= 2 {
                let mut state = shared.state.lock().unwrap();
                update_ch_pressure(&mut state, channel, raw.data1, raw.ts_us);
            }
        }
        0xE0 => {
            if raw.len >= 3 {
                let mut state = shared.state.lock().unwrap();
                update_pitch_bend(&mut state, channel, raw.data1, raw.data2, raw.ts_us);
            }
        }
        _ => {}
    }
}

fn push_note(shared: &SharedState, ts_us: u64, channel: u8, note: u8, velocity: u8, on: bool) {
    let edge = NoteEdge {
        ts_us,
        channel,
        note,
        velocity,
        on,
    };
    let mut notes = shared.notes.lock().unwrap();
    if notes.len() >= NOTE_QUEUE_CAP {
        notes.pop_front();
        shared.dropped_note.fetch_add(1, Ordering::Relaxed);
    }
    notes.push_back(edge);
}

fn update_cc(state: &mut State, channel: u8, ctrl: u8, val: u8, ts_us: u64) {
    let ch = channel as usize;
    let idx = ctrl as usize;
    if state.cc[ch][idx] != val {
        state.cc[ch][idx] = val;
        state.cc_ts[ch][idx] = ts_us;
        set_bit(&mut state.cc_dirty[ch], ctrl);
    }
}

fn update_pitch_bend(state: &mut State, channel: u8, lsb: u8, msb: u8, ts_us: u64) {
    let ch = channel as usize;
    let raw = ((msb as i16) << 7) | (lsb as i16);
    let bend = raw - 8192;
    if state.pb[ch] != bend {
        state.pb[ch] = bend;
        state.pb_ts[ch] = ts_us;
        state.pb_dirty[ch] = true;
    }
}

fn update_ch_pressure(state: &mut State, channel: u8, pressure: u8, ts_us: u64) {
    let ch = channel as usize;
    if state.ch_pressure[ch] != pressure {
        state.ch_pressure[ch] = pressure;
        state.ch_pressure_ts[ch] = ts_us;
        state.ch_pressure_dirty[ch] = true;
    }
}

fn update_program(state: &mut State, channel: u8, program: u8, ts_us: u64) {
    let ch = channel as usize;
    if state.program[ch] != program {
        state.program[ch] = program;
        state.program_ts[ch] = ts_us;
        state.program_dirty[ch] = true;
    }
}

fn update_poly_pressure(state: &mut State, channel: u8, note: u8, pressure: u8, ts_us: u64) {
    let ch = channel as usize;
    let idx = note as usize;
    if state.poly_pressure[ch][idx] != pressure {
        state.poly_pressure[ch][idx] = pressure;
        state.poly_pressure_ts[ch][idx] = ts_us;
        set_bit(&mut state.poly_pressure_dirty[ch], note);
    }
}

fn set_bit(bits: &mut [u64; 2], index: u8) {
    let idx = (index as usize) / 64;
    let shift = (index as usize) % 64;
    bits[idx] |= 1u64 << shift;
}

fn collect_bitset(bits: [u64; 2]) -> Vec<u8> {
    let mut indices = Vec::new();
    for block in 0..2 {
        let mut val = bits[block];
        while val != 0 {
            let tz = val.trailing_zeros() as usize;
            let idx = (block * 64 + tz) as u8;
            indices.push(idx);
            val &= val - 1;
        }
    }
    indices
}

fn dispatch_loop(
    shared: Arc<SharedState>,
    stop: Arc<AtomicBool>,
    callback_enabled: Arc<AtomicBool>,
    cb: Callback,
    start: Instant,
    rate_hz: u32,
) {
    let rate = rate_hz.max(1);
    let period = Duration::from_secs_f64(1.0 / rate as f64);
    let mut next_tick = Instant::now() + period;
    while !stop.load(Ordering::Relaxed) {
        let now = Instant::now();
        if now < next_tick {
            thread::sleep(next_tick - now);
        }
        let now = Instant::now();
        if now > next_tick + period {
            next_tick = now + period;
        } else {
            next_tick += period;
        }

        let dispatch_ts_us = start.elapsed().as_micros() as u64;
        let dropped_raw = shared.dropped_raw.swap(0, Ordering::Relaxed);
        let dropped_note = shared.dropped_note.swap(0, Ordering::Relaxed);

        let mut records: Vec<Record> = Vec::new();

        {
            let mut notes = shared.notes.lock().unwrap();
            while let Some(edge) = notes.pop_front() {
                records.push(Record {
                    ts_us: edge.ts_us,
                    kind: KIND_NOTE,
                    channel: edge.channel,
                    a: edge.note,
                    b: edge.velocity,
                    v16: 0,
                    extra: if edge.on { 1 } else { 0 },
                });
            }
        }

        {
            let mut state = shared.state.lock().unwrap();
            for ch in 0..16 {
                let cc_indices = collect_bitset(state.cc_dirty[ch]);
                state.cc_dirty[ch] = [0; 2];
                for cc in cc_indices {
                    let idx = cc as usize;
                    records.push(Record {
                        ts_us: state.cc_ts[ch][idx],
                        kind: KIND_CC,
                        channel: ch as u8,
                        a: cc,
                        b: state.cc[ch][idx],
                        v16: 0,
                        extra: 0,
                    });
                }

                if state.pb_dirty[ch] {
                    records.push(Record {
                        ts_us: state.pb_ts[ch],
                        kind: KIND_PB,
                        channel: ch as u8,
                        a: 0,
                        b: 0,
                        v16: state.pb[ch],
                        extra: 0,
                    });
                    state.pb_dirty[ch] = false;
                }

                if state.ch_pressure_dirty[ch] {
                    records.push(Record {
                        ts_us: state.ch_pressure_ts[ch],
                        kind: KIND_CH_PRESS,
                        channel: ch as u8,
                        a: 0,
                        b: state.ch_pressure[ch],
                        v16: 0,
                        extra: 0,
                    });
                    state.ch_pressure_dirty[ch] = false;
                }

                if state.program_dirty[ch] {
                    records.push(Record {
                        ts_us: state.program_ts[ch],
                        kind: KIND_PROG,
                        channel: ch as u8,
                        a: 0,
                        b: state.program[ch],
                        v16: 0,
                        extra: 0,
                    });
                    state.program_dirty[ch] = false;
                }

                let poly_indices = collect_bitset(state.poly_pressure_dirty[ch]);
                state.poly_pressure_dirty[ch] = [0; 2];
                for note in poly_indices {
                    let idx = note as usize;
                    records.push(Record {
                        ts_us: state.poly_pressure_ts[ch][idx],
                        kind: KIND_POLY_PRESS,
                        channel: ch as u8,
                        a: note,
                        b: state.poly_pressure[ch][idx],
                        v16: 0,
                        extra: 0,
                    });
                }
            }
        }

        if stop.load(Ordering::Relaxed) {
            break;
        }

        if records.is_empty() && dropped_raw == 0 && dropped_note == 0 {
            continue;
        }

        records.sort_by_key(|r| r.ts_us);
        let packet = encode_packet(&records, dispatch_ts_us, dropped_raw, dropped_note, 0);
        if callback_enabled.load(Ordering::Relaxed) {
            cb(packet.as_ptr(), packet.len() as u32);
        }
    }
}

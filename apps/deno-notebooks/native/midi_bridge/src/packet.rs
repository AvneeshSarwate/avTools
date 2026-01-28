pub const MAGIC: u32 = 0x4D494452; // "MIDR"
pub const VERSION: u16 = 1;

pub const KIND_CC: u8 = 1;
pub const KIND_PB: u8 = 2;
pub const KIND_CH_PRESS: u8 = 3;
pub const KIND_POLY_PRESS: u8 = 4;
pub const KIND_PROG: u8 = 5;
pub const KIND_NOTE: u8 = 6;

#[derive(Clone, Copy)]
pub struct Record {
    pub ts_us: u64,
    pub kind: u8,
    pub channel: u8,
    pub a: u8,
    pub b: u8,
    pub v16: i16,
    pub extra: u16,
}

pub fn encode_packet(
    records: &Vec<Record>,
    dispatch_ts_us: u64,
    dropped_raw: u32,
    dropped_note: u32,
    flags: u16,
) -> Vec<u8> {
    let mut buf = Vec::with_capacity(32 + records.len() * 16);
    push_u32(&mut buf, MAGIC);
    push_u16(&mut buf, VERSION);
    push_u16(&mut buf, flags);
    push_u64(&mut buf, dispatch_ts_us);
    push_u32(&mut buf, dropped_raw);
    push_u32(&mut buf, dropped_note);
    push_u32(&mut buf, records.len() as u32);
    push_u32(&mut buf, 0);

    for r in records {
        push_u64(&mut buf, r.ts_us);
        buf.push(r.kind);
        buf.push(r.channel);
        buf.push(r.a);
        buf.push(r.b);
        push_i16(&mut buf, r.v16);
        push_u16(&mut buf, r.extra);
    }

    buf
}

fn push_u16(buf: &mut Vec<u8>, v: u16) {
    buf.extend_from_slice(&v.to_le_bytes());
}

fn push_u32(buf: &mut Vec<u8>, v: u32) {
    buf.extend_from_slice(&v.to_le_bytes());
}

fn push_u64(buf: &mut Vec<u8>, v: u64) {
    buf.extend_from_slice(&v.to_le_bytes());
}

fn push_i16(buf: &mut Vec<u8>, v: i16) {
    buf.extend_from_slice(&v.to_le_bytes());
}

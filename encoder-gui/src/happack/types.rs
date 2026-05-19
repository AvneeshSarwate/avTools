use serde::Serialize;

#[derive(Debug, Clone)]
pub struct HapFrameSample {
    pub timestamp_us: u64,
    pub duration_us: u32,
    pub flags: u32,
    pub source_offset: u64,
    pub byte_length: u64,
}

#[derive(Debug, Clone)]
pub struct HapMovie {
    pub fourcc: String,
    pub width: u32,
    pub height: u32,
    pub timescale: u32,
    pub samples: Vec<HapFrameSample>,
}

impl HapMovie {
    pub fn duration_us(&self) -> u64 {
        self.samples
            .last()
            .map(|sample| sample.timestamp_us + sample.duration_us as u64)
            .unwrap_or(0)
    }

    pub fn inferred_frame_rate(&self) -> (u32, u32) {
        let Some(first) = self.samples.first() else {
            return (0, 1);
        };
        if first.duration_us == 0 {
            return (0, 1);
        }
        reduce_fraction(1_000_000, first.duration_us)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HapPackMetadata {
    pub version: u32,
    pub codec: String,
    pub hap_flavor: String,
    pub gpu_format: String,
    pub color_model: String,
    pub width: u32,
    pub height: u32,
    pub frame_rate_numerator: u32,
    pub frame_rate_denominator: u32,
    pub timescale: u32,
    pub frame_count: u64,
    pub duration_us: u64,
    pub has_audio: bool,
    pub chunks: u32,
    pub compressor: String,
    pub decode_index: Vec<FrameDecodeInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameDecodeInfo {
    pub hap_section_type: u8,
    pub chunks: Vec<HapChunkDecodeInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HapChunkDecodeInfo {
    pub compressor: String,
    pub payload_offset_in_frame: u64,
    pub compressed_byte_length: u64,
    pub decoded_byte_length: u64,
    pub decoded_offset_in_bc3_frame: u64,
}

pub const HAPPACK_MAGIC: &[u8; 8] = b"HAPPACK\0";
pub const HAPPACK_VERSION: u32 = 2;
pub const HAPPACK_HEADER_SIZE: u32 = 64;
pub const HAPPACK_INDEX_ENTRY_SIZE: u32 = 32;
pub const FRAME_FLAG_KEYFRAME: u32 = 0x0000_0001;

fn reduce_fraction(numerator: u32, denominator: u32) -> (u32, u32) {
    fn gcd(mut a: u32, mut b: u32) -> u32 {
        while b != 0 {
            let next = a % b;
            a = b;
            b = next;
        }
        a.max(1)
    }
    let divisor = gcd(numerator, denominator);
    (numerator / divisor, denominator / divisor)
}

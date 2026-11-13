use rayon::prelude::*;
use serde::Deserialize;
use std::cell::RefCell;
use std::cmp::min;
use std::fs::File;
use std::io::{self, ErrorKind, Read};
use std::path::PathBuf;
use std::slice;
use std::time::Instant;

const MAGIC: &[u8; 8] = b"HAPPACK\0";
const HEADER_SIZE: usize = 64;
const INDEX_ENTRY_SIZE: usize = 32;
const STATS_SIZE: usize = 56;

type HapResult<T> = Result<T, String>;

thread_local! {
    static LAST_ERROR: RefCell<String> = RefCell::new(String::new());
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Compressor {
    None,
    Snappy,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HapPackMetadata {
    version: u32,
    codec: String,
    hap_flavor: String,
    gpu_format: String,
    color_model: String,
    width: u32,
    height: u32,
    frame_rate_numerator: u32,
    frame_rate_denominator: u32,
    frame_count: u32,
    duration_us: u64,
    chunks: u32,
    compressor: Compressor,
    decode_index: Vec<FrameDecodeInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct FrameDecodeInfo {
    hap_section_type: u32,
    chunks: Vec<HapChunkDecodeInfo>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HapChunkDecodeInfo {
    compressor: Compressor,
    payload_offset_in_frame: u64,
    compressed_byte_length: u32,
    decoded_byte_length: u32,
    decoded_offset_in_bc3_frame: u32,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
struct FrameIndexEntry {
    timestamp_us: u64,
    duration_us: u32,
    flags: u32,
    offset: u64,
    byte_length: u64,
}

struct DecodeStats {
    read_ms: f64,
    decode_ms: f64,
    total_ms: f64,
    compressed_bytes: f64,
    decoded_bytes: f64,
    chunk_count: u32,
    worker_count: u32,
    frame_index: u32,
}

pub struct HapDecoder {
    file: File,
    metadata: HapPackMetadata,
    index: Vec<FrameIndexEntry>,
    decoded_byte_length: u32,
    worker_count: u32,
    pool: rayon::ThreadPool,
}

#[no_mangle]
pub unsafe extern "C" fn hap_decoder_open(
    path_ptr: *const u8,
    path_len: u32,
    worker_count: u32,
) -> *mut HapDecoder {
    clear_last_error();
    if path_ptr.is_null() {
        set_last_error("path pointer is null");
        return std::ptr::null_mut();
    }

    let path_bytes = slice::from_raw_parts(path_ptr, path_len as usize);
    let path = match std::str::from_utf8(path_bytes) {
        Ok(path) => PathBuf::from(path),
        Err(err) => {
            set_last_error(format!("path is not utf-8: {err}"));
            return std::ptr::null_mut();
        }
    };

    match HapDecoder::open(path, worker_count) {
        Ok(decoder) => Box::into_raw(Box::new(decoder)),
        Err(err) => {
            set_last_error(err);
            std::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn hap_decoder_close(decoder: *mut HapDecoder) {
    if !decoder.is_null() {
        drop(Box::from_raw(decoder));
    }
}

#[no_mangle]
pub unsafe extern "C" fn hap_decoder_last_error(out_ptr: *mut u8, out_len: u32) -> u32 {
    LAST_ERROR.with(|slot| {
        let message = slot.borrow();
        let bytes = message.as_bytes();
        if !out_ptr.is_null() && out_len > 0 {
            let writable = min(bytes.len(), out_len as usize);
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), out_ptr, writable);
        }
        bytes.len() as u32
    })
}

#[no_mangle]
pub unsafe extern "C" fn hap_decoder_width(decoder: *const HapDecoder) -> u32 {
    decoder.as_ref().map(|d| d.metadata.width).unwrap_or(0)
}

#[no_mangle]
pub unsafe extern "C" fn hap_decoder_height(decoder: *const HapDecoder) -> u32 {
    decoder.as_ref().map(|d| d.metadata.height).unwrap_or(0)
}

#[no_mangle]
pub unsafe extern "C" fn hap_decoder_frame_count(decoder: *const HapDecoder) -> u32 {
    decoder
        .as_ref()
        .map(|d| d.metadata.frame_count)
        .unwrap_or(0)
}

#[no_mangle]
pub unsafe extern "C" fn hap_decoder_frame_rate(decoder: *const HapDecoder) -> f64 {
    decoder
        .as_ref()
        .map(|d| d.metadata.frame_rate_numerator as f64 / d.metadata.frame_rate_denominator as f64)
        .unwrap_or(0.0)
}

#[no_mangle]
pub unsafe extern "C" fn hap_decoder_duration_seconds(decoder: *const HapDecoder) -> f64 {
    decoder
        .as_ref()
        .map(|d| d.metadata.duration_us as f64 / 1_000_000.0)
        .unwrap_or(0.0)
}

#[no_mangle]
pub unsafe extern "C" fn hap_decoder_decoded_byte_length(decoder: *const HapDecoder) -> u32 {
    decoder.as_ref().map(|d| d.decoded_byte_length).unwrap_or(0)
}

#[no_mangle]
pub unsafe extern "C" fn hap_decoder_chunk_count(decoder: *const HapDecoder) -> u32 {
    decoder.as_ref().map(|d| d.metadata.chunks).unwrap_or(0)
}

#[no_mangle]
pub unsafe extern "C" fn hap_decoder_compressor(decoder: *const HapDecoder) -> u32 {
    decoder
        .as_ref()
        .map(|d| match d.metadata.compressor {
            Compressor::None => 0,
            Compressor::Snappy => 1,
        })
        .unwrap_or(0)
}

#[no_mangle]
pub unsafe extern "C" fn hap_decoder_decode_frame(
    decoder: *mut HapDecoder,
    frame_index: u32,
    output_ptr: *mut u8,
    output_len: u32,
    stats_ptr: *mut u8,
    stats_len: u32,
) -> i32 {
    clear_last_error();
    let Some(decoder) = decoder.as_ref() else {
        set_last_error("decoder pointer is null");
        return -1;
    };
    if output_ptr.is_null() {
        set_last_error("output pointer is null");
        return -2;
    }

    let output = slice::from_raw_parts_mut(output_ptr, output_len as usize);
    match decoder.decode_frame(frame_index, output) {
        Ok(stats) => {
            write_stats(stats_ptr, stats_len, &stats);
            0
        }
        Err(err) => {
            set_last_error(err);
            -3
        }
    }
}

impl HapDecoder {
    fn open(path: PathBuf, worker_count: u32) -> HapResult<Self> {
        let mut file =
            File::open(&path).map_err(|err| format!("open {}: {err}", path.display()))?;

        let mut header = [0u8; HEADER_SIZE];
        file.read_exact(&mut header)
            .map_err(|err| format!("read happack header: {err}"))?;

        if &header[0..8] != MAGIC {
            return Err("not a happack file: missing HAPPACK magic".to_string());
        }
        let version = read_u32(&header, 8)?;
        let header_size = read_u32(&header, 12)? as usize;
        if version != 2 {
            return Err(format!("unsupported happack version {version}; expected 2"));
        }
        if header_size < HEADER_SIZE {
            return Err(format!(
                "invalid header size {header_size}; expected at least {HEADER_SIZE}"
            ));
        }

        let metadata_offset = read_u64(&header, 16)?;
        let metadata_length = read_u64(&header, 24)?;
        let index_offset = read_u64(&header, 32)?;
        let index_entry_count = read_u64(&header, 40)?;
        let index_entry_size = read_u32(&header, 48)? as usize;
        if index_entry_size != INDEX_ENTRY_SIZE {
            return Err(format!(
                "unsupported index entry size {index_entry_size}; expected {INDEX_ENTRY_SIZE}"
            ));
        }
        if metadata_length > u32::MAX as u64 {
            return Err(format!("metadata is too large: {metadata_length} bytes"));
        }
        if index_entry_count > u32::MAX as u64 {
            return Err(format!("too many frames in index: {index_entry_count}"));
        }

        let mut metadata_bytes = vec![0u8; metadata_length as usize];
        read_exact_at(&file, &mut metadata_bytes, metadata_offset)
            .map_err(|err| format!("read metadata: {err}"))?;
        let metadata: HapPackMetadata = serde_json::from_slice(&metadata_bytes)
            .map_err(|err| format!("parse metadata json: {err}"))?;

        let index = read_index(&file, index_offset, index_entry_count as usize)?;
        let decoded_byte_length = expected_bc3_byte_length(metadata.width, metadata.height)?;
        validate_metadata(&metadata, &index, decoded_byte_length)?;

        let workers = if worker_count == 0 {
            std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(1)
        } else {
            worker_count as usize
        }
        .max(1);
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(workers)
            .thread_name(|i| format!("hap-decoder-{i}"))
            .build()
            .map_err(|err| format!("create rayon pool: {err}"))?;

        Ok(Self {
            file,
            metadata,
            index,
            decoded_byte_length,
            worker_count: workers as u32,
            pool,
        })
    }

    fn decode_frame(&self, frame_index: u32, output: &mut [u8]) -> HapResult<DecodeStats> {
        let total_start = Instant::now();
        let frame = self
            .metadata
            .decode_index
            .get(frame_index as usize)
            .ok_or_else(|| format!("frame index {frame_index} is out of range"))?;
        let index_entry = self
            .index
            .get(frame_index as usize)
            .ok_or_else(|| format!("index entry {frame_index} is out of range"))?;

        let required = self.decoded_byte_length as usize;
        if output.len() < required {
            return Err(format!(
                "output buffer too small: got {}, need {required}",
                output.len()
            ));
        }
        let output = &mut output[..required];

        let chunks = &frame.chunks;
        let compressed_bytes: u64 = chunks
            .iter()
            .map(|chunk| chunk.compressed_byte_length as u64)
            .sum();
        let decoded_bytes: u64 = chunks
            .iter()
            .map(|chunk| chunk.decoded_byte_length as u64)
            .sum();

        let read_start = Instant::now();
        let compressed = self.pool.install(|| {
            chunks
                .par_iter()
                .map(|chunk| {
                    let mut bytes = vec![0u8; chunk.compressed_byte_length as usize];
                    let offset = index_entry.offset + chunk.payload_offset_in_frame;
                    read_exact_at(&self.file, &mut bytes, offset).map_err(|err| {
                        format!("read frame {frame_index} chunk at {offset}: {err}")
                    })?;
                    Ok(bytes)
                })
                .collect::<HapResult<Vec<Vec<u8>>>>()
        })?;
        let read_ms = read_start.elapsed().as_secs_f64() * 1000.0;

        let decode_start = Instant::now();
        let output_addr = output.as_mut_ptr() as usize;
        self.pool.install(|| {
            chunks
                .par_iter()
                .zip(compressed.par_iter())
                .try_for_each(|(chunk, input)| {
                    let decoded_len = chunk.decoded_byte_length as usize;
                    let decoded_offset = chunk.decoded_offset_in_bc3_frame as usize;
                    let end = decoded_offset
                        .checked_add(decoded_len)
                        .ok_or_else(|| "decoded chunk offset overflow".to_string())?;
                    if end > required {
                        return Err(format!(
                            "decoded chunk range {decoded_offset}..{end} exceeds frame size {required}"
                        ));
                    }

                    let out = unsafe {
                        slice::from_raw_parts_mut((output_addr + decoded_offset) as *mut u8, decoded_len)
                    };
                    match chunk.compressor {
                        Compressor::None => {
                            if input.len() != decoded_len {
                                return Err(format!(
                                    "uncompressed chunk length mismatch: input {}, decoded {decoded_len}",
                                    input.len()
                                ));
                            }
                            out.copy_from_slice(input);
                        }
                        Compressor::Snappy => {
                            let written = snap::raw::Decoder::new()
                                .decompress(input, out)
                                .map_err(|err| format!("snappy decode: {err}"))?;
                            if written != decoded_len {
                                return Err(format!(
                                    "snappy decoded {written} bytes, expected {decoded_len}"
                                ));
                            }
                        }
                    }
                    Ok(())
                })
        })?;
        let decode_ms = decode_start.elapsed().as_secs_f64() * 1000.0;

        Ok(DecodeStats {
            read_ms,
            decode_ms,
            total_ms: total_start.elapsed().as_secs_f64() * 1000.0,
            compressed_bytes: compressed_bytes as f64,
            decoded_bytes: decoded_bytes as f64,
            chunk_count: chunks.len() as u32,
            worker_count: self.worker_count,
            frame_index,
        })
    }
}

fn validate_metadata(
    metadata: &HapPackMetadata,
    index: &[FrameIndexEntry],
    decoded_byte_length: u32,
) -> HapResult<()> {
    if metadata.version != 2 {
        return Err(format!(
            "metadata version {} does not match happack v2",
            metadata.version
        ));
    }
    if metadata.codec != "HapY" {
        return Err(format!(
            "unsupported codec {}; expected HapY",
            metadata.codec
        ));
    }
    if metadata.hap_flavor != "hap_q" {
        return Err(format!(
            "unsupported hapFlavor {}; expected hap_q",
            metadata.hap_flavor
        ));
    }
    if metadata.gpu_format != "bc3-rgba-unorm" {
        return Err(format!(
            "unsupported gpuFormat {}; expected bc3-rgba-unorm",
            metadata.gpu_format
        ));
    }
    if metadata.color_model != "scaled-ycocg" {
        return Err(format!(
            "unsupported colorModel {}; expected scaled-ycocg",
            metadata.color_model
        ));
    }
    if metadata.width == 0 || metadata.height == 0 {
        return Err("metadata width/height must be non-zero".to_string());
    }
    if metadata.frame_rate_numerator == 0 || metadata.frame_rate_denominator == 0 {
        return Err("metadata frame rate must be non-zero".to_string());
    }
    if metadata.frame_count as usize != index.len() {
        return Err(format!(
            "frameCount {} does not match index length {}",
            metadata.frame_count,
            index.len()
        ));
    }
    if metadata.decode_index.len() != index.len() {
        return Err(format!(
            "decodeIndex length {} does not match index length {}",
            metadata.decode_index.len(),
            index.len()
        ));
    }

    for (frame_idx, (frame, entry)) in metadata.decode_index.iter().zip(index.iter()).enumerate() {
        if frame.chunks.is_empty() {
            return Err(format!("frame {frame_idx} has no chunks"));
        }
        if frame.chunks.len() > u32::MAX as usize {
            return Err(format!("frame {frame_idx} has too many chunks"));
        }
        let mut decoded_sum = 0u64;
        for (chunk_idx, chunk) in frame.chunks.iter().enumerate() {
            if chunk.compressor != metadata.compressor {
                return Err(format!(
                    "frame {frame_idx} chunk {chunk_idx} compressor does not match metadata"
                ));
            }
            let chunk_end_in_frame = chunk
                .payload_offset_in_frame
                .checked_add(chunk.compressed_byte_length as u64)
                .ok_or_else(|| format!("frame {frame_idx} chunk {chunk_idx} payload overflow"))?;
            if chunk_end_in_frame > entry.byte_length {
                return Err(format!(
                    "frame {frame_idx} chunk {chunk_idx} byte range exceeds frame byteLength"
                ));
            }
            let decoded_end = (chunk.decoded_offset_in_bc3_frame as u64)
                .checked_add(chunk.decoded_byte_length as u64)
                .ok_or_else(|| format!("frame {frame_idx} chunk {chunk_idx} decoded overflow"))?;
            if decoded_end > decoded_byte_length as u64 {
                return Err(format!(
                    "frame {frame_idx} chunk {chunk_idx} decoded range exceeds BC3 frame size"
                ));
            }
            decoded_sum += chunk.decoded_byte_length as u64;
        }
        if decoded_sum != decoded_byte_length as u64 {
            return Err(format!(
                "frame {frame_idx} decoded chunks sum to {decoded_sum}, expected {decoded_byte_length}"
            ));
        }
    }

    Ok(())
}

fn read_index(file: &File, index_offset: u64, count: usize) -> HapResult<Vec<FrameIndexEntry>> {
    let total_bytes = count
        .checked_mul(INDEX_ENTRY_SIZE)
        .ok_or_else(|| "index byte length overflow".to_string())?;
    let mut bytes = vec![0u8; total_bytes];
    read_exact_at(file, &mut bytes, index_offset).map_err(|err| format!("read index: {err}"))?;

    let mut index = Vec::with_capacity(count);
    for i in 0..count {
        let offset = i * INDEX_ENTRY_SIZE;
        index.push(FrameIndexEntry {
            timestamp_us: read_u64(&bytes, offset)?,
            duration_us: read_u32(&bytes, offset + 8)?,
            flags: read_u32(&bytes, offset + 12)?,
            offset: read_u64(&bytes, offset + 16)?,
            byte_length: read_u64(&bytes, offset + 24)?,
        });
    }
    Ok(index)
}

fn expected_bc3_byte_length(width: u32, height: u32) -> HapResult<u32> {
    let blocks_w = ((width as u64) + 3) / 4;
    let blocks_h = ((height as u64) + 3) / 4;
    let bytes = blocks_w
        .checked_mul(blocks_h)
        .and_then(|v| v.checked_mul(16))
        .ok_or_else(|| "BC3 frame byte length overflow".to_string())?;
    if bytes > u32::MAX as u64 {
        return Err(format!("BC3 frame byte length {bytes} exceeds u32::MAX"));
    }
    Ok(bytes as u32)
}

fn read_u32(bytes: &[u8], offset: usize) -> HapResult<u32> {
    let end = offset + 4;
    let slice = bytes
        .get(offset..end)
        .ok_or_else(|| format!("read_u32 out of bounds at {offset}"))?;
    Ok(u32::from_le_bytes(slice.try_into().unwrap()))
}

fn read_u64(bytes: &[u8], offset: usize) -> HapResult<u64> {
    let end = offset + 8;
    let slice = bytes
        .get(offset..end)
        .ok_or_else(|| format!("read_u64 out of bounds at {offset}"))?;
    Ok(u64::from_le_bytes(slice.try_into().unwrap()))
}

fn read_exact_at(file: &File, buf: &mut [u8], offset: u64) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::FileExt;
        let mut read = 0usize;
        while read < buf.len() {
            let n = file.read_at(&mut buf[read..], offset + read as u64)?;
            if n == 0 {
                return Err(io::Error::new(ErrorKind::UnexpectedEof, "unexpected EOF"));
            }
            read += n;
        }
        Ok(())
    }

    #[cfg(windows)]
    {
        use std::os::windows::fs::FileExt;
        let mut read = 0usize;
        while read < buf.len() {
            let n = file.seek_read(&mut buf[read..], offset + read as u64)?;
            if n == 0 {
                return Err(io::Error::new(ErrorKind::UnexpectedEof, "unexpected EOF"));
            }
            read += n;
        }
        Ok(())
    }

    #[cfg(not(any(unix, windows)))]
    {
        use std::io::{Seek, SeekFrom};

        let mut cloned = file.try_clone()?;
        cloned.seek(SeekFrom::Start(offset))?;
        cloned.read_exact(buf)
    }
}

fn write_stats(stats_ptr: *mut u8, stats_len: u32, stats: &DecodeStats) {
    if stats_ptr.is_null() || stats_len < STATS_SIZE as u32 {
        return;
    }
    unsafe {
        let out = slice::from_raw_parts_mut(stats_ptr, stats_len as usize);
        write_f64(out, 0, stats.read_ms);
        write_f64(out, 8, stats.decode_ms);
        write_f64(out, 16, stats.total_ms);
        write_f64(out, 24, stats.compressed_bytes);
        write_f64(out, 32, stats.decoded_bytes);
        write_u32(out, 40, stats.chunk_count);
        write_u32(out, 44, stats.worker_count);
        write_u32(out, 48, stats.frame_index);
    }
}

fn write_f64(out: &mut [u8], offset: usize, value: f64) {
    out[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}

fn write_u32(out: &mut [u8], offset: usize, value: u32) {
    out[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn clear_last_error() {
    LAST_ERROR.with(|slot| slot.borrow_mut().clear());
}

fn set_last_error(message: impl Into<String>) {
    LAST_ERROR.with(|slot| *slot.borrow_mut() = message.into());
}

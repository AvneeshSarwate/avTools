use crate::config::AppConfig;
use crate::encode::ffmpeg::ProbeInfo;
use crate::happack::types::{
    FrameDecodeInfo, HapChunkDecodeInfo, HapMovie, HapPackMetadata, HAPPACK_HEADER_SIZE,
    HAPPACK_INDEX_ENTRY_SIZE, HAPPACK_MAGIC, HAPPACK_VERSION,
};
use anyhow::{bail, ensure, Context, Result};
use byteorder::{LittleEndian, WriteBytesExt};
use std::fs::File;
use std::io::{copy, Read, Seek, SeekFrom, Write};
use std::path::Path;

const HAP_SCALED_YCOCG_BC3: u8 = 0xaf;
const HAP_SCALED_YCOCG_BC3_SNAPPY: u8 = 0xbf;
const HAP_SCALED_YCOCG_BC3_CHUNKED: u8 = 0xcf;
const HAP_DECODE_INSTRUCTIONS: u8 = 0x01;
const HAP_CHUNK_COMPRESSOR_TABLE: u8 = 0x02;
const HAP_CHUNK_SIZE_TABLE: u8 = 0x03;
const HAP_CHUNK_OFFSET_TABLE: u8 = 0x04;
const HAP_COMPRESSOR_NONE: u8 = 0x0a;
const HAP_COMPRESSOR_SNAPPY: u8 = 0x0b;

pub fn write_happack(
    movie: &HapMovie,
    source_mov: &Path,
    output_path: &Path,
    probe: &ProbeInfo,
    config: &AppConfig,
) -> Result<()> {
    debug_assert!(movie.timescale > 0);
    let (fallback_num, fallback_den) = movie.inferred_frame_rate();
    let frame_rate_numerator = if probe.frame_rate_numerator > 0 {
        probe.frame_rate_numerator
    } else {
        fallback_num
    };
    let frame_rate_denominator = if probe.frame_rate_denominator > 0 {
        probe.frame_rate_denominator
    } else {
        fallback_den
    };
    let default_compressor = if config.snappy {
        ParsedCompressor::Snappy
    } else {
        ParsedCompressor::None
    };
    let decode_index = build_decode_index(movie, source_mov, default_compressor)?;

    let metadata = HapPackMetadata {
        version: HAPPACK_VERSION,
        codec: movie.fourcc.clone(),
        hap_flavor: config.preset.ffmpeg_format().to_string(),
        gpu_format: "bc3-rgba-unorm".to_string(),
        color_model: "scaled-ycocg".to_string(),
        width: movie.width,
        height: movie.height,
        frame_rate_numerator,
        frame_rate_denominator,
        timescale: 1_000_000,
        frame_count: movie.samples.len() as u64,
        duration_us: movie.duration_us(),
        has_audio: false,
        chunks: config.chunks,
        compressor: if config.snappy { "snappy" } else { "none" }.to_string(),
        decode_index,
    };
    let metadata_bytes = serde_json::to_vec(&metadata)?;
    let metadata_offset = HAPPACK_HEADER_SIZE as u64;
    let index_offset = metadata_offset + metadata_bytes.len() as u64;
    let index_length = movie.samples.len() as u64 * HAPPACK_INDEX_ENTRY_SIZE as u64;
    let payload_offset = index_offset + index_length;

    let mut output = File::create(output_path)?;
    write_header(
        &mut output,
        metadata_bytes.len() as u64,
        index_offset,
        movie.samples.len() as u64,
    )?;
    output.write_all(&metadata_bytes)?;

    let mut next_payload_offset = payload_offset;
    for sample in &movie.samples {
        output.write_u64::<LittleEndian>(sample.timestamp_us)?;
        output.write_u32::<LittleEndian>(sample.duration_us)?;
        output.write_u32::<LittleEndian>(sample.flags)?;
        output.write_u64::<LittleEndian>(next_payload_offset)?;
        output.write_u64::<LittleEndian>(sample.byte_length)?;
        next_payload_offset += sample.byte_length;
    }

    let mut input = File::open(source_mov)?;
    for sample in &movie.samples {
        input.seek(SeekFrom::Start(sample.source_offset))?;
        copy(
            &mut std::io::Read::by_ref(&mut input).take(sample.byte_length),
            &mut output,
        )?;
    }
    output.flush()?;
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ParsedCompressor {
    None,
    Snappy,
}

impl ParsedCompressor {
    fn from_hap(value: u8) -> Result<Self> {
        match value {
            HAP_COMPRESSOR_NONE => Ok(Self::None),
            HAP_COMPRESSOR_SNAPPY => Ok(Self::Snappy),
            other => bail!("Unsupported HAP chunk compressor 0x{other:02x}."),
        }
    }

    fn as_metadata_value(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Snappy => "snappy",
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct HapSection {
    section_type: u8,
    data_offset: usize,
    data_length: usize,
    next_offset: usize,
}

fn build_decode_index(
    movie: &HapMovie,
    source_mov: &Path,
    default_compressor: ParsedCompressor,
) -> Result<Vec<FrameDecodeInfo>> {
    let expected_decoded_length = expected_bc3_byte_length(movie.width, movie.height);
    let mut input = File::open(source_mov)?;
    let mut decode_index = Vec::with_capacity(movie.samples.len());

    for (frame_number, sample) in movie.samples.iter().enumerate() {
        let byte_length = usize::try_from(sample.byte_length)
            .context("Frame payload is too large to inspect on this platform.")?;
        let mut frame = vec![0u8; byte_length];
        input.seek(SeekFrom::Start(sample.source_offset))?;
        input.read_exact(&mut frame)?;
        let info = parse_frame_decode_info(&frame, expected_decoded_length, default_compressor)
            .with_context(|| {
                format!("Could not build decode metadata for frame {frame_number}.")
            })?;
        decode_index.push(info);
    }

    Ok(decode_index)
}

fn parse_frame_decode_info(
    frame: &[u8],
    expected_decoded_length: u64,
    default_compressor: ParsedCompressor,
) -> Result<FrameDecodeInfo> {
    let top = parse_hap_section(frame, 0, frame.len())?;
    ensure!(
        top.next_offset == frame.len(),
        "HAP frame contains trailing bytes after the top-level section."
    );

    let chunks = match top.section_type {
        HAP_SCALED_YCOCG_BC3 => {
            single_chunk_info(frame, top, ParsedCompressor::None, expected_decoded_length)?
        }
        HAP_SCALED_YCOCG_BC3_SNAPPY => single_chunk_info(
            frame,
            top,
            ParsedCompressor::Snappy,
            expected_decoded_length,
        )?,
        HAP_SCALED_YCOCG_BC3_CHUNKED => {
            chunked_frame_info(frame, top, expected_decoded_length, default_compressor)?
        }
        other => bail!("Unsupported HAP top-level section 0x{other:02x}."),
    };

    Ok(FrameDecodeInfo {
        hap_section_type: top.section_type,
        chunks,
    })
}

fn single_chunk_info(
    frame: &[u8],
    top: HapSection,
    compressor: ParsedCompressor,
    expected_decoded_length: u64,
) -> Result<Vec<HapChunkDecodeInfo>> {
    let decoded_length = decoded_length_for_chunk(
        &frame[top.data_offset..top.next_offset],
        compressor,
        top.data_length as u64,
    )?;
    ensure!(
        decoded_length == expected_decoded_length,
        "Decoded BC3 byte length mismatch. Expected {expected_decoded_length}, got {decoded_length}."
    );

    Ok(vec![HapChunkDecodeInfo {
        compressor: compressor.as_metadata_value().to_string(),
        payload_offset_in_frame: top.data_offset as u64,
        compressed_byte_length: top.data_length as u64,
        decoded_byte_length: decoded_length,
        decoded_offset_in_bc3_frame: 0,
    }])
}

fn chunked_frame_info(
    frame: &[u8],
    top: HapSection,
    expected_decoded_length: u64,
    default_compressor: ParsedCompressor,
) -> Result<Vec<HapChunkDecodeInfo>> {
    let instruction_section = parse_hap_section(frame, top.data_offset, top.next_offset)?;
    ensure!(
        instruction_section.section_type == HAP_DECODE_INSTRUCTIONS,
        "Chunked HAP frame is missing decode instructions."
    );

    let instruction_end = instruction_section.data_offset + instruction_section.data_length;
    let mut cursor = instruction_section.data_offset;
    let mut compressors: Option<Vec<ParsedCompressor>> = None;
    let mut sizes: Option<Vec<u32>> = None;
    let mut offsets: Option<Vec<u32>> = None;

    while cursor < instruction_end {
        let child = parse_hap_section(frame, cursor, instruction_end)?;
        let data = &frame[child.data_offset..child.next_offset];
        match child.section_type {
            HAP_CHUNK_COMPRESSOR_TABLE => {
                compressors = Some(
                    data.iter()
                        .map(|value| ParsedCompressor::from_hap(*value))
                        .collect::<Result<Vec<_>>>()?,
                );
            }
            HAP_CHUNK_SIZE_TABLE => sizes = Some(read_u32_table(data)?),
            HAP_CHUNK_OFFSET_TABLE => offsets = Some(read_u32_table(data)?),
            _ => {}
        }
        cursor = child.next_offset;
    }

    let sizes = sizes.context("Chunked HAP frame is missing a size table.")?;
    ensure!(
        !sizes.is_empty(),
        "Chunked HAP frame has an empty size table."
    );
    let compressors = compressors.unwrap_or_else(|| vec![default_compressor; sizes.len()]);
    ensure!(
        compressors.len() == sizes.len(),
        "HAP compressor table length does not match chunk count."
    );
    if let Some(offsets) = &offsets {
        ensure!(
            offsets.len() == sizes.len(),
            "HAP chunk offset table length does not match chunk count."
        );
    }

    let frame_data_base = instruction_section.next_offset;
    let mut implicit_offset = 0usize;
    let mut decoded_offset = 0u64;
    let mut chunks = Vec::with_capacity(sizes.len());

    for index in 0..sizes.len() {
        let chunk_size = usize::try_from(sizes[index]).context("HAP chunk size is too large.")?;
        let chunk_offset = if let Some(offsets) = &offsets {
            usize::try_from(offsets[index]).context("HAP chunk offset is too large.")?
        } else {
            implicit_offset
        };
        implicit_offset = implicit_offset
            .checked_add(chunk_size)
            .context("Implicit HAP chunk offset overflowed.")?;

        let chunk_start = frame_data_base
            .checked_add(chunk_offset)
            .context("HAP chunk start offset overflowed.")?;
        let chunk_end = chunk_start
            .checked_add(chunk_size)
            .context("HAP chunk end offset overflowed.")?;
        ensure!(
            chunk_end <= top.next_offset,
            "HAP chunk {index} exceeds frame data bounds."
        );

        let compressor = compressors[index];
        let decoded_length = decoded_length_for_chunk(
            &frame[chunk_start..chunk_end],
            compressor,
            chunk_size as u64,
        )?;
        chunks.push(HapChunkDecodeInfo {
            compressor: compressor.as_metadata_value().to_string(),
            payload_offset_in_frame: chunk_start as u64,
            compressed_byte_length: chunk_size as u64,
            decoded_byte_length: decoded_length,
            decoded_offset_in_bc3_frame: decoded_offset,
        });
        decoded_offset = decoded_offset
            .checked_add(decoded_length)
            .context("Decoded HAP chunk length overflowed.")?;
    }

    ensure!(
        decoded_offset == expected_decoded_length,
        "Decoded BC3 byte length mismatch. Expected {expected_decoded_length}, got {decoded_offset}."
    );
    Ok(chunks)
}

fn parse_hap_section(bytes: &[u8], offset: usize, limit: usize) -> Result<HapSection> {
    ensure!(
        limit <= bytes.len(),
        "HAP section limit exceeds frame bounds."
    );
    ensure!(offset + 4 <= limit, "HAP section header is truncated.");

    let b0 = bytes[offset];
    let b1 = bytes[offset + 1];
    let b2 = bytes[offset + 2];
    let section_type = bytes[offset + 3];
    let mut data_offset = offset + 4;
    let mut data_length = ((b0 as usize) | ((b1 as usize) << 8) | ((b2 as usize) << 16)) as usize;

    if b0 == 0 && b1 == 0 && b2 == 0 {
        ensure!(offset + 8 <= limit, "Long HAP section header is truncated.");
        data_length = u32::from_le_bytes([
            bytes[offset + 4],
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7],
        ]) as usize;
        data_offset = offset + 8;
    }

    let next_offset = data_offset
        .checked_add(data_length)
        .context("HAP section size overflowed.")?;
    ensure!(next_offset <= limit, "HAP section exceeds frame bounds.");

    Ok(HapSection {
        section_type,
        data_offset,
        data_length,
        next_offset,
    })
}

fn read_u32_table(bytes: &[u8]) -> Result<Vec<u32>> {
    ensure!(bytes.len() % 4 == 0, "HAP u32 table is not 4-byte aligned.");
    Ok(bytes
        .chunks_exact(4)
        .map(|chunk| u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect())
}

fn decoded_length_for_chunk(
    chunk: &[u8],
    compressor: ParsedCompressor,
    uncompressed_length: u64,
) -> Result<u64> {
    match compressor {
        ParsedCompressor::None => Ok(uncompressed_length),
        ParsedCompressor::Snappy => read_snappy_uncompressed_length(chunk),
    }
}

fn read_snappy_uncompressed_length(input: &[u8]) -> Result<u64> {
    let mut value = 0u64;
    let mut shift = 0;
    for byte in input.iter().take(5) {
        let byte = *byte;
        value |= ((byte & 0x7f) as u64) << shift;
        if byte & 0x80 == 0 {
            return Ok(value);
        }
        shift += 7;
    }
    bail!("Invalid Snappy varint length.")
}

fn expected_bc3_byte_length(width: u32, height: u32) -> u64 {
    let block_width = width.div_ceil(4) as u64;
    let block_height = height.div_ceil(4) as u64;
    block_width * block_height * 16
}

fn write_header<W: Write>(
    mut writer: W,
    metadata_length: u64,
    index_offset: u64,
    index_entry_count: u64,
) -> Result<()> {
    writer.write_all(HAPPACK_MAGIC)?;
    writer.write_u32::<LittleEndian>(HAPPACK_VERSION)?;
    writer.write_u32::<LittleEndian>(HAPPACK_HEADER_SIZE)?;
    writer.write_u64::<LittleEndian>(HAPPACK_HEADER_SIZE as u64)?;
    writer.write_u64::<LittleEndian>(metadata_length)?;
    writer.write_u64::<LittleEndian>(index_offset)?;
    writer.write_u64::<LittleEndian>(index_entry_count)?;
    writer.write_u32::<LittleEndian>(HAPPACK_INDEX_ENTRY_SIZE)?;
    writer.write_all(&[0u8; 12])?;
    Ok(())
}

use crate::config::AppConfig;
use crate::encode::ffmpeg::ProbeInfo;
use crate::happack::types::{
    HapMovie, HapPackMetadata, HAPPACK_HEADER_SIZE, HAPPACK_INDEX_ENTRY_SIZE, HAPPACK_MAGIC,
    HAPPACK_VERSION,
};
use anyhow::Result;
use byteorder::{LittleEndian, WriteBytesExt};
use std::fs::File;
use std::io::{copy, Read, Seek, SeekFrom, Write};
use std::path::Path;

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

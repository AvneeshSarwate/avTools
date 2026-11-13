use crate::happack::types::{HapFrameSample, HapMovie as ParsedHapMovie, FRAME_FLAG_KEYFRAME};
use anyhow::{anyhow, bail, Context, Result};
use byteorder::{BigEndian, ByteOrder};
use std::fs;
use std::path::Path;

pub type HapMovie = ParsedHapMovie;

#[derive(Debug, Clone)]
struct Atom {
    kind: [u8; 4],
    data_start: usize,
    end: usize,
    children: Vec<Atom>,
}

#[derive(Debug, Clone)]
struct SampleToChunkEntry {
    first_chunk: u32,
    samples_per_chunk: u32,
}

impl Atom {
    fn child(&self, kind: &[u8; 4]) -> Option<&Atom> {
        self.children.iter().find(|child| &child.kind == kind)
    }
}

impl ParsedHapMovie {
    pub fn read(path: &Path) -> Result<Self> {
        let bytes = fs::read(path).with_context(|| format!("Failed to read {}", path.display()))?;
        let root = parse_root(&bytes)?;
        let moov = root
            .child(b"moov")
            .ok_or_else(|| anyhow!("MOV has no moov atom"))?;
        let trak = moov
            .children
            .iter()
            .filter(|atom| &atom.kind == b"trak")
            .find(|trak| is_video_track(&bytes, trak).unwrap_or(false))
            .ok_or_else(|| anyhow!("MOV has no video track"))?;

        let mdia = trak
            .child(b"mdia")
            .ok_or_else(|| anyhow!("trak has no mdia"))?;
        let mdhd = mdia
            .child(b"mdhd")
            .ok_or_else(|| anyhow!("mdia has no mdhd"))?;
        let minf = mdia
            .child(b"minf")
            .ok_or_else(|| anyhow!("mdia has no minf"))?;
        let stbl = minf
            .child(b"stbl")
            .ok_or_else(|| anyhow!("minf has no stbl"))?;

        let timescale = parse_mdhd_timescale(&bytes, mdhd)?;
        let (fourcc, width, height) = parse_stsd(
            &bytes,
            stbl.child(b"stsd")
                .ok_or_else(|| anyhow!("stbl has no stsd"))?,
        )?;
        if fourcc != "HapY" {
            bail!("Expected HapY sample entry, found {fourcc}");
        }
        if width == 0 || height == 0 {
            bail!("Invalid MOV dimensions {width}x{height}");
        }

        let sample_sizes = parse_stsz(
            &bytes,
            stbl.child(b"stsz")
                .ok_or_else(|| anyhow!("stbl has no stsz"))?,
        )?;
        let sample_durations = parse_stts(
            &bytes,
            stbl.child(b"stts")
                .ok_or_else(|| anyhow!("stbl has no stts"))?,
        )?;
        if sample_sizes.is_empty() {
            bail!("MOV contains no video samples");
        }
        if sample_durations.len() < sample_sizes.len() {
            bail!(
                "stts duration count {} is smaller than sample count {}",
                sample_durations.len(),
                sample_sizes.len()
            );
        }

        let chunk_offsets = if let Some(stco) = stbl.child(b"stco") {
            parse_stco(&bytes, stco)?
        } else if let Some(co64) = stbl.child(b"co64") {
            parse_co64(&bytes, co64)?
        } else {
            bail!("stbl has neither stco nor co64")
        };
        let sample_to_chunks = parse_stsc(
            &bytes,
            stbl.child(b"stsc")
                .ok_or_else(|| anyhow!("stbl has no stsc"))?,
        )?;
        let sample_offsets =
            compute_sample_offsets(&sample_sizes, &chunk_offsets, &sample_to_chunks)?;

        let mut samples = Vec::with_capacity(sample_sizes.len());
        let mut timestamp = 0u64;
        for i in 0..sample_sizes.len() {
            let duration = sample_durations[i];
            let timestamp_us = timestamp.saturating_mul(1_000_000) / timescale as u64;
            let duration_us = duration.saturating_mul(1_000_000) / timescale as u64;
            let source_offset = sample_offsets[i];
            let byte_length = sample_sizes[i] as u64;
            if source_offset + byte_length > bytes.len() as u64 {
                bail!("Sample {i} points outside MOV file bounds");
            }
            samples.push(HapFrameSample {
                timestamp_us,
                duration_us: duration_us.try_into().unwrap_or(u32::MAX),
                flags: FRAME_FLAG_KEYFRAME,
                source_offset,
                byte_length,
            });
            timestamp = timestamp.saturating_add(duration);
        }

        Ok(Self {
            fourcc,
            width,
            height,
            timescale,
            samples,
        })
    }
}

fn parse_root(bytes: &[u8]) -> Result<Atom> {
    Ok(Atom {
        kind: *b"root",
        data_start: 0,
        end: bytes.len(),
        children: parse_children(bytes, 0, bytes.len())?,
    })
}

fn parse_children(bytes: &[u8], mut offset: usize, limit: usize) -> Result<Vec<Atom>> {
    let mut atoms = Vec::new();
    while offset + 8 <= limit {
        let (atom, next) = parse_atom(bytes, offset, limit)?;
        atoms.push(atom);
        offset = next;
    }
    if offset != limit {
        bail!("Trailing bytes in atom container");
    }
    Ok(atoms)
}

fn parse_atom(bytes: &[u8], offset: usize, limit: usize) -> Result<(Atom, usize)> {
    if offset + 8 > limit {
        bail!("Truncated atom header");
    }
    let size32 = BigEndian::read_u32(&bytes[offset..offset + 4]);
    let kind: [u8; 4] = bytes[offset + 4..offset + 8].try_into().unwrap();
    let mut header_size = 8usize;
    let end = if size32 == 1 {
        if offset + 16 > limit {
            bail!("Truncated extended atom header");
        }
        header_size = 16;
        let size64 = BigEndian::read_u64(&bytes[offset + 8..offset + 16]);
        offset + usize::try_from(size64).context("Atom is too large for this platform")?
    } else if size32 == 0 {
        limit
    } else {
        offset + size32 as usize
    };

    if end > limit || end < offset + header_size {
        bail!("Invalid atom size for {}", fourcc(&kind));
    }

    let data_start = offset + header_size;
    let children = if is_container(&kind) {
        parse_children(bytes, data_start, end)?
    } else {
        Vec::new()
    };

    Ok((
        Atom {
            kind,
            data_start,
            end,
            children,
        },
        end,
    ))
}

fn is_container(kind: &[u8; 4]) -> bool {
    matches!(kind, b"moov" | b"trak" | b"mdia" | b"minf" | b"stbl")
}

fn is_video_track(bytes: &[u8], trak: &Atom) -> Result<bool> {
    let Some(mdia) = trak.child(b"mdia") else {
        return Ok(false);
    };
    let Some(hdlr) = mdia.child(b"hdlr") else {
        return Ok(false);
    };
    let data = atom_data(bytes, hdlr)?;
    if data.len() < 12 {
        return Ok(false);
    }
    Ok(&data[8..12] == b"vide")
}

fn parse_mdhd_timescale(bytes: &[u8], atom: &Atom) -> Result<u32> {
    let data = atom_data(bytes, atom)?;
    if data.len() < 24 {
        bail!("mdhd is truncated");
    }
    let version = data[0];
    let offset = if version == 1 { 20 } else { 12 };
    if data.len() < offset + 4 {
        bail!("mdhd is truncated");
    }
    let timescale = BigEndian::read_u32(&data[offset..offset + 4]);
    if timescale == 0 {
        bail!("mdhd timescale is zero");
    }
    Ok(timescale)
}

fn parse_stsd(bytes: &[u8], atom: &Atom) -> Result<(String, u32, u32)> {
    let data = atom_data(bytes, atom)?;
    if data.len() < 16 {
        bail!("stsd is truncated");
    }
    let entry_count = BigEndian::read_u32(&data[4..8]);
    if entry_count == 0 {
        bail!("stsd has no sample descriptions");
    }
    let entry_offset = atom.data_start + 8;
    if entry_offset + 36 > atom.end {
        bail!("visual sample entry is truncated");
    }
    let entry_size = BigEndian::read_u32(&bytes[entry_offset..entry_offset + 4]) as usize;
    if entry_offset + entry_size > atom.end || entry_size < 36 {
        bail!("invalid visual sample entry size");
    }
    let kind: [u8; 4] = bytes[entry_offset + 4..entry_offset + 8]
        .try_into()
        .unwrap();
    let width = BigEndian::read_u16(&bytes[entry_offset + 32..entry_offset + 34]) as u32;
    let height = BigEndian::read_u16(&bytes[entry_offset + 34..entry_offset + 36]) as u32;
    Ok((fourcc(&kind), width, height))
}

fn parse_stts(bytes: &[u8], atom: &Atom) -> Result<Vec<u64>> {
    let data = atom_data(bytes, atom)?;
    if data.len() < 8 {
        bail!("stts is truncated");
    }
    let entry_count = BigEndian::read_u32(&data[4..8]) as usize;
    if data.len() < 8 + entry_count * 8 {
        bail!("stts entries are truncated");
    }
    let mut durations = Vec::new();
    let mut offset = 8;
    for _ in 0..entry_count {
        let sample_count = BigEndian::read_u32(&data[offset..offset + 4]) as usize;
        let sample_delta = BigEndian::read_u32(&data[offset + 4..offset + 8]) as u64;
        durations.extend(std::iter::repeat(sample_delta).take(sample_count));
        offset += 8;
    }
    Ok(durations)
}

fn parse_stsz(bytes: &[u8], atom: &Atom) -> Result<Vec<u32>> {
    let data = atom_data(bytes, atom)?;
    if data.len() < 12 {
        bail!("stsz is truncated");
    }
    let sample_size = BigEndian::read_u32(&data[4..8]);
    let sample_count = BigEndian::read_u32(&data[8..12]) as usize;
    if sample_size != 0 {
        return Ok(vec![sample_size; sample_count]);
    }
    if data.len() < 12 + sample_count * 4 {
        bail!("stsz sample sizes are truncated");
    }
    let mut sizes = Vec::with_capacity(sample_count);
    let mut offset = 12;
    for _ in 0..sample_count {
        sizes.push(BigEndian::read_u32(&data[offset..offset + 4]));
        offset += 4;
    }
    Ok(sizes)
}

fn parse_stco(bytes: &[u8], atom: &Atom) -> Result<Vec<u64>> {
    let data = atom_data(bytes, atom)?;
    if data.len() < 8 {
        bail!("stco is truncated");
    }
    let entry_count = BigEndian::read_u32(&data[4..8]) as usize;
    if data.len() < 8 + entry_count * 4 {
        bail!("stco entries are truncated");
    }
    let mut offsets = Vec::with_capacity(entry_count);
    let mut offset = 8;
    for _ in 0..entry_count {
        offsets.push(BigEndian::read_u32(&data[offset..offset + 4]) as u64);
        offset += 4;
    }
    Ok(offsets)
}

fn parse_co64(bytes: &[u8], atom: &Atom) -> Result<Vec<u64>> {
    let data = atom_data(bytes, atom)?;
    if data.len() < 8 {
        bail!("co64 is truncated");
    }
    let entry_count = BigEndian::read_u32(&data[4..8]) as usize;
    if data.len() < 8 + entry_count * 8 {
        bail!("co64 entries are truncated");
    }
    let mut offsets = Vec::with_capacity(entry_count);
    let mut offset = 8;
    for _ in 0..entry_count {
        offsets.push(BigEndian::read_u64(&data[offset..offset + 8]));
        offset += 8;
    }
    Ok(offsets)
}

fn parse_stsc(bytes: &[u8], atom: &Atom) -> Result<Vec<SampleToChunkEntry>> {
    let data = atom_data(bytes, atom)?;
    if data.len() < 8 {
        bail!("stsc is truncated");
    }
    let entry_count = BigEndian::read_u32(&data[4..8]) as usize;
    if data.len() < 8 + entry_count * 12 {
        bail!("stsc entries are truncated");
    }
    let mut entries = Vec::with_capacity(entry_count);
    let mut offset = 8;
    for _ in 0..entry_count {
        entries.push(SampleToChunkEntry {
            first_chunk: BigEndian::read_u32(&data[offset..offset + 4]),
            samples_per_chunk: BigEndian::read_u32(&data[offset + 4..offset + 8]),
        });
        offset += 12;
    }
    if entries.is_empty() {
        bail!("stsc has no entries");
    }
    Ok(entries)
}

fn compute_sample_offsets(
    sample_sizes: &[u32],
    chunk_offsets: &[u64],
    sample_to_chunks: &[SampleToChunkEntry],
) -> Result<Vec<u64>> {
    let mut sample_offsets = Vec::with_capacity(sample_sizes.len());
    let mut sample_index = 0usize;
    let mut stsc_index = 0usize;

    for (chunk_index, chunk_offset) in chunk_offsets.iter().copied().enumerate() {
        let chunk_number = chunk_index as u32 + 1;
        while stsc_index + 1 < sample_to_chunks.len()
            && sample_to_chunks[stsc_index + 1].first_chunk <= chunk_number
        {
            stsc_index += 1;
        }

        let samples_per_chunk = sample_to_chunks[stsc_index].samples_per_chunk as usize;
        let mut offset = chunk_offset;
        for _ in 0..samples_per_chunk {
            if sample_index >= sample_sizes.len() {
                break;
            }
            sample_offsets.push(offset);
            offset = offset.saturating_add(sample_sizes[sample_index] as u64);
            sample_index += 1;
        }
    }

    if sample_offsets.len() != sample_sizes.len() {
        bail!(
            "Computed {} sample offsets for {} samples",
            sample_offsets.len(),
            sample_sizes.len()
        );
    }
    Ok(sample_offsets)
}

fn atom_data<'a>(bytes: &'a [u8], atom: &Atom) -> Result<&'a [u8]> {
    bytes
        .get(atom.data_start..atom.end)
        .ok_or_else(|| anyhow!("Atom range is outside file bounds"))
}

fn fourcc(kind: &[u8; 4]) -> String {
    String::from_utf8_lossy(kind).to_string()
}

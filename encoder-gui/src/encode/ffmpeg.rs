use crate::config::AppConfig;
use crate::encode::progress::FfmpegProgress;
use crate::platform::bundled_ffmpeg::{find_ffmpeg, find_ffprobe};
use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct ProbeInfo {
    pub duration_seconds: f64,
    pub width: u32,
    pub height: u32,
    pub frame_rate_numerator: u32,
    pub frame_rate_denominator: u32,
}

#[derive(Debug, Deserialize)]
struct FfprobeOutput {
    streams: Vec<FfprobeStream>,
}

#[derive(Debug, Deserialize)]
struct FfprobeStream {
    duration: Option<String>,
    r_frame_rate: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
}

enum ProcessLine {
    Progress(String),
    Log(String),
}

pub fn probe_input(input: &Path) -> Result<ProbeInfo> {
    let ffprobe = find_ffprobe()?;
    let output = Command::new(&ffprobe)
        .arg("-v")
        .arg("error")
        .arg("-select_streams")
        .arg("v:0")
        .arg("-show_entries")
        .arg("stream=duration,nb_frames,r_frame_rate,width,height")
        .arg("-of")
        .arg("json")
        .arg(input)
        .output()
        .with_context(|| format!("Failed to run ffprobe at {}", ffprobe.display()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("ffprobe failed: {}", stderr.trim()));
    }

    let parsed: FfprobeOutput = serde_json::from_slice(&output.stdout)?;
    let stream = parsed
        .streams
        .first()
        .ok_or_else(|| anyhow!("ffprobe found no video stream"))?;
    let duration_seconds = stream
        .duration
        .as_deref()
        .unwrap_or("0")
        .parse::<f64>()
        .unwrap_or(0.0);
    let (frame_rate_numerator, frame_rate_denominator) =
        parse_rational(stream.r_frame_rate.as_deref().unwrap_or("0/1"));

    Ok(ProbeInfo {
        duration_seconds,
        width: stream.width.unwrap_or(0),
        height: stream.height.unwrap_or(0),
        frame_rate_numerator,
        frame_rate_denominator,
    })
}

pub fn encode_hap_q_mov(
    input: &Path,
    output_mov: &Path,
    duration_seconds: f64,
    config: &AppConfig,
    cancel: Arc<AtomicBool>,
    mut on_progress: impl FnMut(f32, String) + Send,
    mut on_log: impl FnMut(String) + Send,
) -> Result<()> {
    let ffmpeg = find_ffmpeg()?;
    let mut command = Command::new(&ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-y")
        .arg("-i")
        .arg(input)
        .arg("-an")
        .arg("-c:v")
        .arg("hap")
        .arg("-format")
        .arg(config.preset.ffmpeg_format())
        .arg("-chunks")
        .arg(config.chunks.to_string());

    if config.snappy {
        command.arg("-compressor").arg("snappy");
    } else {
        command.arg("-compressor").arg("none");
    }

    command
        .arg("-progress")
        .arg("pipe:1")
        .arg(output_mov)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    on_log(format!(
        "Running {}",
        format_command(&ffmpeg, input, output_mov, config)
    ));

    let mut child = command
        .spawn()
        .with_context(|| format!("Failed to run ffmpeg at {}", ffmpeg.display()))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("ffmpeg stdout pipe was unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("ffmpeg stderr pipe was unavailable"))?;

    let (tx, rx) = mpsc::channel::<ProcessLine>();
    let progress_tx = tx.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout)
            .lines()
            .map_while(std::result::Result::ok)
        {
            let _ = progress_tx.send(ProcessLine::Progress(line));
        }
    });

    let log_tx = tx.clone();
    thread::spawn(move || {
        for line in BufReader::new(stderr)
            .lines()
            .map_while(std::result::Result::ok)
        {
            let _ = log_tx.send(ProcessLine::Log(line));
        }
    });
    drop(tx);

    let mut progress = FfmpegProgress::default();
    loop {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(anyhow!("Encode cancelled"));
        }

        while let Ok(line) = rx.try_recv() {
            match line {
                ProcessLine::Progress(line) => {
                    progress.parse_line(&line);
                    let percent = if progress.ended {
                        100.0
                    } else {
                        progress.percent(duration_seconds)
                    };
                    on_progress(percent, progress_message(&progress));
                }
                ProcessLine::Log(line) => on_log(line),
            }
        }

        if let Some(status) = child.try_wait()? {
            while let Ok(line) = rx.try_recv() {
                match line {
                    ProcessLine::Progress(line) => {
                        progress.parse_line(&line);
                        on_progress(
                            progress.percent(duration_seconds),
                            progress_message(&progress),
                        );
                    }
                    ProcessLine::Log(line) => on_log(line),
                }
            }
            if status.success() {
                on_progress(100.0, "FFmpeg encode complete".to_string());
                return Ok(());
            }
            return Err(anyhow!("ffmpeg exited with status {status}"));
        }

        thread::sleep(Duration::from_millis(40));
    }
}

fn parse_rational(value: &str) -> (u32, u32) {
    let Some((n, d)) = value.split_once('/') else {
        return (0, 1);
    };
    let numerator = n.parse::<u32>().unwrap_or(0);
    let denominator = d.parse::<u32>().unwrap_or(1).max(1);
    (numerator, denominator)
}

fn progress_message(progress: &FfmpegProgress) -> String {
    let mut parts = Vec::new();
    if let Some(frame) = progress.frame {
        parts.push(format!("frame {frame}"));
    }
    if let Some(fps) = progress.fps {
        parts.push(format!("{fps:.1} fps"));
    }
    if progress.ended {
        parts.push("done".to_string());
    }
    if parts.is_empty() {
        "encoding".to_string()
    } else {
        parts.join(", ")
    }
}

fn format_command(ffmpeg: &Path, input: &Path, output_mov: &Path, config: &AppConfig) -> String {
    let compressor = if config.snappy { "snappy" } else { "none" };
    format!(
        "{} -y -i {} -an -c:v hap -format {} -chunks {} -compressor {} -progress pipe:1 {}",
        ffmpeg.display(),
        input.display(),
        config.preset.ffmpeg_format(),
        config.chunks,
        compressor,
        output_mov.display()
    )
}

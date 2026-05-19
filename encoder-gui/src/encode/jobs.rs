use crate::config::AppConfig;
use crate::encode::ffmpeg::{encode_hap_q_mov, probe_input};
use crate::happack::mov_reader::HapMovie;
use crate::happack::writer::write_happack;
use anyhow::{Context, Result};
use crossbeam_channel::Sender;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tempfile::tempdir;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JobStatus {
    Waiting,
    Probing,
    Encoding,
    Packaging,
    Done,
    Failed,
    Cancelled,
}

impl JobStatus {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Waiting => "waiting",
            Self::Probing => "probing",
            Self::Encoding => "encoding",
            Self::Packaging => "packaging",
            Self::Done => "done",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone)]
pub struct EncodeJob {
    pub id: usize,
    pub input_path: PathBuf,
    pub output_path: Option<PathBuf>,
    pub progress: f32,
    pub status: JobStatus,
    pub message: String,
    pub log: Vec<String>,
}

impl EncodeJob {
    pub fn new(id: usize, input_path: PathBuf) -> Self {
        Self {
            id,
            input_path,
            output_path: None,
            progress: 0.0,
            status: JobStatus::Waiting,
            message: "waiting".to_string(),
            log: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub enum JobEvent {
    Started {
        job_id: usize,
    },
    Status {
        job_id: usize,
        status: JobStatus,
        message: String,
    },
    Progress {
        job_id: usize,
        percent: f32,
        message: String,
    },
    LogLine {
        job_id: usize,
        line: String,
    },
    Finished {
        job_id: usize,
        output_path: PathBuf,
    },
    Failed {
        job_id: usize,
        error: String,
    },
    Cancelled {
        job_id: usize,
    },
    WorkerDone,
}

#[derive(Clone)]
pub struct JobRequest {
    pub id: usize,
    pub input_path: PathBuf,
}

pub fn run_jobs(
    jobs: Vec<JobRequest>,
    output_folder: PathBuf,
    config: AppConfig,
    cancel: Arc<AtomicBool>,
    sender: Sender<JobEvent>,
) {
    for job in jobs {
        if cancel.load(Ordering::Relaxed) {
            let _ = sender.send(JobEvent::Cancelled { job_id: job.id });
            break;
        }

        let result = run_one_job(&job, &output_folder, &config, cancel.clone(), &sender);
        if let Err(error) = result {
            let cancelled = cancel.load(Ordering::Relaxed);
            let _ = if cancelled {
                sender.send(JobEvent::Cancelled { job_id: job.id })
            } else {
                sender.send(JobEvent::Failed {
                    job_id: job.id,
                    error: format!("{error:#}"),
                })
            };
            if config.stop_on_error || cancelled {
                break;
            }
        }
    }

    let _ = sender.send(JobEvent::WorkerDone);
}

fn run_one_job(
    job: &JobRequest,
    output_folder: &Path,
    config: &AppConfig,
    cancel: Arc<AtomicBool>,
    sender: &Sender<JobEvent>,
) -> Result<()> {
    sender.send(JobEvent::Started { job_id: job.id }).ok();
    sender
        .send(JobEvent::Status {
            job_id: job.id,
            status: JobStatus::Probing,
            message: "probing input".to_string(),
        })
        .ok();

    let probe = probe_input(&job.input_path)?;
    sender
        .send(JobEvent::LogLine {
            job_id: job.id,
            line: format!(
                "Input: {}x{}, {:.3}s",
                probe.width, probe.height, probe.duration_seconds
            ),
        })
        .ok();

    let temp = tempdir()?;
    let temp_mov = temp.path().join("temp_hapq.mov");
    sender
        .send(JobEvent::Status {
            job_id: job.id,
            status: JobStatus::Encoding,
            message: "encoding Hap Q MOV".to_string(),
        })
        .ok();

    encode_hap_q_mov(
        &job.input_path,
        &temp_mov,
        probe.duration_seconds,
        config,
        cancel.clone(),
        |percent, message| {
            sender
                .send(JobEvent::Progress {
                    job_id: job.id,
                    percent,
                    message,
                })
                .ok();
        },
        |line| {
            sender
                .send(JobEvent::LogLine {
                    job_id: job.id,
                    line,
                })
                .ok();
        },
    )?;

    if cancel.load(Ordering::Relaxed) {
        return Err(anyhow::anyhow!("Encode cancelled"));
    }

    sender
        .send(JobEvent::Status {
            job_id: job.id,
            status: JobStatus::Packaging,
            message: if config.generate_happack {
                "extracting HAP samples".to_string()
            } else {
                "copying Hap Q MOV".to_string()
            },
        })
        .ok();

    let output_path = if config.generate_happack {
        let movie = HapMovie::read(&temp_mov).context("Failed to parse FFmpeg Hap Q MOV")?;
        let output_path = unique_output_path(output_folder, &job.input_path, "happack");
        write_happack(&movie, &temp_mov, &output_path, &probe, config)
            .with_context(|| format!("Failed to write {}", output_path.display()))?;
        output_path
    } else {
        let output_path = unique_output_path(output_folder, &job.input_path, "mov");
        std::fs::copy(&temp_mov, &output_path)
            .with_context(|| format!("Failed to write {}", output_path.display()))?;
        output_path
    };

    if config.keep_temp_mov {
        let debug_mov = output_path.with_extension("hapq.mov");
        std::fs::copy(&temp_mov, &debug_mov)
            .with_context(|| format!("Failed to preserve {}", debug_mov.display()))?;
    }

    sender
        .send(JobEvent::Finished {
            job_id: job.id,
            output_path,
        })
        .ok();
    Ok(())
}

fn unique_output_path(output_folder: &Path, input_path: &Path, extension: &str) -> PathBuf {
    let stem = input_path
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("output");
    let mut candidate = output_folder.join(stem).with_extension(extension);
    let mut suffix = 2;
    while candidate.exists() {
        candidate = output_folder
            .join(format!("{stem}_{suffix}"))
            .with_extension(extension);
        suffix += 1;
    }
    candidate
}

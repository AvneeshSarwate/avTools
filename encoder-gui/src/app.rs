use crate::config::{AppConfig, EncodePreset};
use crate::encode::jobs::{run_jobs, EncodeJob, JobEvent, JobRequest, JobStatus};
use crossbeam_channel::{unbounded, Receiver, Sender};
use eframe::egui;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

pub struct HapEncoderApp {
    jobs: Vec<EncodeJob>,
    selected_job: Option<usize>,
    output_folder: Option<PathBuf>,
    config: AppConfig,
    next_job_id: usize,
    event_tx: Sender<JobEvent>,
    event_rx: Receiver<JobEvent>,
    worker_running: bool,
    cancel_flag: Option<Arc<AtomicBool>>,
    show_log: bool,
    global_log: Vec<String>,
}

impl HapEncoderApp {
    pub fn new(_cc: &eframe::CreationContext<'_>) -> Self {
        let (event_tx, event_rx) = unbounded();
        Self {
            jobs: Vec::new(),
            selected_job: None,
            output_folder: std::env::current_dir().ok(),
            config: AppConfig::default(),
            next_job_id: 1,
            event_tx,
            event_rx,
            worker_running: false,
            cancel_flag: None,
            show_log: true,
            global_log: Vec::new(),
        }
    }

    fn add_files(&mut self) {
        let Some(files) = rfd::FileDialog::new()
            .add_filter("Video", &["mov", "mp4", "m4v", "avi", "mkv"])
            .pick_files()
        else {
            return;
        };

        for file in files {
            if self.jobs.iter().any(|job| job.input_path == file) {
                continue;
            }
            let id = self.next_job_id;
            self.next_job_id += 1;
            self.jobs.push(EncodeJob::new(id, file));
        }
    }

    fn remove_selected(&mut self) {
        if self.worker_running {
            return;
        }
        let Some(selected) = self.selected_job else {
            return;
        };
        self.jobs.retain(|job| job.id != selected);
        self.selected_job = None;
    }

    fn choose_output_folder(&mut self) {
        if let Some(folder) = rfd::FileDialog::new().pick_folder() {
            self.output_folder = Some(folder);
        }
    }

    fn can_encode(&self) -> bool {
        !self.worker_running
            && self.output_folder.is_some()
            && self.jobs.iter().any(|job| {
                matches!(
                    job.status,
                    JobStatus::Waiting | JobStatus::Failed | JobStatus::Cancelled
                )
            })
    }

    fn start_encode(&mut self) {
        if !self.can_encode() {
            return;
        }
        let output_folder = self.output_folder.clone().expect("checked by can_encode");
        let config = self.config.clone();
        let jobs: Vec<JobRequest> = self
            .jobs
            .iter_mut()
            .filter(|job| {
                matches!(
                    job.status,
                    JobStatus::Waiting | JobStatus::Failed | JobStatus::Cancelled
                )
            })
            .map(|job| {
                job.progress = 0.0;
                job.status = JobStatus::Waiting;
                job.message = "queued".to_string();
                job.output_path = None;
                JobRequest {
                    id: job.id,
                    input_path: job.input_path.clone(),
                }
            })
            .collect();

        let sender = self.event_tx.clone();
        let cancel = Arc::new(AtomicBool::new(false));
        self.cancel_flag = Some(cancel.clone());
        self.worker_running = true;
        thread::spawn(move || run_jobs(jobs, output_folder, config, cancel, sender));
    }

    fn cancel_current(&mut self) {
        if let Some(cancel) = &self.cancel_flag {
            cancel.store(true, Ordering::Relaxed);
        }
    }

    fn drain_events(&mut self, ctx: &egui::Context) {
        while let Ok(event) = self.event_rx.try_recv() {
            self.apply_event(event);
            ctx.request_repaint();
        }
    }

    fn apply_event(&mut self, event: JobEvent) {
        match event {
            JobEvent::Started { job_id } => {
                if let Some(job) = self.job_mut(job_id) {
                    job.status = JobStatus::Encoding;
                    job.message = "started".to_string();
                }
            }
            JobEvent::Status {
                job_id,
                status,
                message,
            } => {
                if let Some(job) = self.job_mut(job_id) {
                    job.status = status;
                    job.message = message;
                }
            }
            JobEvent::Progress {
                job_id,
                percent,
                message,
            } => {
                if let Some(job) = self.job_mut(job_id) {
                    job.status = JobStatus::Encoding;
                    job.progress = percent;
                    job.message = message;
                }
            }
            JobEvent::LogLine { job_id, line } => {
                if let Some(job) = self.job_mut(job_id) {
                    job.log.push(line.clone());
                    if job.log.len() > 400 {
                        job.log.drain(0..100);
                    }
                }
                self.global_log.push(format!("#{job_id}: {line}"));
                if self.global_log.len() > 800 {
                    self.global_log.drain(0..200);
                }
            }
            JobEvent::Finished {
                job_id,
                output_path,
            } => {
                if let Some(job) = self.job_mut(job_id) {
                    job.status = JobStatus::Done;
                    job.progress = 100.0;
                    job.message = "done".to_string();
                    job.output_path = Some(output_path);
                }
            }
            JobEvent::Failed { job_id, error } => {
                if let Some(job) = self.job_mut(job_id) {
                    job.status = JobStatus::Failed;
                    job.message = error.clone();
                    job.log.push(error.clone());
                }
                self.global_log.push(format!("#{job_id} failed: {error}"));
            }
            JobEvent::Cancelled { job_id } => {
                if let Some(job) = self.job_mut(job_id) {
                    job.status = JobStatus::Cancelled;
                    job.message = "cancelled".to_string();
                }
            }
            JobEvent::WorkerDone => {
                self.worker_running = false;
                self.cancel_flag = None;
            }
        }
    }

    fn job_mut(&mut self, job_id: usize) -> Option<&mut EncodeJob> {
        self.jobs.iter_mut().find(|job| job.id == job_id)
    }

    fn selected_log(&self) -> &[String] {
        self.selected_job
            .and_then(|id| self.jobs.iter().find(|job| job.id == id))
            .map(|job| job.log.as_slice())
            .unwrap_or(self.global_log.as_slice())
    }
}

impl eframe::App for HapEncoderApp {
    fn logic(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.drain_events(ctx);
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        egui::Panel::top("toolbar").show_inside(ui, |ui| {
            ui.horizontal(|ui| {
                if ui.button("Add Videos").clicked() {
                    self.add_files();
                }
                if ui
                    .add_enabled(
                        self.selected_job.is_some() && !self.worker_running,
                        egui::Button::new("Remove Selected"),
                    )
                    .clicked()
                {
                    self.remove_selected();
                }
                ui.separator();
                if ui
                    .add_enabled(self.can_encode(), egui::Button::new("Encode"))
                    .clicked()
                {
                    self.start_encode();
                }
                if ui
                    .add_enabled(self.worker_running, egui::Button::new("Cancel Current"))
                    .clicked()
                {
                    self.cancel_current();
                }
                ui.separator();
                ui.checkbox(&mut self.show_log, "Show FFmpeg Log");
            });
        });

        egui::Panel::left("settings")
            .min_size(280.0)
            .show_inside(ui, |ui| {
                ui.heading("Output");
                ui.horizontal(|ui| {
                    let label = self
                        .output_folder
                        .as_ref()
                        .map(|path| path.display().to_string())
                        .unwrap_or_else(|| "Choose an output folder".to_string());
                    ui.label(egui::RichText::new(label).small());
                });
                if ui.button("Choose Folder").clicked() {
                    self.choose_output_folder();
                }

                ui.separator();
                ui.heading("Preset");
                ui.radio_value(
                    &mut self.config.preset,
                    EncodePreset::WebGpuHapQ,
                    EncodePreset::WebGpuHapQ.label(),
                );
                ui.label(format!("FourCC: {}", self.config.preset.fourcc()));
                ui.label("GPU texture: bc3-rgba-unorm");

                ui.separator();
                ui.heading("Advanced");
                ui.add(
                    egui::DragValue::new(&mut self.config.chunks)
                        .range(1..=64)
                        .prefix("Chunks: "),
                );
                ui.checkbox(&mut self.config.snappy, "Snappy compression");
                ui.checkbox(&mut self.config.generate_happack, "Generate .happack");
                ui.checkbox(&mut self.config.keep_temp_mov, "Keep temp Hap Q MOV");
                ui.checkbox(&mut self.config.stop_on_error, "Stop batch on error");

                if !self.config.generate_happack {
                    ui.colored_label(
                        egui::Color32::YELLOW,
                        "MOV-only output is mainly for debugging.",
                    );
                }
            });

        egui::CentralPanel::default().show_inside(ui, |ui| {
            ui.heading("Queue");
            ui.add_space(4.0);

            egui::Grid::new("queue_grid")
                .num_columns(5)
                .striped(true)
                .min_col_width(90.0)
                .show(ui, |ui| {
                    ui.strong("Input");
                    ui.strong("Status");
                    ui.strong("Progress");
                    ui.strong("Message");
                    ui.strong("Output");
                    ui.end_row();

                    for job in &self.jobs {
                        let selected = self.selected_job == Some(job.id);
                        let name = job
                            .input_path
                            .file_name()
                            .and_then(|name| name.to_str())
                            .unwrap_or("(unnamed)");
                        if ui.selectable_label(selected, name).clicked() {
                            self.selected_job = Some(job.id);
                        }
                        ui.label(job.status.label());
                        ui.add(
                            egui::ProgressBar::new(job.progress / 100.0)
                                .desired_width(120.0)
                                .text(format!("{:.0}%", job.progress)),
                        );
                        ui.label(&job.message);
                        ui.label(
                            job.output_path
                                .as_ref()
                                .map(|path| path.display().to_string())
                                .unwrap_or_else(|| "-".to_string()),
                        );
                        ui.end_row();
                    }
                });

            if self.jobs.is_empty() {
                ui.centered_and_justified(|ui| {
                    ui.label("No videos queued.");
                });
            }
        });

        if self.show_log {
            egui::Panel::bottom("log_panel")
                .resizable(true)
                .default_size(180.0)
                .show_inside(ui, |ui| {
                    ui.horizontal(|ui| {
                        ui.heading("Log");
                        if let Some(selected) = self.selected_job {
                            ui.label(format!("job #{selected}"));
                        } else {
                            ui.label("global");
                        }
                    });
                    egui::ScrollArea::vertical()
                        .stick_to_bottom(true)
                        .show(ui, |ui| {
                            for line in self.selected_log() {
                                ui.monospace(line);
                            }
                        });
                });
        }
    }
}

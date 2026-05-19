#[derive(Default, Debug, Clone)]
pub struct FfmpegProgress {
    pub frame: Option<u64>,
    pub fps: Option<f32>,
    pub out_time_ms: Option<u64>,
    pub ended: bool,
}

impl FfmpegProgress {
    pub fn parse_line(&mut self, line: &str) {
        let Some((key, value)) = line.split_once('=') else {
            return;
        };

        match key {
            "frame" => self.frame = value.trim().parse().ok(),
            "fps" => self.fps = value.trim().parse().ok(),
            "out_time_ms" => self.out_time_ms = value.trim().parse().ok(),
            "progress" => self.ended = value.trim() == "end",
            _ => {}
        }
    }

    pub fn percent(&self, duration_seconds: f64) -> f32 {
        if duration_seconds <= 0.0 {
            return 0.0;
        }
        let Some(out_time_ms) = self.out_time_ms else {
            return 0.0;
        };
        let duration_us = duration_seconds * 1_000_000.0;
        ((out_time_ms as f64 / duration_us) * 100.0).clamp(0.0, 100.0) as f32
    }
}

#[cfg(test)]
mod tests {
    use super::FfmpegProgress;

    #[test]
    fn parses_progress_lines() {
        let mut progress = FfmpegProgress::default();
        progress.parse_line("frame=123");
        progress.parse_line("fps=45.2");
        progress.parse_line("out_time_ms=4100000");
        progress.parse_line("progress=continue");

        assert_eq!(progress.frame, Some(123));
        assert_eq!(progress.out_time_ms, Some(4_100_000));
        assert!((progress.percent(10.0) - 41.0).abs() < f32::EPSILON);
        assert!(!progress.ended);
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EncodePreset {
    WebGpuHapQ,
}

impl EncodePreset {
    pub fn label(self) -> &'static str {
        match self {
            Self::WebGpuHapQ => "WebGPU Hap Q, recommended",
        }
    }

    pub fn ffmpeg_format(self) -> &'static str {
        match self {
            Self::WebGpuHapQ => "hap_q",
        }
    }

    pub fn fourcc(self) -> &'static str {
        match self {
            Self::WebGpuHapQ => "HapY",
        }
    }
}

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub chunks: u32,
    pub snappy: bool,
    pub generate_happack: bool,
    pub keep_temp_mov: bool,
    pub stop_on_error: bool,
    pub preset: EncodePreset,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            chunks: 4,
            snappy: true,
            generate_happack: true,
            keep_temp_mov: false,
            stop_on_error: false,
            preset: EncodePreset::WebGpuHapQ,
        }
    }
}

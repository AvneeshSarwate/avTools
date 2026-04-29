use std::{env, fs, path::PathBuf, process::ExitCode};

use ntsc_rs::{
    NtscEffect,
    settings::{
        ChromaDemodulationFilter, ChromaLowpass, FilterType, LumaLowpass, RingingSettings,
        UseField, VHSSettings, VHSTapeSpeed,
    },
    yiq_fielding::Rgbx,
};

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("{err}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let input_path = args
        .next()
        .map(PathBuf::from)
        .ok_or_else(|| usage("missing input path"))?;
    let output_path = args
        .next()
        .map(PathBuf::from)
        .ok_or_else(|| usage("missing output path"))?;
    let width = parse_arg::<usize>(args.next(), "width")?;
    let height = parse_arg::<usize>(args.next(), "height")?;
    let frame = parse_arg::<usize>(args.next().or_else(|| Some("0".to_string())), "frame")?;
    let profile = args.next().unwrap_or_else(|| "stable".to_string());

    let expected_len = width
        .checked_mul(height)
        .and_then(|px| px.checked_mul(4))
        .ok_or_else(|| "image dimensions overflow".to_string())?;

    let mut pixels = fs::read(&input_path)
        .map_err(|err| format!("failed to read {}: {err}", input_path.display()))?;
    if pixels.len() != expected_len {
        return Err(format!(
            "input length mismatch: got {} bytes, expected {expected_len}",
            pixels.len()
        ));
    }

    let effect = make_effect(&profile)?;
    effect.apply_effect_to_buffer::<Rgbx, u8>((width, height), &mut pixels, frame, [1.0, 1.0]);

    fs::write(&output_path, &pixels)
        .map_err(|err| format!("failed to write {}: {err}", output_path.display()))?;
    Ok(())
}

fn parse_arg<T>(value: Option<String>, name: &str) -> Result<T, String>
where
    T: std::str::FromStr,
    T::Err: std::fmt::Display,
{
    value
        .ok_or_else(|| usage(&format!("missing {name}")))?
        .parse::<T>()
        .map_err(|err| format!("invalid {name}: {err}"))
}

fn usage(message: &str) -> String {
    format!(
        "{message}\nusage: ntsc-ref-runner <input.rgba> <output.rgba> <width> <height> [frame] [stable|vhs]"
    )
}

fn make_effect(profile: &str) -> Result<NtscEffect, String> {
    let mut effect = NtscEffect::default();
    effect.random_seed = 7;
    effect.use_field = UseField::Both;
    effect.filter_type = FilterType::Butterworth;
    effect.input_luma_filter = LumaLowpass::Box;
    effect.chroma_lowpass_in = ChromaLowpass::Full;
    effect.chroma_demodulation = ChromaDemodulationFilter::Box;
    effect.chroma_lowpass_out = ChromaLowpass::Full;
    effect.composite_sharpening = 0.65;
    effect.luma_smear = 0.25;
    effect.ringing = Some(RingingSettings {
        frequency: 0.42,
        power: 3.0,
        intensity: 1.0,
    });
    effect.chroma_delay_horizontal = 2.0;
    effect.chroma_delay_vertical = 0;
    effect.chroma_vert_blend = true;

    // Noise-like passes are disabled in the stable profile so the GPU approximation
    // can be compared against the signal path rather than against unrelated RNG.
    effect.head_switching = None;
    effect.tracking_noise = None;
    effect.composite_noise = None;
    effect.luma_noise = None;
    effect.chroma_noise = None;
    effect.snow_intensity = 0.0;
    effect.chroma_phase_noise_intensity = 0.0;
    effect.chroma_phase_error = 0.0;

    let mut vhs = VHSSettings::default();
    vhs.tape_speed = VHSTapeSpeed::LP;
    vhs.chroma_loss = 0.0;
    vhs.edge_wave = None;
    if let Some(sharpen) = &mut vhs.sharpen {
        sharpen.intensity = 0.16;
        sharpen.frequency = 1.0;
    }
    effect.vhs_settings = Some(vhs);

    match profile {
        "stable" => Ok(effect),
        "vhs" => {
            let mut effect = effect;
            effect.snow_intensity = 0.00015;
            if let Some(vhs) = &mut effect.vhs_settings {
                vhs.chroma_loss = 0.000025;
                vhs.edge_wave = Some(Default::default());
            }
            Ok(effect)
        }
        other => Err(format!("unknown profile: {other}")),
    }
}

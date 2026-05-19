mod app;
mod config;
mod encode;
mod happack;
mod platform;

use app::HapEncoderApp;

fn main() -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([980.0, 680.0])
            .with_min_inner_size([760.0, 520.0]),
        ..Default::default()
    };

    eframe::run_native(
        "AVTools HAP Encoder",
        options,
        Box::new(|cc| Ok(Box::new(HapEncoderApp::new(cc)))),
    )
}

// One Rust static library avoids duplicate standard-library/panic symbols when
// linking several independent Rust staticlibs into the embedded C++ runtime.
pub use midi_bridge::*;
pub use text_engine::*;

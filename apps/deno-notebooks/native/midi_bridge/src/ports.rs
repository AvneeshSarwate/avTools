use midir::{MidiInput, MidiOutput};
use serde::Serialize;

#[derive(Serialize)]
struct PortInfo {
    id: String,
    name: String,
}

pub fn list_inputs_json() -> Vec<u8> {
    let midi_in = match MidiInput::new("midi-bridge-list") {
        Ok(m) => m,
        Err(_) => return b"[]".to_vec(),
    };
    let ports = midi_in.ports();
    let mut infos = Vec::with_capacity(ports.len());
    for port in ports {
        let name = midi_in
            .port_name(&port)
            .unwrap_or_else(|_| "<unknown>".to_string());
        let id = port.id();
        infos.push(PortInfo { id, name });
    }
    serde_json::to_vec(&infos).unwrap_or_else(|_| b"[]".to_vec())
}

pub fn list_outputs_json() -> Vec<u8> {
    let midi_out = match MidiOutput::new("midi-bridge-list") {
        Ok(m) => m,
        Err(_) => return b"[]".to_vec(),
    };
    let ports = midi_out.ports();
    let mut infos = Vec::with_capacity(ports.len());
    for port in ports {
        let name = midi_out
            .port_name(&port)
            .unwrap_or_else(|_| "<unknown>".to_string());
        let id = port.id();
        infos.push(PortInfo { id, name });
    }
    serde_json::to_vec(&infos).unwrap_or_else(|_| b"[]".to_vec())
}

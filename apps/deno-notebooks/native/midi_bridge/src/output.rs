use midir::{MidiOutput, MidiOutputConnection};

pub struct OutputHandle {
    conn: MidiOutputConnection,
}

impl OutputHandle {
    pub fn open(port_id: &str) -> Result<Self, String> {
        let midi_out = MidiOutput::new("midi-bridge-out")
            .map_err(|e| format!("midi output init failed: {e:?}"))?;
        let port = midi_out
            .find_port_by_id(port_id.to_string())
            .ok_or_else(|| "output port not found".to_string())?;
        let conn = midi_out
            .connect(&port, "midi-bridge-out")
            .map_err(|e| format!("output connect failed: {e:?}"))?;
        Ok(Self { conn })
    }

    pub fn send(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.conn
            .send(bytes)
            .map_err(|e| format!("send failed: {e:?}"))
    }
}

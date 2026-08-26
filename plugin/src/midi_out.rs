use midir::{MidiOutput, MidiOutputConnection};
use std::sync::Mutex;

pub struct SkyMidi {
    conn: Mutex<Option<MidiOutputConnection>>,
}

impl SkyMidi {
    pub fn new() -> Self {
        Self {
            conn: Mutex::new(None),
        }
    }

    pub fn ensure(&self) {
        let Ok(mut slot) = self.conn.lock() else {
            return;
        };
        if slot.is_some() {
            return;
        }
        *slot = open_port();
    }

    pub fn send(&self, note: u8, on: bool, vel: f32) {
        self.ensure();
        let Ok(mut slot) = self.conn.lock() else {
            return;
        };
        let Some(conn) = slot.as_mut() else {
            return;
        };
        let n = note & 0x7f;
        let v = ((vel * 127.0).round() as i32).clamp(1, 127) as u8;
        let bytes = if on {
            [0x90, n, v]
        } else {
            [0x80, n, 0x40]
        };
        let _ = conn.send(&bytes);
    }
}

fn open_port() -> Option<MidiOutputConnection> {
    #[cfg(unix)]
    {
        if let Ok(midi) = MidiOutput::new("SkyForge") {
            use midir::os::unix::VirtualOutput;
            if let Ok(conn) = midi.create_virtual("SkyForge") {
                return Some(conn);
            }
        }
    }
    let midi = MidiOutput::new("SkyForge").ok()?;
    let ports = midi.ports();
    let pick = ports.iter().find(|p| {
        let name = midi.port_name(p).unwrap_or_default().to_lowercase();
        let skip = name.contains("wavetable")
            || name.contains("mapper")
            || name.contains("gs synth")
            || name.contains("microsoft gs");
        let want = name.contains("loopmidi")
            || name.contains("loopbe")
            || name.contains("skyforge")
            || name.contains("loopback")
            || name.contains("iac")
            || name.contains("midi loop");
        !skip && want
    });
    let port = pick?;
    midi.connect(port, "SkyForge").ok()
}

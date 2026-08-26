use midir::{MidiOutput, MidiOutputConnection};
use std::sync::Mutex;

enum Port {
    Midir(MidiOutputConnection),
    #[cfg(target_os = "windows")]
    Te(windows_te::TePort),
}

pub struct SkyMidi {
    conn: Mutex<Option<Port>>,
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
        let Some(port) = slot.as_mut() else {
            return;
        };
        let n = note & 0x7f;
        let v = ((vel * 127.0).round() as i32).clamp(1, 127) as u8;
        let bytes = if on {
            [0x90, n, v]
        } else {
            [0x80, n, 0x40]
        };
        match port {
            Port::Midir(conn) => {
                let _ = conn.send(&bytes);
            }
            #[cfg(target_os = "windows")]
            Port::Te(te) => te.send(&bytes),
        }
    }
}

fn open_port() -> Option<Port> {
    #[cfg(target_os = "windows")]
    {
        if let Some(te) = windows_te::open("SkyForge") {
            return Some(Port::Te(te));
        }
    }
    #[cfg(unix)]
    {
        if let Ok(midi) = MidiOutput::new("SkyForge") {
            use midir::os::unix::VirtualOutput;
            if let Ok(conn) = midi.create_virtual("SkyForge") {
                return Some(Port::Midir(conn));
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
            || name.contains("midi loop")
            || name.contains("virtual midi")
            || name.contains("app-to-app");
        !skip && want
    });
    let port = pick?;
    midi.connect(port, "SkyForge").ok().map(Port::Midir)
}

#[cfg(target_os = "windows")]
mod windows_te {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    type Handle = *mut c_void;
    type CreatePort = unsafe extern "system" fn(
        *const u16,
        *const c_void,
        usize,
        u32,
        u32,
    ) -> Handle;
    type SendData = unsafe extern "system" fn(Handle, *const u8, u32) -> i32;

    pub struct TePort {
        handle: Handle,
        send: SendData,
    }

    unsafe impl Send for TePort {}

    impl TePort {
        pub fn send(&self, bytes: &[u8]) {
            unsafe {
                let _ = (self.send)(self.handle, bytes.as_ptr(), bytes.len() as u32);
            }
        }
    }

    pub fn open(name: &str) -> Option<TePort> {
        let dll = load_dll()?;
        let create: CreatePort = unsafe { proc(dll, b"virtualMIDICreatePortEx2\0")? };
        let send: SendData = unsafe { proc(dll, b"virtualMIDISendData\0")? };
        let wide: Vec<u16> = std::ffi::OsStr::new(name)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let handle = unsafe { create(wide.as_ptr(), std::ptr::null(), 0, 65_535, 1) };
        if handle.is_null() {
            return None;
        }
        Some(TePort { handle, send })
    }

    fn load_dll() -> Option<Handle> {
        const CANDIDATES: &[&str] = &[
            "teVirtualMIDI64.dll",
            r"C:\Windows\System32\teVirtualMIDI64.dll",
            r"C:\Program Files\Tobias Erichsen\loopMIDI\teVirtualMIDI64.dll",
            r"C:\Program Files (x86)\Tobias Erichsen\teVirtualMIDI\teVirtualMIDI64.dll",
            r"C:\Program Files\Tobias Erichsen\teVirtualMIDI\teVirtualMIDI64.dll",
        ];
        for path in CANDIDATES {
            if let Some(h) = load_library(path) {
                return Some(h);
            }
        }
        None
    }

    fn load_library(path: &str) -> Option<Handle> {
        if path.contains('\\') && !Path::new(path).exists() {
            return None;
        }
        let wide: Vec<u16> = std::ffi::OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let h = unsafe { LoadLibraryW(wide.as_ptr()) };
        if h.is_null() {
            None
        } else {
            Some(h)
        }
    }

    unsafe fn proc<T>(dll: Handle, name: &[u8]) -> Option<T> {
        let p = GetProcAddress(dll, name.as_ptr() as *const i8);
        if p.is_null() {
            return None;
        }
        Some(std::mem::transmute_copy(&p))
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn LoadLibraryW(name: *const u16) -> Handle;
        fn GetProcAddress(module: Handle, name: *const i8) -> *mut c_void;
    }
}

use std::path::{Path, PathBuf};

pub fn downloads_dir() -> PathBuf {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"));
    if let Some(home) = home {
        let p = PathBuf::from(home).join("Downloads");
        if p.is_dir() {
            return p;
        }
    }
    std::env::temp_dir()
}

fn safe_name(name: &str) -> String {
    let t: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .take(80)
        .collect();
    if t.is_empty() {
        "skyforge.bin".to_string()
    } else {
        t
    }
}

pub fn stamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

pub fn write_download(name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let path = downloads_dir().join(safe_name(name));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

pub fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("skyforge.bin")
        .to_string()
}

pub fn write_wav(name: &str, pcm: &[i16], sr: u32) -> Result<PathBuf, String> {
    let sr = sr.max(8_000);
    let data_bytes = (pcm.len() * 2) as u32;
    let mut buf = Vec::with_capacity(44 + pcm.len() * 2);
    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&(36 + data_bytes).to_le_bytes());
    buf.extend_from_slice(b"WAVE");
    buf.extend_from_slice(b"fmt ");
    buf.extend_from_slice(&16u32.to_le_bytes());
    buf.extend_from_slice(&1u16.to_le_bytes());
    buf.extend_from_slice(&1u16.to_le_bytes());
    buf.extend_from_slice(&sr.to_le_bytes());
    buf.extend_from_slice(&(sr * 2).to_le_bytes());
    buf.extend_from_slice(&2u16.to_le_bytes());
    buf.extend_from_slice(&16u16.to_le_bytes());
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&data_bytes.to_le_bytes());
    for s in pcm {
        buf.extend_from_slice(&s.to_le_bytes());
    }
    write_download(name, &buf)
}

fn var_len(mut value: u32) -> Vec<u8> {
    let mut bytes = vec![(value & 0x7f) as u8];
    value >>= 7;
    while value > 0 {
        bytes.insert(0, ((value & 0x7f) as u8) | 0x80);
        value >>= 7;
    }
    bytes
}

pub fn write_midi(name: &str, events: &[(f32, u8, bool, f32)]) -> Result<PathBuf, String> {
    if events.is_empty() {
        return Err("empty".into());
    }
    let bpm = 120.0f32;
    let ticks_per_q = 480u16;
    let us_per_q = (60_000_000.0 / bpm).round() as u32;
    let mut track = Vec::new();
    track.push(0x00);
    track.push(0xff);
    track.push(0x51);
    track.push(0x03);
    track.push(((us_per_q >> 16) & 0xff) as u8);
    track.push(((us_per_q >> 8) & 0xff) as u8);
    track.push((us_per_q & 0xff) as u8);

    let mut ordered: Vec<(f32, u8, bool, f32)> = events.to_vec();
    ordered.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal).then_with(|| {
        if a.2 == b.2 {
            std::cmp::Ordering::Equal
        } else if a.2 {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    }));
    let t0 = ordered[0].0;
    let mut last_tick = 0i32;
    for (t, note, on, vel) in ordered {
        let seconds = (t - t0).max(0.0);
        let tick = (seconds * (bpm / 60.0) * ticks_per_q as f32).round() as i32;
        let delta = (tick - last_tick).max(0) as u32;
        last_tick = tick;
        track.extend_from_slice(&var_len(delta));
        let v = ((vel * 127.0).round() as i32).clamp(1, 127) as u8;
        if on {
            track.push(0x90);
            track.push(note & 0x7f);
            track.push(v);
        } else {
            track.push(0x80);
            track.push(note & 0x7f);
            track.push(0x40);
        }
    }
    track.extend_from_slice(&var_len(ticks_per_q as u32));
    track.extend_from_slice(&[0xff, 0x2f, 0x00]);

    let mut out = vec![
        0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01,
        (ticks_per_q >> 8) as u8,
        ticks_per_q as u8,
        0x4d, 0x54, 0x72, 0x6b,
    ];
    let len = track.len() as u32;
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(&track);
    write_download(name, &out)
}

pub fn decode_b64(s: &str) -> Vec<u8> {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut table = [255u8; 256];
    for (i, c) in T.iter().enumerate() {
        table[*c as usize] = i as u8;
    }
    let clean: Vec<u8> = s.bytes().filter(|b| *b != b'=' && *b != b'\n' && *b != b'\r').collect();
    let mut out = Vec::with_capacity(clean.len() / 4 * 3 + 3);
    let mut i = 0;
    while i + 4 <= clean.len() {
        let a = table[clean[i] as usize] as u32;
        let b = table[clean[i + 1] as usize] as u32;
        let c = table[clean[i + 2] as usize] as u32;
        let d = table[clean[i + 3] as usize] as u32;
        let n = (a << 18) | (b << 12) | (c << 6) | d;
        out.push((n >> 16) as u8);
        out.push((n >> 8) as u8);
        out.push(n as u8);
        i += 4;
    }
    if i + 2 == clean.len() {
        let a = table[clean[i] as usize] as u32;
        let b = table[clean[i + 1] as usize] as u32;
        let n = (a << 18) | (b << 12);
        out.push((n >> 16) as u8);
    } else if i + 3 == clean.len() {
        let a = table[clean[i] as usize] as u32;
        let b = table[clean[i + 1] as usize] as u32;
        let c = table[clean[i + 2] as usize] as u32;
        let n = (a << 18) | (b << 12) | (c << 6);
        out.push((n >> 16) as u8);
        out.push((n >> 8) as u8);
    }
    out
}

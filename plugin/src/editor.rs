use crate::{FaceState, FilterKind, SkyForgeParams, WaveKind};
use nih_plug::prelude::*;
use nih_plug_webview::{HTMLSource, Key, WebViewEditor};
use serde::Deserialize;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub const FACE_W: u32 = 1100;
pub const FACE_H: u32 = 760;
const CLIP_CHUNK: usize = 24_576;

#[derive(Deserialize)]
#[serde(tag = "type")]
enum Action {
    Init,
    Patch { params: JsParams },
    Face {
        skin: Option<String>,
        trim: Option<String>,
        handle: Option<String>,
        kind: Option<String>,
        preset: Option<String>,
    },
    NoteOn { note: u8, vel: Option<f32> },
    NoteOff { note: u8 },
    ClipStart { mode: Option<String> },
    ClipStop,
    MidiDump,
    SaveStart { name: String },
    SaveChunk { data: String },
    SaveEnd,
    SaveWav { stem: Option<String> },
    WyrmKeep {
        id: Option<String>,
        epithet: Option<String>,
        element: Option<String>,
        at: Option<u64>,
        name: Option<String>,
        thumb: Option<String>,
        stem: Option<String>,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JsParams {
    waveform: Option<String>,
    pulse_width: Option<f32>,
    filter_type: Option<String>,
    cutoff: Option<f32>,
    resonance: Option<f32>,
    attack: Option<f32>,
    decay: Option<f32>,
    sustain: Option<f32>,
    release: Option<f32>,
    octave: Option<i32>,
    volume: Option<f32>,
    halloween: Option<f32>,
    waters: Option<f32>,
    aether: Option<f32>,
    unison: Option<i32>,
}

fn wave_from(s: &str) -> WaveKind {
    match s {
        "sine" => WaveKind::Sine,
        "triangle" => WaveKind::Triangle,
        "sawtooth" => WaveKind::Saw,
        "square" => WaveKind::Square,
        "pulse" => WaveKind::Pulse,
        "noise" => WaveKind::Noise,
        _ => WaveKind::Saw,
    }
}

fn wave_to(w: WaveKind) -> &'static str {
    match w {
        WaveKind::Sine => "sine",
        WaveKind::Triangle => "triangle",
        WaveKind::Saw => "sawtooth",
        WaveKind::Square => "square",
        WaveKind::Pulse => "pulse",
        WaveKind::Noise => "noise",
    }
}

fn filter_from(s: &str) -> FilterKind {
    match s {
        "highpass" => FilterKind::Highpass,
        "bandpass" => FilterKind::Bandpass,
        _ => FilterKind::Lowpass,
    }
}

fn filter_to(f: FilterKind) -> &'static str {
    match f {
        FilterKind::Lowpass => "lowpass",
        FilterKind::Highpass => "highpass",
        FilterKind::Bandpass => "bandpass",
    }
}

fn set_f(setter: &ParamSetter, p: &FloatParam, v: f32) {
    setter.begin_set_parameter(p);
    setter.set_parameter(p, v);
    setter.end_set_parameter(p);
}

fn set_i(setter: &ParamSetter, p: &IntParam, v: i32) {
    setter.begin_set_parameter(p);
    setter.set_parameter(p, v);
    setter.end_set_parameter(p);
}

fn apply_patch(setter: &ParamSetter, params: &SkyForgeParams, patch: JsParams) {
    if let Some(w) = patch.waveform.as_deref() {
        setter.begin_set_parameter(&params.wave);
        setter.set_parameter(&params.wave, wave_from(w));
        setter.end_set_parameter(&params.wave);
    }
    if let Some(f) = patch.filter_type.as_deref() {
        setter.begin_set_parameter(&params.filter);
        setter.set_parameter(&params.filter, filter_from(f));
        setter.end_set_parameter(&params.filter);
    }
    if let Some(v) = patch.pulse_width {
        set_f(setter, &params.pulse_width, v);
    }
    if let Some(v) = patch.cutoff {
        set_f(setter, &params.cutoff, v);
    }
    if let Some(v) = patch.resonance {
        set_f(setter, &params.reso, v);
    }
    if let Some(v) = patch.attack {
        set_f(setter, &params.attack, v);
    }
    if let Some(v) = patch.decay {
        set_f(setter, &params.decay, v);
    }
    if let Some(v) = patch.sustain {
        set_f(setter, &params.sustain, v);
    }
    if let Some(v) = patch.release {
        set_f(setter, &params.release, v);
    }
    if let Some(v) = patch.octave {
        set_i(setter, &params.octave, v);
    }
    if let Some(v) = patch.unison {
        set_i(setter, &params.unison, v.clamp(1, 3));
    }
    if let Some(v) = patch.volume {
        set_f(setter, &params.volume, v);
    }
    if let Some(v) = patch.halloween {
        set_f(setter, &params.halloween, v);
    }
    if let Some(v) = patch.waters {
        set_f(setter, &params.waters, v);
    }
    if let Some(v) = patch.aether {
        set_f(setter, &params.aether, v);
    }
}

fn clean_skin(s: &str) -> Option<String> {
    match s {
        "forge" | "rack" => Some(s.to_string()),
        _ => None,
    }
}

fn clean_trim(s: &str) -> Option<String> {
    match s {
        "off" | "plasma" | "purple" | "green" => Some(s.to_string()),
        _ => None,
    }
}

fn clean_kind(s: &str) -> String {
    match s.to_ascii_uppercase().as_str() {
        "EARTH" | "WATER" | "FIRE" | "WIND" => s.to_ascii_uppercase(),
        _ => "free".to_string(),
    }
}

fn clean_handle(s: &str) -> String {
    s.trim()
        .trim_start_matches('@')
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        .take(15)
        .collect()
}

fn apply_face(params: &SkyForgeParams, patch: Action) {
    let Action::Face {
        skin,
        trim,
        handle,
        kind,
        preset,
    } = patch
    else {
        return;
    };
    let Ok(mut face) = params.face.lock() else {
        return;
    };
    if let Some(s) = skin.as_deref().and_then(clean_skin) {
        face.skin = s;
    }
    if let Some(s) = trim.as_deref().and_then(clean_trim) {
        face.trim = s;
    }
    if let Some(s) = handle.as_deref() {
        face.handle = clean_handle(s);
    }
    if let Some(s) = kind.as_deref() {
        face.kind = clean_kind(s);
    }
    if let Some(s) = preset {
        let t: String = s
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .take(24)
            .collect();
        if !t.is_empty() {
            face.preset = t;
        }
    }
}

fn snapshot(params: &SkyForgeParams) -> serde_json::Value {
    let face = params
        .face
        .lock()
        .map(|f| f.clone())
        .unwrap_or_else(|_| FaceState::default());
    json!({
        "type": "state",
        "params": {
            "waveform": wave_to(params.wave.value()),
            "pulseWidth": params.pulse_width.value(),
            "filterType": filter_to(params.filter.value()),
            "cutoff": params.cutoff.value(),
            "resonance": params.reso.value(),
            "attack": params.attack.value(),
            "decay": params.decay.value(),
            "sustain": params.sustain.value(),
            "release": params.release.value(),
            "octave": params.octave.value(),
            "volume": params.volume.value(),
            "halloween": params.halloween.value(),
            "waters": params.waters.value(),
            "aether": params.aether.value(),
            "unison": params.unison.value(),
        },
        "skin": face.skin,
        "trim": face.trim,
        "handle": face.handle,
        "kind": face.kind,
        "preset": face.preset,
        "rec": face.rec,
    })
}

fn b64(data: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    let mut i = 0;
    while i + 3 <= data.len() {
        let n = ((data[i] as u32) << 16) | ((data[i + 1] as u32) << 8) | (data[i + 2] as u32);
        out.push(T[(n >> 18) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(T[((n >> 6) & 63) as usize] as char);
        out.push(T[(n & 63) as usize] as char);
        i += 3;
    }
    if i + 1 == data.len() {
        let n = (data[i] as u32) << 16;
        out.push(T[(n >> 18) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push('=');
        out.push('=');
    } else if i + 2 == data.len() {
        let n = ((data[i] as u32) << 16) | ((data[i + 1] as u32) << 8);
        out.push(T[(n >> 18) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(T[((n >> 6) & 63) as usize] as char);
        out.push('=');
    }
    out
}

fn clip_start(bus: &crate::FaceBus, mode: &str) {
    bus.clip_on.store(false, Ordering::Relaxed);
    if let Ok(mut dump) = bus.dump.lock() {
        *dump = None;
    }
    if let Ok(mut buf) = bus.clip.lock() {
        buf.clear();
        buf.reserve(48_000 * 30);
    }
    if let Ok(mut m) = bus.clip_mode.lock() {
        *m = mode.to_string();
    }
    bus.clip_on.store(true, Ordering::Relaxed);
}

fn saved_json(ok: bool, name: &str) -> serde_json::Value {
    json!({ "type": "saved", "ok": ok, "name": name })
}

fn clip_stop(bus: &crate::FaceBus) -> (String, u32, Vec<i16>) {
    bus.clip_on.store(false, Ordering::Relaxed);
    let mode = bus
        .clip_mode
        .lock()
        .map(|mut m| std::mem::take(&mut *m))
        .unwrap_or_else(|_| "wyrm".to_string());
    let samples = bus
        .clip
        .lock()
        .map(|mut b| std::mem::take(&mut *b))
        .unwrap_or_default();
    let sr = bus.clip_sr.load(Ordering::Relaxed).max(8_000);
    let pcm: Vec<i16> = samples
        .iter()
        .map(|s| (s.clamp(-1.0, 1.0) * 32767.0) as i16)
        .collect();
    if let Ok(mut last) = bus.last_pcm.lock() {
        *last = Some((sr, pcm.clone()));
    }
    (if mode.is_empty() { "wyrm".to_string() } else { mode }, sr, pcm)
}

fn pump_clip(ctx: &nih_plug_webview::WindowHandler, bus: &crate::FaceBus) -> bool {
    let Ok(mut slot) = bus.dump.lock() else {
        return false;
    };
    let Some(dump) = slot.as_mut() else {
        return false;
    };
    if !dump.begun {
        let _ = ctx.send_json(json!({
            "type": "clip",
            "phase": "begin",
            "sr": dump.sr,
            "n": dump.pcm.len(),
            "mode": dump.mode,
        }));
        dump.begun = true;
        return true;
    }
    if dump.sent < dump.pcm.len() {
        let end = (dump.sent + CLIP_CHUNK).min(dump.pcm.len());
        let slice = &dump.pcm[dump.sent..end];
        let mut bytes = Vec::with_capacity(slice.len() * 2);
        for s in slice {
            bytes.extend_from_slice(&s.to_le_bytes());
        }
        let _ = ctx.send_json(json!({
            "type": "clip",
            "phase": "chunk",
            "data": b64(&bytes),
        }));
        dump.sent = end;
        return true;
    }
    let _ = ctx.send_json(json!({ "type": "clip", "phase": "end" }));
    *slot = None;
    true
}

fn pump_midi(ctx: &nih_plug_webview::WindowHandler, bus: &crate::FaceBus) {
    let events = bus
        .midi
        .lock()
        .map(|log| log.clone())
        .unwrap_or_default();
    if events.is_empty() {
        let _ = ctx.send_json(saved_json(false, "skyforge-clip.mid"));
        return;
    }
    let name = format!("skyforge-clip-{}.mid", crate::files::stamp());
    match crate::files::write_midi(&name, &events) {
        Ok(path) => {
            let _ = ctx.send_json(saved_json(true, &crate::files::file_name(&path)));
        }
        Err(_) => {
            let _ = ctx.send_json(saved_json(false, &name));
        }
    }
}

fn save_start(bus: &crate::FaceBus, name: String) {
    if let Ok(mut slot) = bus.save.lock() {
        *slot = Some((name, Vec::with_capacity(256_000)));
    }
}

fn save_chunk(bus: &crate::FaceBus, data: &str) {
    if let Ok(mut slot) = bus.save.lock() {
        if let Some((_, buf)) = slot.as_mut() {
            buf.extend_from_slice(&crate::files::decode_b64(data));
        }
    }
}

fn save_end(ctx: &nih_plug_webview::WindowHandler, bus: &crate::FaceBus) {
    let taken = bus.save.lock().ok().and_then(|mut s| s.take());
    let Some((name, bytes)) = taken else {
        let _ = ctx.send_json(saved_json(false, "skyforge.bin"));
        return;
    };
    if bytes.is_empty() {
        let _ = ctx.send_json(saved_json(false, &name));
        return;
    }
    match crate::files::write_download(&name, &bytes) {
        Ok(path) => {
            let _ = ctx.send_json(saved_json(true, &crate::files::file_name(&path)));
        }
        Err(_) => {
            let _ = ctx.send_json(saved_json(false, &name));
        }
    }
}

fn save_wav(ctx: &nih_plug_webview::WindowHandler, bus: &crate::FaceBus, stem: Option<String>) {
    let stem_key = stem.clone().unwrap_or_default();
    let from_wyrm = bus.wyrms.lock().ok().and_then(|log| {
        log.iter()
            .find(|w| !stem_key.is_empty() && (w.stem == stem_key || w.name == stem_key))
            .map(|w| (w.sr, w.pcm.clone()))
    });
    let taken = from_wyrm.or_else(|| bus.last_pcm.lock().ok().and_then(|g| g.clone()));
    let Some((sr, pcm)) = taken else {
        let _ = ctx.send_json(saved_json(false, "skyforge-bounce.wav"));
        return;
    };
    let stem = stem
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("skyforge-bounce-{}", crate::files::stamp()));
    let name = if stem.ends_with(".wav") {
        stem
    } else {
        format!("{stem}.wav")
    };
    if (pcm.len() as f32) < sr as f32 * 0.15 {
        let _ = ctx.send_json(saved_json(false, &name));
        return;
    }
    match crate::files::write_wav(&name, &pcm, sr) {
        Ok(path) => {
            let _ = ctx.send_json(saved_json(true, &crate::files::file_name(&path)));
        }
        Err(_) => {
            let _ = ctx.send_json(saved_json(false, &name));
        }
    }
}

fn clean_short(s: &str, n: usize) -> String {
    s.chars()
        .filter(|c| *c >= ' ' && *c != '\u{7f}')
        .take(n)
        .collect()
}

fn keep_wyrm(bus: &crate::FaceBus, action: Action) {
    let Action::WyrmKeep {
        id,
        epithet,
        element,
        at,
        name,
        thumb,
        stem,
    } = action
    else {
        return;
    };
    let id = clean_short(id.as_deref().unwrap_or(""), 40);
    if id.is_empty() {
        return;
    }
    let (sr, pcm) = bus
        .last_pcm
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .unwrap_or((44_100, Vec::new()));
    let wyrm = crate::KeptWyrm {
        id: id.clone(),
        epithet: clean_short(epithet.as_deref().unwrap_or("Wyrm"), 48),
        element: clean_short(element.as_deref().unwrap_or("FIRE"), 12),
        at: at.unwrap_or(0),
        name: clean_short(name.as_deref().unwrap_or("ear-wyrm.mp4"), 80),
        thumb: thumb
            .unwrap_or_default()
            .chars()
            .take(120_000)
            .collect(),
        stem: clean_short(stem.as_deref().unwrap_or("ear-wyrm"), 80),
        sr,
        pcm,
    };
    if let Ok(mut log) = bus.wyrms.lock() {
        log.retain(|w| w.id != id);
        log.insert(0, wyrm);
        log.truncate(3);
    }
}

fn wyrms_json(bus: &crate::FaceBus) -> serde_json::Value {
    let log = bus
        .wyrms
        .lock()
        .map(|log| {
            log.iter()
                .map(|w| {
                    json!({
                        "id": w.id,
                        "epithet": w.epithet,
                        "element": w.element,
                        "at": w.at,
                        "name": w.name,
                        "thumb": w.thumb,
                        "stem": w.stem,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({ "type": "wyrms", "log": log })
}

pub fn build_editor(params: Arc<SkyForgeParams>, bus: Arc<crate::FaceBus>) -> Option<Box<dyn Editor>> {
    let face: &'static str = include_str!("face.html");
    let ready = Arc::new(AtomicBool::new(false));
    let editor = WebViewEditor::new(HTMLSource::String(face), (FACE_W, FACE_H))
        .with_background_color((0x4a, 0x3a, 0x62, 255))
        .with_developer_mode(false)
        .with_keyboard_handler(|event| event.key == Key::Escape)
        .with_event_loop(move |ctx, setter, _window| {
            while let Ok(value) = ctx.next_event() {
                match serde_json::from_value::<Action>(value) {
                    Ok(Action::Init) => {
                        ready.store(true, Ordering::Relaxed);
                        let _ = ctx.send_json(snapshot(&params));
                        let _ = ctx.send_json(wyrms_json(&bus));
                    }
                    Ok(Action::Patch { params: patch }) => {
                        apply_patch(&setter, &params, patch);
                        if let Ok(mut face) = params.face.lock() {
                            face.preset = "custom".to_string();
                        }
                    }
                    Ok(action @ Action::Face { .. }) => apply_face(&params, action),
                    Ok(Action::NoteOn { note, vel }) => {
                        if let Ok(mut q) = bus.inbox.lock() {
                            q.push((note, true, vel.unwrap_or(0.9)));
                        }
                    }
                    Ok(Action::NoteOff { note }) => {
                        if let Ok(mut q) = bus.inbox.lock() {
                            q.push((note, false, 0.0));
                        }
                    }
                    Ok(Action::ClipStart { mode }) => {
                        let mode = match mode.as_deref() {
                            Some("bounce") => "bounce",
                            _ => "wyrm",
                        };
                        if let Ok(mut face) = params.face.lock() {
                            face.rec = mode.to_string();
                        }
                        clip_start(&bus, mode);
                    }
                    Ok(Action::ClipStop) => {
                        if let Ok(mut face) = params.face.lock() {
                            face.rec.clear();
                        }
                        let (mode, sr, pcm) = clip_stop(&bus);
                        if mode == "bounce" {
                            let name = format!("skyforge-bounce-{}.wav", crate::files::stamp());
                            let long_enough = (pcm.len() as f32) >= sr as f32 * 0.15;
                            if long_enough {
                                match crate::files::write_wav(&name, &pcm, sr) {
                                    Ok(path) => {
                                        let _ = ctx.send_json(saved_json(
                                            true,
                                            &crate::files::file_name(&path),
                                        ));
                                    }
                                    Err(_) => {
                                        let _ = ctx.send_json(saved_json(false, &name));
                                    }
                                }
                            } else {
                                let _ = ctx.send_json(saved_json(false, &name));
                            }
                        } else if let Ok(mut dump) = bus.dump.lock() {
                            *dump = Some(crate::ClipDump {
                                sr,
                                pcm,
                                sent: 0,
                                begun: false,
                                mode,
                            });
                        }
                    }
                    Ok(Action::MidiDump) => pump_midi(ctx, &bus),
                    Ok(Action::SaveStart { name }) => save_start(&bus, name),
                    Ok(Action::SaveChunk { data }) => save_chunk(&bus, &data),
                    Ok(Action::SaveEnd) => save_end(ctx, &bus),
                    Ok(Action::SaveWav { stem }) => save_wav(ctx, &bus, stem),
                    Ok(action @ Action::WyrmKeep { .. }) => keep_wyrm(&bus, action),
                    Err(_) => {}
                }
            }
            if !ready.load(Ordering::Relaxed) {
                return;
            }
            if pump_clip(ctx, &bus) {
                return;
            }

            let rms = f32::from_bits(bus.rms.load(Ordering::Relaxed));
            let scope = bus
                .scope
                .lock()
                .map(|s| s.iter().copied().collect::<Vec<f32>>())
                .unwrap_or_default();
            let notes: Vec<u8> = bus
                .held
                .lock()
                .map(|h| {
                    h.iter()
                        .enumerate()
                        .filter_map(|(i, on)| if *on { Some(i as u8) } else { None })
                        .collect()
                })
                .unwrap_or_default();
            let _ = ctx.send_json(json!({
                "type": "meter",
                "rms": rms,
                "scope": scope,
                "notes": notes,
            }));
        });
    Some(Box::new(editor))
}

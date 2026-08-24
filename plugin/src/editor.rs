use crate::{ClipDump, FaceBus, FilterKind, SkyForgeParams, WaveKind};
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
    NoteOn { note: u8, vel: Option<f32> },
    NoteOff { note: u8 },
    ClipStart,
    ClipStop,
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

fn filter_from(s: &str) -> FilterKind {
    match s {
        "highpass" => FilterKind::Highpass,
        "bandpass" => FilterKind::Bandpass,
        _ => FilterKind::Lowpass,
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

fn clip_start(bus: &FaceBus) {
    bus.clip_on.store(false, Ordering::Relaxed);
    if let Ok(mut dump) = bus.dump.lock() {
        *dump = None;
    }
    if let Ok(mut buf) = bus.clip.lock() {
        buf.clear();
        buf.reserve(48_000 * 30);
    }
    bus.clip_on.store(true, Ordering::Relaxed);
}

fn clip_stop(bus: &FaceBus) {
    bus.clip_on.store(false, Ordering::Relaxed);
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
    if let Ok(mut dump) = bus.dump.lock() {
        *dump = Some(ClipDump {
            sr,
            pcm,
            sent: 0,
            begun: false,
        });
    }
}

fn pump_clip(ctx: &nih_plug_webview::WindowHandler, bus: &FaceBus) -> bool {
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

pub fn build_editor(params: Arc<SkyForgeParams>, bus: Arc<FaceBus>) -> Option<Box<dyn Editor>> {
    let face: &'static str = include_str!("face.html");
    let ready = Arc::new(AtomicBool::new(false));
    let editor = WebViewEditor::new(HTMLSource::String(face), (FACE_W, FACE_H))
        .with_background_color((0x4a, 0x3a, 0x62, 255))
        .with_developer_mode(false)
        .with_keyboard_handler(|event| event.key == Key::Escape)
        .with_event_loop(move |ctx, setter, _window| {
            while let Ok(value) = ctx.next_event() {
                match serde_json::from_value::<Action>(value) {
                    Ok(Action::Init) => ready.store(true, Ordering::Relaxed),
                    Ok(Action::Patch { params: patch }) => apply_patch(&setter, &params, patch),
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
                    Ok(Action::ClipStart) => clip_start(&bus),
                    Ok(Action::ClipStop) => clip_stop(&bus),
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

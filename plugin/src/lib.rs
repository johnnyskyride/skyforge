use nih_plug::prelude::*;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};



mod editor;
mod files;
mod midi_out;
#[cfg(windows)]
mod share_win;

const MAX_VOICES: usize = 8;
const HAUNT_SECS: f32 = 0.92;
const WATER_SECS: f32 = 0.08;
const WATER_ROOM_SECS: f32 = 0.24;
const CAVE_SECS: f32 = 0.05;

#[derive(Enum, PartialEq, Clone, Copy)]
pub(crate) enum WaveKind {
    #[id = "sine"]
    Sine,
    #[id = "tri"]
    Triangle,
    #[id = "saw"]
    Saw,
    #[id = "sqr"]
    Square,
    #[id = "pulse"]
    Pulse,
    #[id = "noise"]
    Noise,
}

#[derive(Enum, PartialEq, Clone, Copy)]
pub(crate) enum FilterKind {
    #[id = "lp"]
    Lowpass,
    #[id = "hp"]
    Highpass,
    #[id = "bp"]
    Bandpass,
}

#[derive(Enum, PartialEq, Clone, Copy)]
pub(crate) enum Kind {
    #[id = "free"]
    Free,
    #[id = "earth"]
    Earth,
    #[id = "water"]
    Water,
    #[id = "fire"]
    Fire,
    #[id = "wind"]
    Wind,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub(crate) struct FaceState {
    pub skin: String,
    pub trim: String,
    pub handle: String,
    pub kind: String,
    pub preset: String,
    pub rec: String,
    pub scale: f32,
    pub banks: String,
}

impl Default for FaceState {
    fn default() -> Self {
        Self {
            skin: "forge".to_string(),
            trim: "off".to_string(),
            handle: String::new(),
            kind: "free".to_string(),
            preset: "init".to_string(),
            rec: String::new(),
            scale: 1.0,
            banks: String::new(),
        }
    }
}

#[derive(Params)]
pub(crate) struct SkyForgeParams {
    #[id = "kind"]
    pub kind: EnumParam<Kind>,
    #[id = "wave"]
    pub wave: EnumParam<WaveKind>,
    #[id = "pw"]
    pub pulse_width: FloatParam,
    #[id = "ftype"]
    pub filter: EnumParam<FilterKind>,
    #[id = "cut"]
    pub cutoff: FloatParam,
    #[id = "res"]
    pub reso: FloatParam,
    #[id = "atk"]
    pub attack: FloatParam,
    #[id = "dec"]
    pub decay: FloatParam,
    #[id = "sus"]
    pub sustain: FloatParam,
    #[id = "rel"]
    pub release: FloatParam,
    #[id = "oct"]
    pub octave: IntParam,
    #[id = "uni"]
    pub unison: IntParam,
    #[id = "vol"]
    pub volume: FloatParam,
    #[id = "haunt"]
    pub halloween: FloatParam,
    #[id = "waters"]
    pub waters: FloatParam,
    #[id = "aether"]
    pub aether: FloatParam,
    #[persist = "face"]
    pub face: Mutex<FaceState>,
    #[persist = "wyrms"]
    pub wyrms: Mutex<Vec<KeptWyrm>>,
}


impl Default for SkyForgeParams {
    fn default() -> Self {
        Self {
            kind: EnumParam::new("Kind", Kind::Free),
            wave: EnumParam::new("Wave", WaveKind::Saw),
            pulse_width: FloatParam::new("Width", 0.25, FloatRange::Linear { min: 0.05, max: 0.5 })
                .with_unit("%")
                .with_value_to_string(formatters::v2s_f32_percentage(0))
                .with_string_to_value(formatters::s2v_f32_percentage()),
            filter: EnumParam::new("Filter", FilterKind::Lowpass),
            cutoff: FloatParam::new(
                "Cutoff",
                1400.0,
                FloatRange::Skewed {
                    min: 40.0,
                    max: 16_000.0,
                    factor: FloatRange::skew_factor(-2.0),
                },
            )
            .with_unit(" Hz")
            .with_smoother(SmoothingStyle::Logarithmic(40.0)),
            reso: FloatParam::new("Reso", 2.2, FloatRange::Linear { min: 0.1, max: 18.0 })
                .with_smoother(SmoothingStyle::Linear(40.0)),
            attack: FloatParam::new(
                "Attack",
                0.008,
                FloatRange::Skewed {
                    min: 0.001,
                    max: 4.0,
                    factor: FloatRange::skew_factor(-1.5),
                },
            )
            .with_unit(" s"),
            decay: FloatParam::new(
                "Decay",
                0.22,
                FloatRange::Skewed {
                    min: 0.01,
                    max: 4.0,
                    factor: FloatRange::skew_factor(-1.5),
                },
            )
            .with_unit(" s"),
            sustain: FloatParam::new("Sustain", 0.72, FloatRange::Linear { min: 0.0, max: 1.0 }),
            release: FloatParam::new(
                "Release",
                0.28,
                FloatRange::Skewed {
                    min: 0.01,
                    max: 8.0,
                    factor: FloatRange::skew_factor(-1.5),
                },
            )
            .with_unit(" s"),
            octave: IntParam::new("Octave", 0, IntRange::Linear { min: -2, max: 2 }),
            unison: IntParam::new("Unison", 2, IntRange::Linear { min: 1, max: 3 }),
            volume: FloatParam::new("Volume", 0.84, FloatRange::Linear { min: 0.0, max: 1.0 })
                .with_smoother(SmoothingStyle::Linear(20.0)),
            halloween: FloatParam::new("Halloween", 0.0, FloatRange::Linear { min: 0.0, max: 1.0 })
                .with_smoother(SmoothingStyle::Linear(50.0)),
            waters: FloatParam::new("Waters", 0.0, FloatRange::Linear { min: 0.0, max: 1.0 })
                .with_smoother(SmoothingStyle::Linear(50.0)),
            aether: FloatParam::new("Aether", 0.0, FloatRange::Linear { min: 0.0, max: 1.0 })
                .with_smoother(SmoothingStyle::Linear(50.0)),
            face: Mutex::new(FaceState::default()),
            wyrms: Mutex::new(Vec::new()),
        }
    }
}

pub(crate) struct ClipDump {
    pub sr: u32,
    pub pcm: Vec<i16>,
    pub sent: usize,
    pub begun: bool,
    pub mode: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct KeptWyrm {
    pub id: String,
    pub epithet: String,
    pub element: String,
    pub at: u64,
    pub name: String,
    pub thumb: String,
    pub stem: String,
    pub sr: u32,
    #[serde(default, skip_serializing)]
    pub pcm: Vec<i16>,
}

pub(crate) struct FaceBus {
    pub rms: AtomicU32,
    pub scope: Mutex<[f32; 192]>,
    pub i: AtomicUsize,
    pub held: Mutex<[bool; 128]>,
    pub inbox: Mutex<Vec<(u8, bool, f32)>>,
    pub clip_on: AtomicBool,
    pub clip_sr: AtomicU32,
    pub clip_max_sec: AtomicU32,
    pub clip_full: AtomicBool,
    pub clip: Mutex<Vec<f32>>,
    pub clip_mode: Mutex<String>,
    pub dump: Mutex<Option<ClipDump>>,
    pub midi: Mutex<Vec<(f32, u8, bool, f32)>>,
    pub midi_t: AtomicU32,
    pub last_pcm: Mutex<Option<(u32, Vec<i16>)>>,
    pub save: Mutex<Option<(String, Vec<u8>)>>,
    pub last_video: Mutex<Option<std::path::PathBuf>>,
    pub wyrms: Mutex<Vec<KeptWyrm>>,
    pub midi_out: midi_out::SkyMidi,
    pub midi_flush: AtomicBool,
}

impl FaceBus {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            rms: AtomicU32::new(0),
            scope: Mutex::new([0.0; 192]),
            i: AtomicUsize::new(0),
            held: Mutex::new([false; 128]),
            inbox: Mutex::new(Vec::with_capacity(32)),
            clip_on: AtomicBool::new(false),
            clip_sr: AtomicU32::new(44_100),
            clip_max_sec: AtomicU32::new(30),
            clip_full: AtomicBool::new(false),
            clip: Mutex::new(Vec::new()),
            clip_mode: Mutex::new(String::new()),
            dump: Mutex::new(None),
            midi: Mutex::new(Vec::with_capacity(256)),
            midi_t: AtomicU32::new(0),
            last_pcm: Mutex::new(None),
            save: Mutex::new(None),
            last_video: Mutex::new(None),
            wyrms: Mutex::new(Vec::with_capacity(3)),
            midi_out: midi_out::SkyMidi::new(),
            midi_flush: AtomicBool::new(false),
        })
    }
}


#[derive(Clone, Copy)]
struct Shape {
    wave: WaveKind,
    filter: FilterKind,
    cutoff: f32,
    reso: f32,
    attack: f32,
    decay: f32,
    sustain: f32,
    release: f32,
    octave: i32,
    unison: i32,
    waters: f32,
    halloween: f32,
    aether: f32,
}

fn kind_shape(kind: Kind) -> Option<Shape> {
    Some(match kind {
        Kind::Free => return None,
        Kind::Earth => Shape {
            wave: WaveKind::Triangle,
            filter: FilterKind::Lowpass,
            cutoff: 1760.0,
            reso: 1.08,
            attack: 0.028,
            decay: 0.32,
            sustain: 0.92,
            release: 0.7,
            octave: -1,
            unison: 3,
            waters: 0.1,
            halloween: 0.0,
            aether: 0.0,
        },
        Kind::Water => Shape {
            wave: WaveKind::Sine,
            filter: FilterKind::Lowpass,
            cutoff: 2680.0,
            reso: 0.52,
            attack: 0.12,
            decay: 0.42,
            sustain: 0.9,
            release: 0.96,
            octave: 0,
            unison: 2,
            waters: 0.5,
            halloween: 0.0,
            aether: 0.07,
        },
        Kind::Fire => Shape {
            wave: WaveKind::Saw,
            filter: FilterKind::Lowpass,
            cutoff: 3800.0,
            reso: 2.8,
            attack: 0.002,
            decay: 0.18,
            sustain: 0.62,
            release: 0.16,
            octave: 0,
            unison: 1,
            waters: 0.0,
            halloween: 0.28,
            aether: 0.0,
        },
        Kind::Wind => Shape {
            wave: WaveKind::Triangle,
            filter: FilterKind::Highpass,
            cutoff: 320.0,
            reso: 0.9,
            attack: 0.03,
            decay: 0.22,
            sustain: 0.72,
            release: 0.4,
            octave: 0,
            unison: 3,
            waters: 0.06,
            halloween: 0.0,
            aether: 0.22,
        },
    })
}

#[derive(Clone, Copy)]
enum EnvStage {
    Attack,
    Decay,
    Sustain,
    Release,
    Off,
}

#[derive(Clone, Copy)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl Biquad {
    fn silent() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            z1: 0.0,
            z2: 0.0,
        }
    }

    fn set_svf(&mut self, kind: FilterKind, cutoff: f32, q: f32, sr: f32) {
        let f = cutoff.clamp(20.0, sr * 0.45);
        let w = std::f32::consts::TAU * f / sr;
        let (sin, cos) = w.sin_cos();
        let alpha = sin / (2.0 * q.max(0.08));
        let (b0, b1, b2, a0, a1, a2) = match kind {
            FilterKind::Lowpass => {
                let b1 = 1.0 - cos;
                let b0 = b1 * 0.5;
                (b0, b1, b0, 1.0 + alpha, -2.0 * cos, 1.0 - alpha)
            }
            FilterKind::Highpass => {
                let b1 = -(1.0 + cos);
                let b0 = (1.0 + cos) * 0.5;
                (b0, b1, b0, 1.0 + alpha, -2.0 * cos, 1.0 - alpha)
            }
            FilterKind::Bandpass => (alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * cos, 1.0 - alpha),
        };
        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    fn set_peaking(&mut self, cutoff: f32, q: f32, gain_db: f32, sr: f32) {
        let f = cutoff.clamp(20.0, sr * 0.45);
        let w = std::f32::consts::TAU * f / sr;
        let (sin, cos) = w.sin_cos();
        let a = 10.0f32.powf(gain_db / 40.0);
        let alpha = sin / (2.0 * q.max(0.08));
        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * cos;
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * cos;
        let a2 = 1.0 - alpha / a;
        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    fn set_highshelf(&mut self, cutoff: f32, gain_db: f32, sr: f32) {
        let f = cutoff.clamp(20.0, sr * 0.45);
        let w = std::f32::consts::TAU * f / sr;
        let (sin, cos) = w.sin_cos();
        let a = 10.0f32.powf(gain_db / 40.0);
        let alpha = sin * std::f32::consts::FRAC_1_SQRT_2;
        let two_sa = 2.0 * a.sqrt() * alpha;
        let b0 = a * ((a + 1.0) + (a - 1.0) * cos + two_sa);
        let b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cos);
        let b2 = a * ((a + 1.0) + (a - 1.0) * cos - two_sa);
        let a0 = (a + 1.0) - (a - 1.0) * cos + two_sa;
        let a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cos);
        let a2 = (a + 1.0) - (a - 1.0) * cos - two_sa;
        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    fn tick(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        if y.is_finite() {
            y
        } else {
            self.z1 = 0.0;
            self.z2 = 0.0;
            0.0
        }
    }
}

struct DelayLine {
    buf: Vec<f32>,
    w: usize,
}

impl DelayLine {
    fn new(n: usize) -> Self {
        Self {
            buf: vec![0.0; n.max(8)],
            w: 0,
        }
    }

    fn resize(&mut self, n: usize) {
        let n = n.max(8);
        if self.buf.len() != n {
            self.buf = vec![0.0; n];
            self.w = 0;
        }
    }

    fn write(&mut self, x: f32) {
        let n = self.buf.len();
        self.buf[self.w] = x;
        self.w += 1;
        if self.w >= n {
            self.w = 0;
        }
    }

    fn read(&self, delay_samples: f32) -> f32 {
        let n = self.buf.len();
        let d = delay_samples.clamp(1.0, (n - 2) as f32);
        let read = (self.w as f32 - d).rem_euclid(n as f32);
        let i0 = read as usize % n;
        let i1 = (i0 + 1) % n;
        let frac = read.fract();
        self.buf[i0] * (1.0 - frac) + self.buf[i1] * frac
    }

    fn clear(&mut self) {
        self.buf.fill(0.0);
        self.w = 0;
    }
}

struct Aether {
    held: f32,
    prev: f32,
    phase: f32,
    lp: Biquad,
    hp: Biquad,
    wow: f32,
}

impl Aether {
    fn new() -> Self {
        Self {
            held: 0.0,
            prev: 0.0,
            phase: 0.0,
            lp: Biquad::silent(),
            hp: Biquad::silent(),
            wow: 0.0,
        }
    }

    fn tick(&mut self, x: f32, amt: f32, sr: f32, noise: &mut u32) -> f32 {
        let x = if x.is_finite() { x } else { 0.0 };
        if !(amt.is_finite()) || amt < 0.006 {
            return x;
        }
        let hold_n = 1.0 + amt * amt * 13.5;
        self.phase += 1.0;
        if self.phase >= hold_n {
            self.phase -= hold_n;
            self.prev = self.held;
            let bits = 13.2 - amt * 6.0;
            let levels = 2.0f32.powf(bits - 1.0).max(8.0);
            let dith = tpdf(noise) * (0.45 / levels);
            self.held = ((x + dith) * levels).round() / levels;
            if !self.held.is_finite() {
                self.held = 0.0;
            }
        }
        let frac = (self.phase / hold_n).clamp(0.0, 1.0);
        let mut y = self.prev + (self.held - self.prev) * frac;
        let drive = 1.06 + amt * 0.78;
        y = softsat(y, drive);
        self.hp
            .set_svf(FilterKind::Highpass, 80.0 + amt * 160.0, 0.62, sr);
        self.lp.set_svf(
            FilterKind::Lowpass,
            13_200.0 * (2_600.0_f32 / 13_200.0).powf(amt),
            0.68,
            sr,
        );
        y = self.lp.tick(self.hp.tick(y));
        self.wow = (self.wow + (0.17 + amt * 0.11) / sr) % 1.0;
        y *= 1.0 + (self.wow * std::f32::consts::TAU).sin() * amt * 0.012;
        x * (1.0 - amt * 0.32) + y * (amt * 0.94)
    }
}

struct Limit {
    env: f32,
}

impl Limit {
    fn tick(&mut self, x: f32, sr: f32) -> f32 {
        let a = x.abs();
        let atk = 1.0 - (-1.0 / (0.003 * sr)).exp();
        let rel = (-1.0 / (0.14 * sr)).exp();
        if a > self.env {
            self.env += (a - self.env) * atk;
        } else {
            self.env *= rel;
        }
        let thr = 0.63;
        let g = if self.env > thr { thr / self.env } else { 1.0 };
        let y = (x * g).clamp(-1.4, 1.4);
        y - y * y * y * (1.0 / 6.0)
    }
}

struct Voice {
    active: bool,
    note: u8,
    vel: f32,
    phase: [f32; 3],
    ghost_phase: f32,
    ghost_b: f32,
    sub_phase: f32,
    env: f32,
    stage: EnvStage,
    age: u64,
    filter: Biquad,
}

impl Voice {
    fn new() -> Self {
        Self {
            active: false,
            note: 0,
            vel: 0.0,
            phase: [0.0; 3],
            ghost_phase: 0.0,
            ghost_b: 0.0,
            sub_phase: 0.0,
            env: 0.0,
            stage: EnvStage::Off,
            age: 0,
            filter: Biquad::silent(),
        }
    }
}

fn poly_blep(t: f32, dt: f32) -> f32 {
    if t < dt {
        let x = t / dt;
        x + x - x * x - 1.0
    } else if t > 1.0 - dt {
        let x = (t - 1.0) / dt;
        x + x + x * x + 1.0
    } else {
        0.0
    }
}

fn pulse(phase: f32, dt: f32, width: f32) -> f32 {
    let mut y = if phase < width { 1.0 } else { -1.0 };
    y += poly_blep(phase, dt);
    let mut t2 = phase - width;
    if t2 < 0.0 {
        t2 += 1.0;
    }
    y -= poly_blep(t2, dt);
    y
}

fn osc(kind: WaveKind, phase: f32, dt: f32, pw: f32, noise: &mut u32) -> f32 {
    match kind {
        WaveKind::Sine => (phase * std::f32::consts::TAU).sin(),
        WaveKind::Triangle => {
            let t = if phase < 0.5 {
                phase * 4.0 - 1.0
            } else {
                3.0 - phase * 4.0
            };
            t * 0.9
        }
        WaveKind::Saw => 2.0 * phase - 1.0 - poly_blep(phase, dt),
        WaveKind::Square => pulse(phase, dt, 0.5),
        WaveKind::Pulse => pulse(phase, dt, pw),
        WaveKind::Noise => {
            *noise = noise.wrapping_mul(1664525).wrapping_add(1013904223);
            (*noise as i32 as f32) * (1.0 / 2_147_483_648.0)
        }
    }
}

fn unison_cents(n: i32) -> &'static [f32] {
    match n {
        1 => &[0.0],
        2 => &[-8.5, 7.2],
        _ => &[-12.4, 0.6, 11.1],
    }
}

fn tpdf(noise: &mut u32) -> f32 {
    let a = randf(noise);
    let b = randf(noise);
    a - b
}

fn randf(noise: &mut u32) -> f32 {
    *noise = noise.wrapping_mul(1664525).wrapping_add(1013904223);
    (*noise as i32 as f32) * (1.0 / 2_147_483_648.0)
}

fn softsat(x: f32, drive: f32) -> f32 {
    let d = drive.max(0.25);
    (x * d).tanh() / d.tanh()
}

fn cents_ratio(cents: f32) -> f32 {
    2.0f32.powf(cents / 1200.0)
}

struct SkyForge {
    params: Arc<SkyForgeParams>,
    bus: Arc<FaceBus>,
    voices: [Voice; MAX_VOICES],
    sr: f32,
    age: u64,
    noise: u32,
    haunt: DelayLine,
    haunt2: DelayLine,
    water1: DelayLine,
    water2: DelayLine,
    water3: DelayLine,
    water4: DelayLine,
    water_room: DelayLine,
    cave1: DelayLine,
    cave2: DelayLine,
    water_lp: Biquad,
    water_peak: Biquad,
    water_air: Biquad,
    root_body: Biquad,
    root_wood: Biquad,
    root_board: Biquad,
    root_hp: Biquad,
    cave_lp: Biquad,
    delay_lp: Biquad,
    delay_lp2: Biquad,
    whisper_bp: Biquad,
    whisper_bp2: Biquad,
    aether_l: Aether,
    aether_r: Aether,
    limit_l: Limit,
    limit_r: Limit,
    flutter_phase: f32,
    flutter2_phase: f32,
    ring_phase: f32,
    ring2_phase: f32,
    tide_a: f32,
    tide_b: f32,
    tide_c: f32,
    tide_d: f32,
    was_recording: bool,
}

impl Default for SkyForge {
    fn default() -> Self {
        Self {
            params: Arc::new(SkyForgeParams::default()),
            bus: FaceBus::new(),
            voices: std::array::from_fn(|_| Voice::new()),
            sr: 44_100.0,
            age: 0,
            noise: 0xA341316C,
            haunt: DelayLine::new(64),
            haunt2: DelayLine::new(64),
            water1: DelayLine::new(64),
            water2: DelayLine::new(64),
            water3: DelayLine::new(64),
            water4: DelayLine::new(64),
            water_room: DelayLine::new(64),
            cave1: DelayLine::new(64),
            cave2: DelayLine::new(64),
            water_lp: Biquad::silent(),
            water_peak: Biquad::silent(),
            water_air: Biquad::silent(),
            root_body: Biquad::silent(),
            root_wood: Biquad::silent(),
            root_board: Biquad::silent(),
            root_hp: Biquad::silent(),
            cave_lp: Biquad::silent(),
            delay_lp: Biquad::silent(),
            delay_lp2: Biquad::silent(),
            whisper_bp: Biquad::silent(),
            whisper_bp2: Biquad::silent(),
            aether_l: Aether::new(),
            aether_r: {
                let mut a = Aether::new();
                a.phase = 5.0;
                a.wow = 0.31;
                a
            },
            limit_l: Limit { env: 0.0 },
            limit_r: Limit { env: 0.0 },
            flutter_phase: 0.0,
            flutter2_phase: 0.0,
            ring_phase: 0.0,
            ring2_phase: 0.0,
            tide_a: 0.0,
            tide_b: 0.37,
            tide_c: 0.61,
            tide_d: 0.13,
            was_recording: false,
        }
    }
}

impl SkyForge {
    fn note_on(&mut self, note: u8, vel: f32) {
        let slot = self
            .voices
            .iter()
            .position(|v| !v.active)
            .unwrap_or_else(|| {
                self.voices
                    .iter()
                    .enumerate()
                    .min_by_key(|(_, v)| v.age)
                    .map(|(i, _)| i)
                    .unwrap_or(0)
            });
        let v = &mut self.voices[slot];
        v.active = true;
        v.note = note;
        v.vel = vel.clamp(0.05, 1.0);
        v.phase = [0.0; 3];
        v.ghost_phase = 0.0;
        v.ghost_b = 0.0;
        v.sub_phase = 0.0;
        v.env = 0.0001;
        v.stage = EnvStage::Attack;
        v.age = self.age;
        v.filter = Biquad::silent();
        self.age += 1;
        self.tap_midi(note, true, vel);
    }

    fn note_held(&self, note: u8) -> bool {
        self.voices.iter().any(|v| {
            v.active && v.note == note && !matches!(v.stage, EnvStage::Release | EnvStage::Off)
        })
    }

    fn note_off(&mut self, note: u8) {
        for v in self.voices.iter_mut() {
            if v.active && v.note == note && !matches!(v.stage, EnvStage::Release | EnvStage::Off) {
                v.stage = EnvStage::Release;
            }
        }
        self.tap_midi(note, false, 0.0);
    }

    fn tap_midi(&self, note: u8, on: bool, vel: f32) {
        let sr = self.sr.max(1.0);
        let t = self.bus.midi_t.load(Ordering::Relaxed) as f32 / sr;
        if let Ok(mut log) = self.bus.midi.try_lock() {
            if log.len() >= 8192 {
                let drop_n = log.len() - 8191;
                log.drain(0..drop_n);
            }
            log.push((t, note, on, vel));
        }
    }

    fn panic(&mut self) {
        for v in self.voices.iter_mut() {
            *v = Voice::new();
        }
        self.haunt.clear();
        self.haunt2.clear();
        self.water1.clear();
        self.water2.clear();
        self.water3.clear();
        self.water4.clear();
        self.water_room.clear();
        self.cave1.clear();
        self.cave2.clear();
        self.aether_l = Aether::new();
        self.aether_r = Aether::new();
        self.limit_l.env = 0.0;
        self.limit_r.env = 0.0;
    }

    fn alloc_delays(&mut self, sr: f32) {
        self.haunt.resize((HAUNT_SECS * sr) as usize + 16);
        self.haunt2.resize((HAUNT_SECS * sr) as usize + 16);
        self.water1.resize((WATER_SECS * sr) as usize + 16);
        self.water2.resize((WATER_SECS * sr) as usize + 16);
        self.water3.resize((WATER_SECS * sr) as usize + 16);
        self.water4.resize((WATER_SECS * sr) as usize + 16);
        self.water_room.resize((WATER_ROOM_SECS * sr) as usize + 16);
        self.cave1.resize((CAVE_SECS * sr) as usize + 16);
        self.cave2.resize((CAVE_SECS * sr) as usize + 16);
    }
}

impl Plugin for SkyForge {
    const NAME: &'static str = "SkyForge";
    const VENDOR: &'static str = "johnnyskyride";
    const URL: &'static str = "https://github.com/johnnyskyride/skyforge";
    const EMAIL: &'static str = "johnnyskyride@users.noreply.github.com";
    const VERSION: &'static str = env!("CARGO_PKG_VERSION");

    const AUDIO_IO_LAYOUTS: &'static [AudioIOLayout] = &[AudioIOLayout {
        main_input_channels: None,
        main_output_channels: NonZeroU32::new(2),
        ..AudioIOLayout::const_default()
    }];

    const MIDI_INPUT: MidiConfig = MidiConfig::MidiCCs;
    const MIDI_OUTPUT: MidiConfig = MidiConfig::Basic;
    const SAMPLE_ACCURATE_AUTOMATION: bool = true;

    type SysExMessage = ();
    type BackgroundTask = ();

    fn params(&self) -> Arc<dyn Params> {
        self.params.clone()
    }

    fn editor(&mut self, _async_executor: AsyncExecutor<Self>) -> Option<Box<dyn Editor>> {
        editor::build_editor(self.params.clone(), self.bus.clone())
    }

    fn initialize(
        &mut self,
        _audio_io_layout: &AudioIOLayout,
        buffer_config: &BufferConfig,
        _context: &mut impl InitContext<Self>,
    ) -> bool {
        self.sr = buffer_config.sample_rate;
        self.alloc_delays(self.sr);
        self.bus.midi_out.ensure();
        if let (Ok(saved), Ok(mut live)) = (self.params.wyrms.lock(), self.bus.wyrms.lock()) {
            if live.is_empty() && !saved.is_empty() {
                *live = saved.clone();
            }
        }
        true
    }

    fn reset(&mut self) {
        self.panic();
    }

    fn process(
        &mut self,
        buffer: &mut Buffer,
        _aux: &mut AuxiliaryBuffers,
        context: &mut impl ProcessContext<Self>,
    ) -> ProcessStatus {
        let sr = context.transport().sample_rate.max(8_000.0);
        self.sr = sr;
        if self.haunt.buf.len() < 32 {
            self.alloc_delays(sr);
        }

        let mut next_event = context.next_event();
        let len = buffer.samples();
        let outputs = buffer.as_slice();
        for ch in outputs.iter_mut() {
            for s in ch.iter_mut() {
                *s = 0.0;
            }
        }

        let incoming: Vec<(u8, bool, f32)> = self
            .bus
            .inbox
            .lock()
            .map(|mut q| q.drain(..).collect())
            .unwrap_or_default();
        let mut gui_on = [false; 128];
        for (note, on, vel) in incoming {
            if on {
                if (note as usize) < 128 {
                    gui_on[note as usize] = true;
                }
                self.note_on(note, vel);
                context.send_event(NoteEvent::NoteOn {
                    timing: 0,
                    voice_id: Some(note as i32),
                    channel: 0,
                    note,
                    velocity: vel.clamp(0.0, 1.0),
                });
            } else {
                self.note_off(note);
                context.send_event(NoteEvent::NoteOff {
                    timing: 0,
                    voice_id: Some(note as i32),
                    channel: 0,
                    note,
                    velocity: 0.0,
                });
            }
        }

        let rec_now = context.transport().recording;
        if rec_now && !self.was_recording {
            if let Ok(mut log) = self.bus.midi.lock() {
                log.clear();
            }
            self.bus.midi_t.store(0, Ordering::Relaxed);
        }
        if !rec_now && self.was_recording {
            self.bus.midi_flush.store(true, Ordering::Relaxed);
        }
        self.was_recording = rec_now;

        let mut peak = 0.0f32;
        let rec = self.bus.clip_on.load(Ordering::Relaxed);
        let mut rec_local: Vec<f32> = Vec::new();
        if rec {
            rec_local.reserve(len);
        }
        self.bus.clip_sr.store(sr as u32, Ordering::Relaxed);
        let earth = matches!(self.params.kind.value(), Kind::Earth)
            || self
                .params
                .face
                .lock()
                .map(|f| f.kind.eq_ignore_ascii_case("EARTH"))
                .unwrap_or(false);
        for i in 0..len {
            while let Some(event) = next_event {
                if event.timing() as usize > i {
                    break;
                }
                match event {
                    NoteEvent::NoteOn {
                        timing: _,
                        voice_id: _,
                        channel: _,
                        note,
                        velocity,
                    } => {
                        if !(note < 128 && gui_on[note as usize]) && !self.note_held(note) {
                            self.note_on(note, velocity);
                        }
                    }
                    NoteEvent::NoteOff {
                        timing: _,
                        voice_id: _,
                        channel: _,
                        note,
                        velocity: _,
                    } => {
                        if !(note < 128 && gui_on[note as usize]) {
                            self.note_off(note);
                        }
                    }
                    NoteEvent::Choke { .. } => self.panic(),
                    _ => (),
                }
                next_event = context.next_event();
            }

            let kind = self.params.kind.value();
            let shape = kind_shape(kind);
            let wave = shape.map(|s| s.wave).unwrap_or_else(|| self.params.wave.value());
            let pw = self.params.pulse_width.value();
            let fkind = shape
                .map(|s| s.filter)
                .unwrap_or_else(|| self.params.filter.value());
            let cut_knob = self.params.cutoff.smoothed.next();
            let reso_knob = self.params.reso.smoothed.next();
            let cut = shape.map(|s| s.cutoff).unwrap_or(cut_knob);
            let reso = shape.map(|s| s.reso).unwrap_or(reso_knob);
            let atk = shape
                .map(|s| s.attack)
                .unwrap_or_else(|| self.params.attack.value())
                .max(0.001);
            let dec = shape
                .map(|s| s.decay)
                .unwrap_or_else(|| self.params.decay.value())
                .max(0.005);
            let sus = shape
                .map(|s| s.sustain)
                .unwrap_or_else(|| self.params.sustain.value());
            let rel = shape
                .map(|s| s.release)
                .unwrap_or_else(|| self.params.release.value())
                .max(0.005);
            let oct = shape
                .map(|s| s.octave)
                .unwrap_or_else(|| self.params.octave.value());
            let uni = shape
                .map(|s| s.unison)
                .unwrap_or_else(|| self.params.unison.value())
                .clamp(1, 3);
            let vol = self.params.volume.smoothed.next().clamp(0.0, 1.0);
            let h_knob = self.params.halloween.smoothed.next().clamp(0.0, 1.0);
            let t_knob = self.params.waters.smoothed.next().clamp(0.0, 1.0);
            let a_knob = self.params.aether.smoothed.next().clamp(0.0, 1.0);
            let h = match shape {
                Some(s) => h_knob.max(s.halloween),
                None => h_knob,
            };
            let t = match shape {
                Some(s) => t_knob.max(s.waters),
                None => t_knob,
            };
            let a = match shape {
                Some(s) => a_knob.max(s.aether),
                None => a_knob,
            };

            let mut mix = 0.0;
            let cents = unison_cents(uni);
            let uni_scale = 1.0 / (uni as f32).sqrt();
            for v in self.voices.iter_mut() {
                if !v.active {
                    continue;
                }
                match v.stage {
                    EnvStage::Attack => {
                        v.env += 1.0 / (atk * sr);
                        if v.env >= 1.0 {
                            v.env = 1.0;
                            v.stage = EnvStage::Decay;
                        }
                    }
                    EnvStage::Decay => {
                        v.env += (sus - v.env) * (1.0 - (-1.0 / (dec * sr)).exp());
                        if (v.env - sus).abs() < 0.002 {
                            v.env = sus;
                            v.stage = EnvStage::Sustain;
                        }
                    }
                    EnvStage::Sustain => v.env = sus,
                    EnvStage::Release => {
                        let r = rel + h * 0.58;
                        v.env *= (-1.0 / (r * sr)).exp();
                        if v.env < 0.0003 {
                            v.active = false;
                            v.stage = EnvStage::Off;
                            v.env = 0.0;
                            continue;
                        }
                    }
                    EnvStage::Off => continue,
                }

                let midi = (v.note as i32 + oct * 12).clamp(0, 127) as u8;
                let hz = util::midi_note_to_freq(midi);
                let mut osc_sum = 0.0;
                for (k, &cents_v) in cents.iter().enumerate() {
                    let dt = (hz * cents_ratio(cents_v) / sr).clamp(0.00001, 0.49);
                    osc_sum += osc(wave, v.phase[k], dt, pw, &mut self.noise);
                    v.phase[k] += dt;
                    if v.phase[k] >= 1.0 {
                        v.phase[k] -= 1.0;
                    }
                }
                osc_sum *= uni_scale;

                if earth && !matches!(wave, WaveKind::Noise) {
                    let sdt = (hz * 0.5 / sr).clamp(0.00001, 0.49);
                    osc_sum += (v.sub_phase * std::f32::consts::TAU).sin() * 0.24;
                    v.sub_phase += sdt;
                    if v.sub_phase >= 1.0 {
                        v.sub_phase -= 1.0;
                    }
                }

                if h > 0.015 && !matches!(wave, WaveKind::Noise) {
                    let gdt = (hz / sr).clamp(0.00001, 0.49) * 1.0064;
                    osc_sum += osc(wave, v.ghost_phase, gdt, pw, &mut self.noise) * h * 0.16;
                    v.ghost_phase += gdt;
                    if v.ghost_phase >= 1.0 {
                        v.ghost_phase -= 1.0;
                    }
                    let gdt2 = (hz / sr).clamp(0.00001, 0.49) * 2.003;
                    osc_sum += osc(wave, v.ghost_b, gdt2, pw, &mut self.noise) * h * 0.07;
                    v.ghost_b += gdt2;
                    if v.ghost_b >= 1.0 {
                        v.ghost_b -= 1.0;
                    }
                }

                let fcut = (cut * (1.0 - h * 0.18)).clamp(20.0, sr * 0.45);
                let nyq = sr * 0.45;
                let edge = ((fcut / 90.0).min((nyq - fcut) / 500.0)).clamp(0.25, 1.0);
                let q = (reso * (1.0 + h * 0.16) * edge).clamp(0.1, 18.0);
                v.filter.set_svf(fkind, fcut, q, sr);
                let filtered = v.filter.tick(osc_sum);
                let hit = if earth { 0.48 } else { 0.4 };
                mix += filtered * v.env * v.vel * hit;
            }

            if !mix.is_finite() {
                mix = 0.0;
            }

            if earth {
                self.root_body.set_peaking(92.0, 1.05, 4.4, sr);
                self.root_wood.set_peaking(218.0, 0.82, 3.3, sr);
                self.root_board.set_peaking(465.0, 0.7, 2.2, sr);
                self.root_hp.set_svf(FilterKind::Highpass, 28.0, 0.55, sr);
                mix = self.root_hp.tick(
                    self.root_board
                        .tick(self.root_wood.tick(self.root_body.tick(mix))),
                );
                mix = softsat(mix + 0.05, 1.3);
            }

            let makeup = 1.0 / (1.0 + h * 0.12 + t * 0.10 + a * 0.08);
            let after_vol = mix * vol * makeup;
            let dry = after_vol * (1.0 - h * 0.10) * (1.0 - t * 0.12);

            self.flutter_phase = (self.flutter_phase + 0.21 / sr) % 1.0;
            self.flutter2_phase = (self.flutter2_phase + 1.63 / sr) % 1.0;
            self.ring_phase = (self.ring_phase + (0.37 + h * 0.11) / sr) % 1.0;
            self.ring2_phase = (self.ring2_phase + (111.1 + h * 8.0) / sr) % 1.0;
            let wow = (self.flutter_phase * std::f32::consts::TAU).sin() * h * 0.0048;
            let flutter = (self.flutter2_phase * std::f32::consts::TAU).sin() * h * 0.0017;
            let haunt_delay = ((0.38 + h * 0.26) * (1.0 + wow + flutter) * sr).max(2.0);
            let haunt_delay_r = (haunt_delay * 1.073).max(2.0);
            self.delay_lp
                .set_svf(FilterKind::Lowpass, 1880.0 - h * 780.0, 0.68, sr);
            self.delay_lp2
                .set_svf(FilterKind::Lowpass, 1640.0 - h * 720.0, 0.7, sr);
            let delayed = self.delay_lp.tick(self.haunt.read(haunt_delay));
            let delayed_r = self.delay_lp2.tick(self.haunt2.read(haunt_delay_r));
            let haunt_in = after_vol * h * 0.36 + delayed * h * 0.56;
            let haunt_in_r = after_vol * h * 0.34 + delayed_r * h * 0.58;
            self.haunt
                .write(if haunt_in.is_finite() { haunt_in } else { 0.0 });
            self.haunt2
                .write(if haunt_in_r.is_finite() { haunt_in_r } else { 0.0 });
            let ring = (self.ring_phase * std::f32::consts::TAU).sin();
            let ring2 = (self.ring2_phase * std::f32::consts::TAU).sin();
            let whisper_n = randf(&mut self.noise);
            self.whisper_bp
                .set_svf(FilterKind::Bandpass, 2100.0, 1.15, sr);
            self.whisper_bp2
                .set_svf(FilterKind::Bandpass, 390.0, 0.9, sr);
            let whisper = self.whisper_bp.tick(whisper_n) * h * 0.038
                + self.whisper_bp2.tick(whisper_n) * h * 0.028;
            let haunt_l = delayed * h * 0.62 + after_vol * ring * h * 0.10 + after_vol * ring2 * h * 0.055 + whisper;
            let haunt_r = delayed_r * h * 0.62 + after_vol * ring * h * 0.08 + after_vol * ring2 * h * 0.062 + whisper * 0.86;

            self.tide_a = (self.tide_a + (0.11 + t * 0.07) / sr) % 1.0;
            self.tide_b = (self.tide_b + (0.173 + t * 0.09) / sr) % 1.0;
            self.tide_c = (self.tide_c + (0.241 + t * 0.055) / sr) % 1.0;
            self.tide_d = (self.tide_d + (0.083 + t * 0.12) / sr) % 1.0;
            let lp_cut = 14_000.0 * (2_150.0_f32 / 14_000.0).powf(t * 0.78);
            self.water_lp
                .set_svf(FilterKind::Lowpass, lp_cut, 0.52 + t * 0.28, sr);
            self.water_peak
                .set_peaking(225.0 + t * 55.0, 0.72, t * 2.35, sr);
            self.water_air
                .set_highshelf(5_400.0, t * 3.1, sr);
            let wet_in = after_vol * (0.52 + t * 0.38);
            let absorbed = self.water_air.tick(self.water_peak.tick(self.water_lp.tick(wet_in)));
            let sat = softsat(absorbed, 1.18 + t * 0.22);
            let d1 = ((0.0076 + t * 0.0038)
                + (self.tide_a * std::f32::consts::TAU).sin() * t * 0.0026)
                * sr;
            let d2 = ((0.0114 + t * 0.0046)
                + (self.tide_b * std::f32::consts::TAU).sin() * t * 0.0031)
                * sr;
            let d3 = ((0.0158 + t * 0.0042)
                + (self.tide_c * std::f32::consts::TAU).sin() * t * 0.0023)
                * sr;
            let d4 = ((0.0214 + t * 0.0055)
                + (self.tide_d * std::f32::consts::TAU).sin() * t * 0.0034)
                * sr;
            self.water1.write(sat);
            self.water2.write(sat);
            self.water3.write(sat);
            self.water4.write(sat);
            let chorus_l = self.water1.read(d1.max(2.0)) + self.water3.read(d3.max(2.0));
            let chorus_r = self.water2.read(d2.max(2.0)) + self.water4.read(d4.max(2.0));
            let room_d = ((0.082 + t * 0.048)
                + (self.tide_a * std::f32::consts::TAU).sin() * t * 0.007)
                * sr;
            let room_fb = self.water_room.read(room_d.max(2.0));
            self.water_room.write(sat * 0.62 + room_fb * t * 0.28);
            let room_l = room_fb;
            let room_r = self.water_room.read((room_d * 1.19).max(2.0));
            let water_l = (chorus_l * 0.36 + room_l * 0.44) * t;
            let water_r = (chorus_r * 0.36 + room_r * 0.44) * t;

            let mut earth_l = 0.0;
            let mut earth_r = 0.0;
            if earth {
                self.cave_lp.set_svf(FilterKind::Lowpass, 1180.0, 0.62, sr);
                let stone = self.cave_lp.tick(after_vol);
                self.cave1.write(stone);
                self.cave2.write(stone);
                earth_l = self.cave1.read((0.024 * sr).max(2.0)) * 0.22;
                earth_r = self.cave2.read((0.033 * sr).max(2.0)) * 0.22;
            }

            let bus_l = dry + haunt_l + water_l + earth_l;
            let bus_r = dry + haunt_r + water_r + earth_r;
            let crushed_l = self.aether_l.tick(bus_l, a, sr, &mut self.noise);
            let crushed_r = self.aether_r.tick(bus_r, a, sr, &mut self.noise);
            let out_l = self.limit_l.tick(crushed_l, sr).clamp(-1.0, 1.0);
            let out_r = self.limit_r.tick(crushed_r, sr).clamp(-1.0, 1.0);

            if !outputs.is_empty() {
                outputs[0][i] = out_l;
            }
            if outputs.len() > 1 {
                outputs[1][i] = out_r;
            }
            peak = peak.max(out_l.abs().max(out_r.abs()));
            if rec {
                rec_local.push((out_l + out_r) * 0.5);
            }
            if i & 7 == 0 {
                if let Ok(mut sc) = self.bus.scope.try_lock() {
                    let idx = self.bus.i.fetch_add(1, Ordering::Relaxed) % sc.len();
                    sc[idx] = mix.clamp(-1.0, 1.0);
                }
            }
        }

        let old = f32::from_bits(self.bus.rms.load(Ordering::Relaxed));
        let rms = (old * 0.88 + peak * 0.22).clamp(0.0, 1.0);
        self.bus.rms.store(rms.to_bits(), Ordering::Relaxed);
        self.bus.midi_t.fetch_add(len as u32, Ordering::Relaxed);
        if rec {
            if let Ok(mut buf) = self.bus.clip.try_lock() {
                let max_sec = self.bus.clip_max_sec.load(Ordering::Relaxed).max(30) as f32;
                let max = (max_sec * sr) as usize;
                let room = max.saturating_sub(buf.len());
                if room == 0 {
                    self.bus.clip_on.store(false, Ordering::Relaxed);
                    self.bus.clip_full.store(true, Ordering::Relaxed);
                } else {
                    let n = rec_local.len().min(room);
                    buf.extend_from_slice(&rec_local[..n]);
                    if buf.len() >= max {
                        self.bus.clip_on.store(false, Ordering::Relaxed);
                        self.bus.clip_full.store(true, Ordering::Relaxed);
                    }
                }
            }
        }
        if let Ok(mut held) = self.bus.held.try_lock() {
            *held = [false; 128];
            for v in &self.voices {
                if v.active && (v.note as usize) < 128 {
                    held[v.note as usize] = true;
                }
            }
        }

        ProcessStatus::Normal
    }
}

impl ClapPlugin for SkyForge {
    const CLAP_ID: &'static str = "com.johnnyskyride.skyforge";
    const CLAP_DESCRIPTION: Option<&'static str> = Some("Analog instrument by @johnnyskyride");
    const CLAP_MANUAL_URL: Option<&'static str> = Some(Self::URL);
    const CLAP_SUPPORT_URL: Option<&'static str> = Some(Self::URL);
    const CLAP_FEATURES: &'static [ClapFeature] = &[
        ClapFeature::Instrument,
        ClapFeature::Synthesizer,
        ClapFeature::Stereo,
    ];
}

impl Vst3Plugin for SkyForge {
    const VST3_CLASS_ID: [u8; 16] = *b"SkyForge.SF-33!!";
    const VST3_SUBCATEGORIES: &'static [Vst3SubCategory] = &[
        Vst3SubCategory::Instrument,
        Vst3SubCategory::Synth,
        Vst3SubCategory::Stereo,
    ];
}

nih_export_clap!(SkyForge);
nih_export_vst3!(SkyForge);

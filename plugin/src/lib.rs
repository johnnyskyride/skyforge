use nih_plug::prelude::*;
use std::sync::Arc;

const MAX_VOICES: usize = 8;
const HAUNT_SECS: f32 = 0.55;
const WATER_SECS: f32 = 0.16;

#[derive(Enum, PartialEq, Clone, Copy)]
enum WaveKind {
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
enum FilterKind {
    #[id = "lp"]
    Lowpass,
    #[id = "hp"]
    Highpass,
    #[id = "bp"]
    Bandpass,
}

#[derive(Enum, PartialEq, Clone, Copy)]
enum Kind {
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

#[derive(Params)]
struct SkyForgeParams {
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
            volume: FloatParam::new("Volume", 0.72, FloatRange::Linear { min: 0.0, max: 1.0 })
                .with_smoother(SmoothingStyle::Linear(20.0)),
            halloween: FloatParam::new("Halloween", 0.0, FloatRange::Linear { min: 0.0, max: 1.0 })
                .with_smoother(SmoothingStyle::Linear(50.0)),
            waters: FloatParam::new("Waters", 0.0, FloatRange::Linear { min: 0.0, max: 1.0 })
                .with_smoother(SmoothingStyle::Linear(50.0)),
            aether: FloatParam::new("Aether", 0.0, FloatRange::Linear { min: 0.0, max: 1.0 })
                .with_smoother(SmoothingStyle::Linear(50.0)),
        }
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
            cutoff: 360.0,
            reso: 1.3,
            attack: 0.16,
            decay: 0.48,
            sustain: 0.88,
            release: 1.15,
            octave: -1,
            unison: 2,
            waters: 0.16,
            halloween: 0.0,
            aether: 0.0,
        },
        Kind::Water => Shape {
            wave: WaveKind::Sine,
            filter: FilterKind::Bandpass,
            cutoff: 680.0,
            reso: 2.6,
            attack: 0.24,
            decay: 0.42,
            sustain: 0.84,
            release: 0.9,
            octave: 0,
            unison: 2,
            waters: 0.64,
            halloween: 0.0,
            aether: 0.0,
        },
        Kind::Fire => Shape {
            wave: WaveKind::Saw,
            filter: FilterKind::Lowpass,
            cutoff: 3400.0,
            reso: 5.4,
            attack: 0.002,
            decay: 0.15,
            sustain: 0.3,
            release: 0.09,
            octave: 0,
            unison: 1,
            waters: 0.0,
            halloween: 0.32,
            aether: 0.0,
        },
        Kind::Wind => Shape {
            wave: WaveKind::Triangle,
            filter: FilterKind::Highpass,
            cutoff: 1500.0,
            reso: 1.7,
            attack: 0.045,
            decay: 0.2,
            sustain: 0.55,
            release: 0.42,
            octave: 1,
            unison: 3,
            waters: 0.1,
            halloween: 0.0,
            aether: 0.16,
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
    phase: f32,
    env: f32,
}

impl Aether {
    fn tick(&mut self, x: f32, amt: f32) -> f32 {
        if !(amt.is_finite()) || amt < 0.008 {
            return if x.is_finite() { x } else { 0.0 };
        }
        let bits = 8.4 - amt * 5.1;
        let levels = 2.0f32.powf(bits - 1.0).max(2.0);
        let hold_n = 1.0 + amt * amt * 26.0;
        self.phase += 1.0;
        if self.phase >= hold_n {
            self.phase = 0.0;
            self.held = (x * levels).round() / levels;
            if !self.held.is_finite() {
                self.held = 0.0;
            }
        }
        let thresh = 0.01 + amt * 0.04;
        if x.abs() > thresh {
            self.env += (1.0 - self.env) * 0.28;
        } else {
            self.env += (0.0 - self.env) * (0.045 + amt * 0.08);
        }
        if !self.env.is_finite() {
            self.env = 0.0;
        }
        let gate = 0.28 + 0.72 * self.env.clamp(0.0, 1.0);
        let fold_n = 3.0 + amt * 5.0;
        let fold = self.held - (self.held * fold_n).round() / fold_n;
        let y = self.held * gate + if fold.is_finite() { fold * amt * 0.32 } else { 0.0 };
        if y.is_finite() {
            y.clamp(-1.2, 1.2)
        } else {
            0.0
        }
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
        let thr = 0.398; // -8 dB
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

fn cents_ratio(cents: f32) -> f32 {
    2.0f32.powf(cents / 1200.0)
}

struct SkyForge {
    params: Arc<SkyForgeParams>,
    voices: [Voice; MAX_VOICES],
    sr: f32,
    age: u64,
    noise: u32,
    haunt: DelayLine,
    water1: DelayLine,
    water2: DelayLine,
    water_lp: Biquad,
    water_peak: Biquad,
    delay_lp: Biquad,
    whisper_bp: Biquad,
    aether: Aether,
    limit: Limit,
    flutter_phase: f32,
    ring_phase: f32,
    tide_a: f32,
    tide_b: f32,
}

impl Default for SkyForge {
    fn default() -> Self {
        Self {
            params: Arc::new(SkyForgeParams::default()),
            voices: std::array::from_fn(|_| Voice::new()),
            sr: 44_100.0,
            age: 0,
            noise: 0xA341316C,
            haunt: DelayLine::new(64),
            water1: DelayLine::new(64),
            water2: DelayLine::new(64),
            water_lp: Biquad::silent(),
            water_peak: Biquad::silent(),
            delay_lp: Biquad::silent(),
            whisper_bp: Biquad::silent(),
            aether: Aether {
                held: 0.0,
                phase: 0.0,
                env: 0.0,
            },
            limit: Limit { env: 0.0 },
            flutter_phase: 0.0,
            ring_phase: 0.0,
            tide_a: 0.0,
            tide_b: 0.0,
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
        v.env = 0.0001;
        v.stage = EnvStage::Attack;
        v.age = self.age;
        v.filter = Biquad::silent();
        self.age += 1;
    }

    fn note_off(&mut self, note: u8) {
        for v in self.voices.iter_mut() {
            if v.active && v.note == note && !matches!(v.stage, EnvStage::Release | EnvStage::Off) {
                v.stage = EnvStage::Release;
            }
        }
    }

    fn panic(&mut self) {
        for v in self.voices.iter_mut() {
            *v = Voice::new();
        }
        self.haunt.clear();
        self.water1.clear();
        self.water2.clear();
        self.aether = Aether {
            held: 0.0,
            phase: 0.0,
            env: 0.0,
        };
        self.limit.env = 0.0;
    }

    fn alloc_delays(&mut self, sr: f32) {
        self.haunt.resize((HAUNT_SECS * sr) as usize + 16);
        self.water1.resize((WATER_SECS * sr) as usize + 16);
        self.water2.resize((WATER_SECS * sr) as usize + 16);
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

    const MIDI_INPUT: MidiConfig = MidiConfig::Basic;
    const SAMPLE_ACCURATE_AUTOMATION: bool = true;

    type SysExMessage = ();
    type BackgroundTask = ();

    fn params(&self) -> Arc<dyn Params> {
        self.params.clone()
    }

    fn initialize(
        &mut self,
        _audio_io_layout: &AudioIOLayout,
        buffer_config: &BufferConfig,
        _context: &mut impl InitContext<Self>,
    ) -> bool {
        self.sr = buffer_config.sample_rate;
        self.alloc_delays(self.sr);
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

        for i in 0..len {
            while let Some(event) = next_event {
                if event.timing() as usize > i {
                    break;
                }
                match event {
                    NoteEvent::NoteOn { note, velocity, .. } => self.note_on(note, velocity),
                    NoteEvent::NoteOff { note, .. } => self.note_off(note),
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
                        let r = rel + h * 0.45;
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

                if h > 0.02 && !matches!(wave, WaveKind::Noise) {
                    let gdt = (hz / sr).clamp(0.00001, 0.49) * 1.503;
                    osc_sum += osc(wave, v.ghost_phase, gdt, pw, &mut self.noise) * h * 0.28;
                    v.ghost_phase += gdt;
                    if v.ghost_phase >= 1.0 {
                        v.ghost_phase -= 1.0;
                    }
                }

                let fcut = (cut * (1.0 - h * 0.16)).clamp(20.0, sr * 0.45);
                let nyq = sr * 0.45;
                let edge = ((fcut / 90.0).min((nyq - fcut) / 500.0)).clamp(0.25, 1.0);
                let q = (reso * (1.0 + h * 0.22) * edge).clamp(0.1, 18.0);
                v.filter.set_svf(fkind, fcut, q, sr);
                let filtered = v.filter.tick(osc_sum);
                mix += filtered * v.env * v.vel * 0.22;
            }

            if !mix.is_finite() {
                mix = 0.0;
            }

            let makeup = 1.0 / (1.0 + h * 0.5 + t * 0.82 + a * 0.22);
            let after_vol = mix * vol * makeup;
            let dry = after_vol * (1.0 - h * 0.2) * (1.0 - t * 0.7);

            self.flutter_phase = (self.flutter_phase + 0.19 / sr) % 1.0;
            self.ring_phase = (self.ring_phase + (36.0 + h * 22.0) / sr) % 1.0;
            let flutter = (self.flutter_phase * std::f32::consts::TAU).sin() * h * 0.012;
            let haunt_delay = ((0.26 + h * 0.22) * (1.0 + flutter) * sr).max(2.0);
            self.delay_lp
                .set_svf(FilterKind::Lowpass, 2400.0 - h * 1000.0, 0.7, sr);
            let delayed = self.haunt.read(haunt_delay);
            let delayed_lp = self.delay_lp.tick(delayed);
            let haunt_in = after_vol * h * 0.46 + delayed_lp * h * 0.42;
            self.haunt.write(if haunt_in.is_finite() { haunt_in } else { 0.0 });
            let ring = (self.ring_phase * std::f32::consts::TAU).sin();
            let whisper_n = {
                self.noise = self.noise.wrapping_mul(1664525).wrapping_add(1013904223);
                (self.noise as i32 as f32) * (1.0 / 2_147_483_648.0)
            };
            self.whisper_bp
                .set_svf(FilterKind::Bandpass, 1700.0, 1.4, sr);
            let whisper = self.whisper_bp.tick(whisper_n) * h * 0.07;
            let haunt_out = delayed_lp * h * 0.55 + after_vol * ring * h * 0.32 + whisper;

            self.tide_a = (self.tide_a + (0.09 + t * 0.2) / sr) % 1.0;
            self.tide_b = (self.tide_b + (0.057 + t * 0.14) / sr) % 1.0;
            let lp_cut = 11_000.0 * (380.0_f32 / 11_000.0).powf(t * t);
            self.water_lp
                .set_svf(FilterKind::Lowpass, lp_cut, 0.5 + t * 0.45, sr);
            self.water_peak
                .set_peaking(210.0 + t * 90.0, 0.85, t * 6.4, sr);
            let wet_in = after_vol * t * 0.7;
            let absorbed = self.water_peak.tick(self.water_lp.tick(wet_in));
            let sat = absorbed.tanh();
            let d1 = ((0.011 + t * 0.018)
                + (self.tide_a * std::f32::consts::TAU).sin() * t * 0.0045)
                * sr;
            let d2 = ((0.024 + t * 0.022)
                + (self.tide_b * std::f32::consts::TAU).sin() * t * 0.0055)
                * sr;
            self.water1.write(sat);
            self.water2.write(sat);
            let water_out = self.water1.read(d1.max(2.0)) + self.water2.read(d2.max(2.0));

            let bus = dry + haunt_out + water_out;
            let crushed = self.aether.tick(bus, a);
            let out = self.limit.tick(crushed, sr).clamp(-1.0, 1.0);

            if !outputs.is_empty() {
                outputs[0][i] = out;
            }
            if outputs.len() > 1 {
                outputs[1][i] = out;
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

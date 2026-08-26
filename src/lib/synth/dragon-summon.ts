const BARS = 28;
const SPINE = 110;

export type Pt = { x: number; y: number };
export type DragonElement = "EARTH" | "WATER" | "FIRE" | "WIND";

export type DragonDNA = {
  bass: number;
  mid: number;
  air: number;
  peaky: number;
  noise: number;
  crest: number;
  coils: number;
  horns: number;
  spines: number;
  wing: number;
  thick: number;
  lean: number;
  seed: number;
  peaks: number[];
  hop: number;
  beatHz: number;
  flux: number;
  intensity: number;
  register: number;
  bpm: number;
  voice: number;
  voiceName: string;
  contour: number;
  element: DragonElement;
  amp: Float32Array;
  onsets: Float32Array;
  epithet: string;
  ink: string;
  ink2: string;
};

function goertzel(buf: Float32Array, freq: number, sr: number): number {
  const n = buf.length;
  const w = (2 * Math.PI * freq) / sr;
  const c = 2 * Math.cos(w);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    s0 = (buf[i] ?? 0) + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const real = s1 - s2 * Math.cos(w);
  const imag = s2 * Math.sin(w);
  return Math.sqrt(real * real + imag * imag) / n;
}

function windowAt(samples: Float32Array, sr: number, t: number, n = 2048): Float32Array {
  const start = Math.max(0, Math.min(samples.length - n, Math.floor(t * sr)));
  return samples.subarray(start, start + Math.min(n, samples.length - start));
}

const HOP = 512;

function rmsHop(samples: Float32Array, hop = HOP): Float32Array {
  const n = Math.max(1, Math.floor(samples.length / hop));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    const start = i * hop;
    for (let j = 0; j < hop; j++) {
      const s = samples[start + j] ?? 0;
      acc += s * s;
    }
    out[i] = Math.sqrt(acc / hop);
  }
  let peak = 0.0001;
  for (const v of out) if (v > peak) peak = v;
  for (let i = 0; i < n; i++) out[i] /= peak;
  return out;
}

function onsetHop(rms: Float32Array): Float32Array {
  const o = new Float32Array(rms.length);
  for (let i = 1; i < rms.length; i++) o[i] = Math.max(0, (rms[i] ?? 0) - (rms[i - 1] ?? 0));
  let peak = 0.0001;
  for (const v of o) if (v > peak) peak = v;
  for (let i = 0; i < o.length; i++) o[i] /= peak;
  return o;
}

function estimateBeatHz(onsets: Float32Array, hop: number, sr: number): number {
  const minLag = Math.max(2, Math.round(((60 / 176) * sr) / hop));
  const maxLag = Math.min(onsets.length >> 1, Math.round(((60 / 55) * sr) / hop));
  let bestLag = minLag;
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0;
    for (let i = 0; i < onsets.length - lag; i++) c += (onsets[i] ?? 0) * (onsets[i + lag] ?? 0);
    const bpm = (60 * sr) / (lag * hop);
    const score = c * (0.82 + 0.18 * (1 - Math.abs(bpm - 108) / 130));
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  const hz = sr / (bestLag * hop);
  if (!Number.isFinite(hz) || hz < 0.7 || hz > 3.6) return 1.55;
  return hz;
}

function sampleHop(series: Float32Array, time: number, hop: number, sr: number): number {
  if (!series.length) return 0;
  const i = (time * sr) / hop;
  const i0 = Math.max(0, Math.min(series.length - 1, Math.floor(i)));
  const i1 = Math.max(0, Math.min(series.length - 1, i0 + 1));
  const f = i - Math.floor(i);
  return (series[i0] ?? 0) * (1 - f) + (series[i1] ?? 0) * f;
}

function centroidAt(samples: Float32Array, sr: number, t: number): number {
  const buf = windowAt(samples, sr, t, 2048);
  if (buf.length < 64) return 400;
  let sum = 0;
  let wsum = 0;
  for (let i = 0; i < 24; i++) {
    const hz = 40 * Math.pow(8000 / 40, i / 23);
    const v = goertzel(buf, hz, sr);
    sum += v;
    wsum += v * hz;
  }
  return wsum / (sum || 1);
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => {
    const va = (pa >> shift) & 255;
    const vb = (pb >> shift) & 255;
    return Math.round(va + (vb - va) * t);
  };
  const r = ch(16);
  const g = ch(8);
  const bl = ch(0);
  return `#${((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1)}`;
}

const NAME_A: Record<"COMMON" | DragonElement, string[]> = {
  COMMON: [
    "FORGE", "NIGHT", "COIL", "THRONE", "IRON", "SKY", "ASH", "PEARL", "VEIL", "DUSK",
    "DAWN", "SIGIL", "RUNIC", "HOLLOW", "LANTERN", "HARVEST", "WYRD", "NORN", "ASK",
    "MARCH", "WATCH", "CROWN", "GATE", "BELL", "CHOIR", "RIDER", "SKALD", "THANE",
    "THIRTY", "NORD", "LIND", "ORM", "HALLOW", "WRAITH", "HORIZON", "VAULT",
  ],
  EARTH: [
    "STONE", "ROOT", "BARROW", "MOSS", "ANVIL", "GRAVE", "CLAY", "BONE", "OAK", "RIDGE",
    "LOAM", "BASALT", "MARL", "GRANITE", "MOUND", "KEEP", "HEARTH", "IRONBOUND",
  ],
  WATER: [
    "GULF", "TIDE", "WATERS", "BRINE", "FOAM", "SALT", "RAIN", "MIST", "DEEP", "WELL",
    "CURRENT", "FROST", "REEF", "FATHOM", "SOUND", "SILT", "UNDERTAKING", "BLACKWATER",
  ],
  FIRE: [
    "CINDER", "EMBER", "PYRE", "BRAND", "SPARK", "AMBER", "VEIN", "ASHEN", "BLADE",
    "TOWER", "SPIRE", "BRANDWOLD", "PYREHILL", "CINDERWELL", "WILDFIRE", "KINDLE",
  ],
  WIND: [
    "GALE", "ZEPHYR", "BORA", "MISTRAL", "CIRRUS", "AETHER", "SQUALL", "TRUMPET",
    "SKYRIDE", "FJORD", "CHINOOK", "HIGH", "ROOST", "VANE", "WHITE", "LONGSKY",
  ],
};

const NAME_B: Record<"COMMON" | DragonElement, string[]> = {
  COMMON: [
    "WYRM", "WURM", "DRAKE", "LINDWORM", "SERPENT", "HORN", "WING", "COIL", "FANG",
    "SCALE", "CREST", "CROWN", "GATE", "ORMR", "NADDER", "SIGIL", "VEIL", "WATCH",
    "MARCH", "RIDER", "SKALD", "BELL", "CHOIR", "VAULT",
  ],
  EARTH: ["KEEP", "MOUND", "TUSK", "BULL", "BARROW", "HILL", "HEARTH", "LOAM", "ANVIL"],
  WATER: ["WELL", "REEF", "FATHOM", "FORD", "SOUND", "CURRENT", "BRINE", "TIDE"],
  FIRE: ["PYRE", "BRAND", "SPARK", "SPIRE", "BLADE", "LANTERN", "CINDER"],
  WIND: ["STORM", "SQUALL", "ROOST", "GALE", "AETHER", "HORIZON", "WING"],
};

const NAME_MID: Record<DragonElement, string[]> = {
  EARTH: ["BOUND", "DEEP", "OLD", "IRON"],
  WATER: ["STILL", "WILD", "BLACK", "SALT"],
  FIRE: ["HIGH", "PALE", "WILD", "ASH"],
  WIND: ["LONG", "PALE", "HIGH", "FAR"],
};

const ELEMENT_INK: Record<DragonElement, { ink: string; ink2: string }> = {
  EARTH: { ink: "#12e08a", ink2: "#d8ffe9" },
  WATER: { ink: "#3ec8c4", ink2: "#d4f4f0" },
  FIRE: { ink: "#e07038", ink2: "#f0dcc8" },
  WIND: { ink: "#8ec8f0", ink2: "#e8f2fa" },
};

export function idleDragon(): DragonDNA {
  return {
    bass: 0.28,
    mid: 0.34,
    air: 0.12,
    peaky: 0.08,
    noise: 0.04,
    crest: 0.16,
    coils: 1,
    horns: 2,
    spines: 4,
    wing: 0.48,
    thick: 0.42,
    lean: 0.06,
    seed: 33,
    peaks: [],
    hop: 512,
    beatHz: 0.11,
    flux: 0,
    intensity: 0.06,
    register: 0,
    bpm: 64,
    voice: 0.1,
    voiceName: "PEARL",
    contour: 0.04,
    element: "EARTH",
    amp: new Float32Array(8),
    onsets: new Float32Array(8),
    epithet: "",
    ink: "#8d8796",
    ink2: "#c9c3d0",
  };
}

function pickName(rng: () => number, list: string[]): string {
  return list[Math.floor(rng() * list.length)] ?? "WYRM";
}

function epithet(d: Omit<DragonDNA, "epithet" | "ink" | "ink2">): string {
  const rng = mulberry(d.seed);
  const a = [...NAME_A.COMMON, ...NAME_A[d.element]];
  const b = [...NAME_B.COMMON, ...NAME_B[d.element]];
  if (rng() > 0.78) {
    return `${pickName(rng, a)} ${pickName(rng, NAME_MID[d.element])} ${pickName(rng, b)}`;
  }
  return `${pickName(rng, a)} ${pickName(rng, b)}`;
}

function pickElement(d: {
  bass: number;
  mid: number;
  air: number;
  intensity: number;
  crest: number;
  spread: number;
  center: number;
}): DragonElement {
  const punch = Math.min(
    1,
    Math.max(0, d.crest * 0.42 + d.intensity * 0.18 + Math.min(1, d.spread * 2.2) * 0.14),
  );
  const brightness = Math.max(
    0,
    Math.min(1, Math.log((d.center + 40) / 180) / Math.log(4200 / 180)),
  );
  const tot = d.bass + d.mid + d.air + 0.0001;
  const low = d.bass / tot;
  const high = d.air / tot;

  if (punch >= 0.64) return "FIRE";
  if (brightness <= 0.26 || low > high + 0.2) return "EARTH";
  if (brightness >= 0.5 || high > low + 0.06) return "WIND";
  return "WATER";
}

export function summonDragon(samples: Float32Array, sr: number, force?: DragonElement): DragonDNA {
  const times = [0.12, 0.38, 0.62, 0.88].map((t) => t * (samples.length / sr));
  const nBands = 40;
  const spec = new Float32Array(nBands);
  for (const t of times) {
    const buf = windowAt(samples, sr, t, 2048);
    if (buf.length < 64) continue;
    for (let i = 0; i < nBands; i++) {
      const hz = 40 * Math.pow(9000 / 40, i / (nBands - 1));
      spec[i] += goertzel(buf, hz, sr);
    }
  }
  let peak = 0.00001;
  for (let i = 0; i < nBands; i++) {
    const v = spec[i] ?? 0;
    if (v > peak) peak = v;
  }
  for (let i = 0; i < nBands; i++) spec[i] = (spec[i] ?? 0) / peak;

  const band = (lo: number, hi: number) => {
    let acc = 0;
    let n = 0;
    for (let i = 0; i < nBands; i++) {
      const hz = 40 * Math.pow(9000 / 40, i / (nBands - 1));
      if (hz >= lo && hz < hi) {
        acc += spec[i] ?? 0;
        n++;
      }
    }
    return n ? acc / n : 0;
  };

  const bass = band(40, 180);
  const mid = band(180, 1600);
  const air = band(1600, 9000);
  let peaky = 0;
  for (let i = 1; i < nBands - 1; i++) {
    const v = spec[i] ?? 0;
    if (v > 0.55 && v > (spec[i - 1] ?? 0) && v > (spec[i + 1] ?? 0)) peaky += v;
  }
  peaky = Math.min(1, peaky / 2.4);

  let odd = 0;
  let even = 0;
  for (let i = 0; i < nBands; i++) {
    if (i % 2) odd += spec[i] ?? 0;
    else even += spec[i] ?? 0;
  }
  const noise = odd / (odd + even + 0.0001);

  let rms = 0;
  let mx = 0.0001;
  const step = Math.max(1, Math.floor(samples.length / 4000));
  let count = 0;
  for (let i = 0; i < samples.length; i += step) {
    const s = Math.abs(samples[i] ?? 0);
    rms += s * s;
    if (s > mx) mx = s;
    count++;
  }
  rms = Math.sqrt(rms / Math.max(1, count));
  const crest = Math.min(1, mx / (rms * 4 + 0.0001));

  const peaks: number[] = [];
  for (let i = 2; i < nBands - 2; i++) {
    const v = spec[i] ?? 0;
    if (v > 0.42 && v >= (spec[i - 1] ?? 0) && v >= (spec[i + 1] ?? 0)) {
      peaks.push(40 * Math.pow(9000 / 40, i / (nBands - 1)));
    }
  }
  if (peaks.length === 0) peaks.push(220, 880);

  let seed = 2166136261;
  for (let i = 0; i < nBands; i++) {
    seed = Math.imul(seed ^ Math.round((spec[i] ?? 0) * 9973), 16777619);
  }
  seed = seed >>> 0;

  const amp = rmsHop(samples, HOP);
  const onsets = onsetHop(amp);
  const beatHz = estimateBeatHz(onsets, HOP, sr);
  let flux = 0;
  for (const v of onsets) flux += v;
  flux = Math.min(1, flux / Math.max(8, onsets.length * 0.12));

  let mean = 0;
  for (const v of amp) mean += v;
  mean /= amp.length || 1;
  let spread = 0;
  for (const v of amp) spread += (v - mean) * (v - mean);
  spread = Math.sqrt(spread / (amp.length || 1));
  const dur = Math.max(0.5, samples.length / sr);
  let hits = 0;
  for (const v of onsets) if (v > 0.42) hits++;
  const hitsPerSec = hits / dur;
  const intensity = Math.min(
    1,
    Math.max(
      0,
      crest * 0.3 +
        Math.min(1, spread * 2.6) * 0.3 +
        flux * 0.16 +
        Math.min(1, hitsPerSec / 5.5) * 0.14 +
        air * 0.1,
    ),
  );

  const register = Math.max(-1, Math.min(1, (air - bass) / (air + bass + 0.08)));
  const bpm = Math.round(beatHz * 60);
  const voice = Math.min(1, peaky * 0.5 + noise * 0.28 + crest * 0.22);
  const voiceName =
    noise > 0.5 ? "GRAIN" : peaky > 0.5 ? "BLADE" : bass > air + 0.08 ? "TIDE" : "PEARL";
  const c0 = centroidAt(samples, sr, dur * 0.12);
  const c1 = centroidAt(samples, sr, dur * 0.86);
  const contour = Math.max(-1, Math.min(1, (Math.log(c1 + 1) - Math.log(c0 + 1)) / 1.8));

  const coils = intensity < 0.3 ? 1 : intensity < 0.58 ? 2 : 2 + Math.round(voice);
  const center = (c0 + c1) / 2;
  const element = force ?? pickElement({
    bass,
    mid,
    air,
    intensity,
    crest,
    spread,
    center,
  });
  const horns = 1 + Math.round((Math.max(0, register) * 2 + voice) * (0.4 + intensity * 0.7) + (element === "WIND" ? 0.6 : 0));
  const spines = 3 + Math.round(voice * 8 + intensity * 5 + (element === "FIRE" ? 3 : 0));
  const wing =
    0.5 +
    (element === "WIND" ? 0.42 : element === "EARTH" ? 0.08 : 0.22) +
    Math.max(0, register) * 0.2;
  const thick = Math.min(1, 0.22 + Math.max(0, -register) * 0.55 + bass * 0.25 + (element === "EARTH" ? 0.18 : 0));
  const lean = ((seed % 1000) / 1000) * 2 - 1 + contour * 0.25;

  const base = {
    bass,
    mid,
    air,
    peaky,
    noise,
    crest,
    coils: Math.min(4, coils),
    horns: Math.min(5, Math.max(1, horns)),
    spines: Math.min(18, spines),
    wing,
    thick,
    lean,
    seed,
    peaks: peaks.slice(0, 6),
    hop: HOP,
    beatHz,
    flux,
    intensity,
    register,
    bpm,
    voice,
    voiceName,
    contour,
    element,
    amp,
    onsets,
  };

  const tone = ELEMENT_INK[element];
  return { ...base, epithet: epithet(base), ink: tone.ink, ink2: tone.ink2 };
}

export function envelope(samples: Float32Array, points: number): Float32Array {
  const out = new Float32Array(points);
  const win = Math.max(1, Math.floor(samples.length / points));
  let peak = 0.0001;
  for (let i = 0; i < points; i++) {
    let acc = 0;
    const start = i * win;
    for (let j = 0; j < win; j++) {
      const s = samples[start + j] ?? 0;
      acc += s * s;
    }
    const rms = Math.sqrt(acc / win);
    out[i] = rms;
    if (rms > peak) peak = rms;
  }
  for (let i = 0; i < points; i++) out[i] /= peak;
  return out;
}

export function bandsAt(samples: Float32Array, sr: number, at: number): number[] {
  const buf = windowAt(samples, sr, at, 1024);
  if (buf.length < 32) return Array.from({ length: BARS }, () => 0);
  const out: number[] = [];
  for (let i = 0; i < BARS; i++) {
    const hz = 55 * Math.pow(8000 / 55, i / (BARS - 1));
    out.push(goertzel(buf, hz, sr));
  }
  let peak = 0.00001;
  for (const v of out) if (v > peak) peak = v;
  return out.map((v) => Math.min(1, (v / peak) * 1.55));
}

function liveWave(samples: Float32Array, sr: number, at: number, points: number): Float32Array {
  const n = Math.max(32, Math.floor(sr * 0.04));
  const start = Math.max(0, Math.min(samples.length - n, Math.floor(at * sr)));
  const out = new Float32Array(points);
  const step = n / points;
  for (let i = 0; i < points; i++) out[i] = samples[start + Math.floor(i * step)] ?? 0;
  return out;
}

function spinePoint(
  i: number,
  dna: DragonDNA,
  env: Float32Array,
  live: Float32Array,
  w: number,
  h: number,
  nowAmp: number,
  travel: number,
  stillness: number,
  glance: number,
  size = 1,
): Pt {
  const n = SPINE;
  const t = i / (n - 1);
  const x0 = 64;
  const x1 = w - 48;
  const coil = Math.max(1, dna.coils);
  const motion = Math.max(0, 1 - stillness);
  const drive = (0.08 + dna.intensity * 0.7) * motion;
  const wave = travel * drive;
  const s = size;
  const ampW = (7 + dna.intensity * 56 * motion) * (0.4 + 0.6 * motion) * s;
  const wander =
    Math.sin(t * Math.PI * coil - wave) * ampW +
    Math.sin(t * Math.PI * coil * 1.65 - wave * 0.32) * (5 + dna.intensity * 24) * dna.intensity * motion * s +
    Math.sin(t * Math.PI * 0.5 + dna.lean) * dna.lean * (6 + dna.intensity * 12) * (0.35 + 0.65 * motion) * s;
  const lunge = Math.sin(wave) * (2 + nowAmp * 16 * dna.intensity) * t * dna.intensity * motion * s;
  const look = glance * Math.sin(travel * 0.22) * 12 * Math.pow(t, 2.55) * s;
  const nod = glance * Math.sin(travel * 0.13 + 0.6) * 7 * Math.pow(t, 2.7) * s;
  const x = x0 + t * (x1 - x0) + lunge + look;
  const lift = ((env[i] ?? 0) * 0.45 + nowAmp * 0.3) * (10 + dna.intensity * 32) * motion * s;
  const gallop = Math.sin(t * Math.PI * 2 - wave * 2) * nowAmp * 18 * dna.intensity * dna.intensity * motion * s;
  const shimmer = (live[i] ?? 0) * (3 + dna.intensity * 14) * motion * s;
  const climb = dna.contour * 22 * t * (0.4 + 0.6 * motion) * s;
  const y = h * 0.5 + wander - lift + shimmer + gallop - climb + nod;
  return { x, y };
}

function normalAt(pts: Pt[], i: number): { nx: number; ny: number; tx: number; ty: number } {
  const a = pts[Math.max(0, i - 3)]!;
  const b = pts[Math.min(pts.length - 1, i + 3)]!;
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  return { nx: -dy, ny: dx, tx: dx, ty: dy };
}

function strokePoly(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  if (!pts.length) return;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
}

function smoothPath(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  if (pts.length < 3) {
    strokePoly(ctx, pts);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length - 1; i++) {
    const n = pts[i]!;
    const nx = pts[i + 1]!;
    ctx.quadraticCurveTo(n.x, n.y, (n.x + nx.x) * 0.5, (n.y + nx.y) * 0.5);
  }
  const last = pts[pts.length - 1]!;
  ctx.lineTo(last.x, last.y);
}

function taperAt(t: number, dna: DragonDNA): number {
  const tail = Math.min(1, t / 0.1);
  const belly = t < 0.42 ? 0.45 + (t / 0.42) * 0.55 : t < 0.76 ? 1 - (t - 0.42) * 0.5 : 0.55 * (1 - (t - 0.76) / 0.24) + 0.12;
  return (0.22 + dna.thick * 0.78) * Math.max(0.1, tail * belly);
}

function bodyHalves(pts: Pt[], dna: DragonDNA, scale: number): { up: Pt[]; dn: Pt[] } {
  const up: Pt[] = [];
  const dn: Pt[] = [];
  const base = (11 + dna.thick * 20) * scale;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const n = normalAt(pts, i);
    const t = i / (pts.length - 1);
    const w = base * taperAt(t, dna);
    let nx = n.nx;
    let ny = n.ny;
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    up.push({ x: p.x + nx * w, y: p.y + ny * w });
    dn.push({ x: p.x - nx * w * 0.82, y: p.y - ny * w * 0.82 });
  }
  return { up, dn };
}

function drawWing(
  ctx: CanvasRenderingContext2D,
  root: Pt,
  flap: number,
  scale: number,
  dna: DragonDNA,
  behind: boolean,
) {
  const span = (72 + dna.wing * 96 + Math.max(0, dna.register) * 40) * scale;
  const lift = (38 + Math.max(0, dna.register) * 46 + dna.air * 22) * (0.32 + 0.68 * flap);
  const fold = (1 - flap) * 16 * scale;
  const tipX = root.x - span * 0.94;
  const tipY = root.y - lift * 0.18 + fold * 0.4;
  const leadX = root.x - span * 0.34;
  const leadY = root.y - lift;
  const wristX = root.x - span * 0.62;
  const wristY = root.y - lift * 0.62 + fold;
  const trailX = root.x - span * 0.18;
  const trailY = root.y + 11 * scale + fold * 0.2;

  ctx.fillStyle = behind ? `${dna.ink}1c` : `${dna.ink}32`;
  ctx.strokeStyle = behind ? `${dna.ink2}aa` : dna.ink2;
  ctx.lineWidth = behind ? 1.25 : 1.9;
  ctx.beginPath();
  ctx.moveTo(root.x, root.y);
  ctx.quadraticCurveTo(leadX, leadY, wristX, wristY);
  ctx.quadraticCurveTo((wristX + tipX) * 0.5, wristY - 10 * scale * flap, tipX, tipY);
  const scallops = 4;
  for (let i = 1; i <= scallops; i++) {
    const u = i / scallops;
    const sx = tipX + (trailX - tipX) * u;
    const sy = tipY + (trailY - tipY) * u;
    const dip = Math.sin(u * Math.PI) * (10 + flap * 7) * scale;
    const mx = tipX + (trailX - tipX) * (u - 0.5 / scallops);
    const my = tipY + (trailY - tipY) * (u - 0.5 / scallops) + dip;
    ctx.quadraticCurveTo(mx, my, sx, sy);
  }
  ctx.quadraticCurveTo(root.x - span * 0.08, root.y + 6 * scale, root.x, root.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = behind ? `${dna.ink2}77` : `${dna.ink2}cc`;
  ctx.lineWidth = behind ? 1 : 1.35;
  const ribs = 3 + Math.round(dna.voice * 3);
  for (let r = 1; r <= ribs; r++) {
    const u = r / (ribs + 1);
    ctx.beginPath();
    ctx.moveTo(root.x, root.y);
    ctx.quadraticCurveTo(
      leadX * (1 - u) + wristX * u,
      leadY * (1 - u * 0.4) + fold * u,
      tipX * u + trailX * (1 - u) * 0.25,
      tipY * u + (root.y - lift * (1 - u)) * (1 - u),
    );
    ctx.stroke();
  }
}

function drawLeg(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  index: number,
  phase: number,
  travel: number,
  dna: DragonDNA,
  far: boolean,
  size = 1,
) {
  const p = pts[Math.max(0, Math.min(pts.length - 1, index))]!;
  const nrm = normalAt(pts, index);
  let dx = nrm.nx;
  let dy = nrm.ny;
  if (dy < 0.18) {
    dx = -dx;
    dy = Math.abs(dy) + 0.4;
  }
  const gait = Math.sin(travel + phase);
  const len = (16 + dna.thick * 8) * size;
  const swing = gait * (7 + dna.intensity * 6) * size;
  const hipX = p.x + nrm.tx * (far ? -4 : 3) * size;
  const hipY = p.y + 4 * size;
  const kneeX = hipX + dx * len * 0.52 + nrm.tx * swing;
  const kneeY = hipY + dy * len * 0.58 + 6 * size;
  const footX = kneeX + dx * len * 0.4 + nrm.tx * swing * 0.3;
  const footY = kneeY + dy * len * 0.38 + 3 * size;
  ctx.strokeStyle = far ? `${dna.ink2}90` : "#e8e2d4";
  ctx.fillStyle = far ? `${dna.ink2}70` : mixHex("#e8e2d4", dna.ink, 0.22);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = (far ? 2.1 : 3.1) * Math.sqrt(size);
  ctx.beginPath();
  ctx.moveTo(hipX, hipY);
  ctx.quadraticCurveTo(hipX + dx * 4 * size, hipY + 8 * size, kneeX, kneeY);
  ctx.quadraticCurveTo(kneeX + dx * 3 * size, kneeY + 5 * size, footX, footY);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(kneeX, kneeY, (far ? 1.6 : 2.2) * size, 0, Math.PI * 2);
  ctx.fill();
  for (let c = -1; c <= 1; c++) {
    ctx.beginPath();
    ctx.moveTo(footX, footY);
    ctx.lineTo(footX + nrm.tx * (5 + c * 3) * size + dx * 2 * size, footY + (4 + Math.abs(c)) * size);
    ctx.stroke();
  }
}

function drawAura(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  dna: DragonDNA,
  nowAmp: number,
  travel: number,
  time: number,
  size = 1,
) {
  if (nowAmp < 0.1) return;
  const n = 5 + Math.round(nowAmp * 6);
  ctx.save();
  for (let i = 0; i < n; i++) {
    const along = 0.18 + ((i * 0.137 + time * 0.08) % 0.62);
    const idx = Math.floor(along * (pts.length - 1));
    const p = pts[idx]!;
    const nrm = normalAt(pts, idx);
    const phase = travel * 0.7 + i * 1.3;
    const rise = (0.5 + 0.5 * Math.sin(phase)) * (10 + nowAmp * 22) * size;
    const x = p.x + nrm.nx * (6 + Math.sin(phase * 1.7) * 8) * size;
    const y = p.y + nrm.ny * 4 * size - rise;
    ctx.globalAlpha = 0.18 + nowAmp * 0.35;
    ctx.strokeStyle = dna.ink;
    ctx.fillStyle = dna.ink;
    ctx.lineWidth = 1.2 * Math.sqrt(size);
    if (dna.element === "FIRE") {
      ctx.beginPath();
      ctx.moveTo(x, y + 5 * size);
      ctx.lineTo(x - 2.5 * size, y);
      ctx.lineTo(x + 2.5 * size, y);
      ctx.closePath();
      ctx.fill();
    } else if (dna.element === "WATER") {
      ctx.beginPath();
      ctx.arc(x, y, (2.2 + nowAmp * 2) * size, 0, Math.PI * 2);
      ctx.stroke();
    } else if (dna.element === "EARTH") {
      ctx.beginPath();
      ctx.moveTo(x, y - 3 * size);
      ctx.lineTo(x + 3 * size, y);
      ctx.lineTo(x, y + 3 * size);
      ctx.lineTo(x - 3 * size, y);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(x - 6 * size, y + 3 * size);
      ctx.lineTo(x + 8 * size, y - 4 * size);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawKindMarks(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  dna: DragonDNA,
  env: Float32Array,
  travel: number,
) {
  const spineCount = Math.max(5, dna.spines);
  ctx.fillStyle = mixHex("#e8e2d4", dna.ink, 0.22);
  ctx.strokeStyle = "#e8e2d4";
  ctx.lineWidth = 1.4;
  for (let s = 0; s < spineCount; s++) {
    const i = 8 + Math.floor(((s + 0.5) / spineCount) * (SPINE - 24));
    const p = pts[i]!;
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(SPINE - 1, i + 1)]!;
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    let nx = -dy;
    let ny = dx;
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    const ht = 5 + dna.intensity * 9 + (env[i] ?? 0) * 10;
    const pulse = 0.62 + 0.38 * Math.sin(travel * 2 + s * 0.9);

    if (dna.element === "FIRE") {
      ctx.beginPath();
      ctx.moveTo(p.x - nx * 4, p.y - ny * 4);
      ctx.lineTo(p.x + nx * ht, p.y + ny * ht);
      ctx.lineTo(p.x + dx * 3, p.y + dy * 3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      continue;
    }

    if (dna.element === "WATER") {
      const r = (3.5 + ht * 0.42) * pulse;
      const cx = p.x + nx * (r * 0.45);
      const cy = p.y + ny * (r * 0.45);
      ctx.globalAlpha = 0.35 + pulse * 0.45;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 0.25 + pulse * 0.3;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      continue;
    }

    if (dna.element === "EARTH") {
      const d = ht * 0.9;
      const w = 4 + (env[i] ?? 0) * 3;
      ctx.beginPath();
      ctx.moveTo(p.x + dx * w, p.y + dy * w);
      ctx.lineTo(p.x + nx * d, p.y + ny * d);
      ctx.lineTo(p.x - dx * w, p.y - dy * w);
      ctx.lineTo(p.x - nx * 3.5, p.y - ny * 3.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      continue;
    }

    const hx = nx + dx;
    const hy = ny + dy;
    const hl = Math.hypot(hx, hy) || 1;
    const ux = hx / hl;
    const uy = hy / hl;
    const mark = 7 + ht * 0.55;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const o = (k - 1) * 5;
      const x0 = p.x + dx * o;
      const y0 = p.y + dy * o;
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + ux * mark, y0 + uy * mark);
    }
    ctx.stroke();
  }
}

function drawAxes(ctx: CanvasRenderingContext2D, dna: DragonDNA, w: number, rack = false) {
  const x = w - 312;
  const mute = rack ? "#1f6a34" : "#9b93ab";
  const dim = rack ? "#145828" : "#6e677c";
  const bright = rack ? "#3cff6a" : "#ece8f0";
  ctx.font = "500 12px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = mute;
  ctx.fillText(rack ? "EAR WYRM · CRT" : "EAR WYRM", x, 28);
  ctx.fillStyle = dim;
  ctx.fillText("WATERS", x, 52);
  ctx.fillText("SKY", x + 232, 52);
  ctx.fillStyle = rack ? "#051108" : "#2a2436";
  ctx.fillRect(x + 62, 44, 150, 6);
  const t = (dna.register + 1) / 2;
  ctx.fillStyle = dna.ink;
  ctx.fillRect(x + 62 + t * 150 - 5, 40, 10, 14);
  ctx.fillStyle = dim;
  ctx.fillText("PULSE", x, 74);
  ctx.fillStyle = bright;
  ctx.fillText(`${dna.bpm}`, x + 62, 74);
  ctx.fillStyle = dim;
  ctx.fillText("CALL", x, 96);
  ctx.fillStyle = dna.ink;
  ctx.fillText(dna.voiceName, x + 62, 96);
  ctx.fillStyle = dim;
  ctx.fillText("KIND", x, 118);
  ctx.fillStyle = dna.ink;
  ctx.fillText(dna.element, x + 62, 118);
}

function drawRingGround(ctx: CanvasRenderingContext2D, dna: DragonDNA, travel: number) {
  const rings = 3 + (dna.seed % 3);
  for (let r = 0; r < rings; r++) {
    const rad = 70 + r * (48 + dna.mid * 30);
    ctx.beginPath();
    ctx.arc(0, 0, rad, 0, Math.PI * 2);
    ctx.stroke();
    const ticks = 6 + (dna.seed % 7);
    for (let k = 0; k < ticks; k++) {
      const a = (k / ticks) * Math.PI * 2 + dna.lean + travel * 0.14;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (rad - 8), Math.sin(a) * (rad - 8));
      ctx.lineTo(Math.cos(a) * (rad + 10), Math.sin(a) * (rad + 10));
      ctx.stroke();
    }
  }
}

function drawTriangleGround(ctx: CanvasRenderingContext2D, dna: DragonDNA, travel: number) {
  const n = 4 + (dna.seed % 3);
  for (let r = 0; r < n; r++) {
    const rad = 52 + r * (40 + dna.mid * 26);
    const rot = dna.lean * 0.35 + travel * 0.05 + r * 0.12;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = rot + (k / 3) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * rad;
      const y = Math.sin(a) * rad;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }
  const scatter = 9 + (dna.seed % 5);
  for (let i = 0; i < scatter; i++) {
    const a = (i / scatter) * Math.PI * 2 + travel * 0.07 + dna.lean;
    const d = 88 + (i % 4) * 52;
    const s = 7 + (i % 3) * 5;
    const cx = Math.cos(a) * d;
    const cy = Math.sin(a) * d;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const t = a + (k / 3) * Math.PI * 2;
      const x = cx + Math.cos(t) * s;
      const y = cy + Math.sin(t) * s;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }
}

function drawSpiralGround(ctx: CanvasRenderingContext2D, dna: DragonDNA, travel: number) {
  const phi = 1.61803398875;
  const b = Math.log(phi) / (Math.PI / 2);
  const spin = travel * 0.03 + dna.lean * 0.15;
  const steps = 220;
  const turns = 4.2;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const th = (i / steps) * turns * Math.PI * 2 + spin;
    const r = 10 * Math.exp(b * (th - spin));
    const x = Math.cos(th) * r;
    const y = Math.sin(th) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const th = (i / steps) * turns * Math.PI * 2 + spin + Math.PI;
    const r = 10 * Math.exp(b * (th - spin - Math.PI));
    const x = Math.cos(th) * r;
    const y = Math.sin(th) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  let a = 16;
  let c = 16;
  let x = 0;
  let y = 0;
  ctx.save();
  ctx.rotate(spin * 0.4);
  for (let i = 0; i < 8; i++) {
    ctx.strokeRect(x, y, a, a);
    ctx.beginPath();
    if (i % 4 === 0) ctx.arc(x + a, y + a, a, Math.PI, Math.PI * 1.5);
    else if (i % 4 === 1) ctx.arc(x, y + a, a, -Math.PI / 2, 0);
    else if (i % 4 === 2) ctx.arc(x, y, a, 0, Math.PI / 2);
    else ctx.arc(x + a, y, a, Math.PI / 2, Math.PI);
    ctx.stroke();
    const next = a + c;
    if (i % 4 === 0) x += a;
    else if (i % 4 === 1) y += a;
    else if (i % 4 === 2) x -= next;
    else y -= next;
    a = c;
    c = next;
  }
  ctx.restore();
}

function drawClipGround(
  ctx: CanvasRenderingContext2D,
  dna: DragonDNA,
  w: number,
  h: number,
  travel: number,
) {
  ctx.save();
  ctx.translate(w * 0.62, h * 0.44);
  ctx.strokeStyle = `${dna.ink}26`;
  ctx.lineWidth = 1.15;
  const kind = dna.seed % 3;
  if (kind === 0) drawRingGround(ctx, dna, travel);
  else if (kind === 1) drawTriangleGround(ctx, dna, travel);
  else drawSpiralGround(ctx, dna, travel);
  ctx.restore();
}

function drawScanlines(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
  const v = ctx.createRadialGradient(w * 0.5, h * 0.48, h * 0.18, w * 0.5, h * 0.5, w * 0.62);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.58)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

export function drawSummonedDragon(
  ctx: CanvasRenderingContext2D,
  dna: DragonDNA,
  samples: Float32Array,
  sr: number,
  time: number,
  env: Float32Array,
  caller = "@johnnyskyride",
  chrome: "clip" | "live" = "clip",
  stillness = 0,
  glance = 0,
  skin: "forge" | "rack" = "forge",
) {
  const canvasW = ctx.canvas.width;
  const canvasH = ctx.canvas.height;
  let w = canvasW;
  let h = canvasH;
  if (chrome === "clip") {
    w = 1280;
    h = 720;
    ctx.setTransform(canvasW / 1280, 0, 0, canvasH / 720, 0, 0);
  }
  const rack = skin === "rack";
  if (rack) dna = { ...dna, ink: "#3cff6a", ink2: "#b8ffcc" };
  const live = liveWave(samples, sr, time, SPINE);
  const bars = bandsAt(samples, sr, time);
  const kick = chrome === "clip" ? 1.14 : 1;
  const nowAmp = sampleHop(dna.amp, time, dna.hop, sr) * Math.max(0, 1 - stillness) * kick;
  const onset = sampleHop(dna.onsets, time, dna.hop, sr) * Math.max(0, 1 - stillness) * kick;
  const travel = time * Math.max(0.08, dna.beatHz) * Math.PI * 2;
  const nowRms = Math.max(nowAmp, bars.reduce((a, b) => a + b, 0) / BARS);
  const liveScale = chrome === "live" ? Math.min(1, Math.max(0.42, w / 700)) : 1;
  const size = chrome === "clip" ? 2.28 : liveScale;

  if (rack) {
    ctx.fillStyle = "#030504";
    ctx.fillRect(0, 0, w, h);
    const crt = ctx.createRadialGradient(w * 0.52, h * 0.46, 24, w * 0.5, h * 0.5, w * 0.7);
    crt.addColorStop(0, "rgba(18, 56, 28, 0.55)");
    crt.addColorStop(0.55, "rgba(8, 22, 12, 0.2)");
    crt.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = crt;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(60, 255, 106, 0.07)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 40; x < w; x += 40) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = 30; y < h; y += 30) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  } else {
    ctx.fillStyle = "#1a1623";
    ctx.fillRect(0, 0, w, h);
    const bg = ctx.createRadialGradient(w * 0.58, h * 0.42, 20, w * 0.5, h * 0.46, w * 0.72);
    bg.addColorStop(0, `${dna.ink}26`);
    bg.addColorStop(0.45, "rgba(74, 58, 104, 0.28)");
    bg.addColorStop(1, "rgba(12, 10, 18, 0)");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }

  if (chrome === "clip") drawClipGround(ctx, dna, w, h, travel);

  const pts: Pt[] = [];
  for (let i = 0; i < SPINE; i++) pts.push(spinePoint(i, dna, env, live, w, h, nowAmp, travel, stillness, glance, size));

  const barW = (w - 140) / BARS;
  const barBase = h - 42;
  if (chrome === "clip") {
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    for (let i = 0; i < BARS; i++) {
      const mag = bars[i] ?? 0;
      const bh = (18 + mag * (118 + dna.air * 52)) * (chrome === "clip" ? 1.15 : 1);
      const x = 70 + i * barW;
      const y = barBase - bh;
      ctx.fillStyle = rack
        ? i % 2 === 0
          ? dna.ink
          : dna.ink2
        : i % 4 === 0
          ? dna.ink
          : i % 4 === 1
            ? "#d9b8ff"
            : i % 4 === 2
              ? "#12e08a"
              : "#e8e2d4";
      ctx.globalAlpha = 0.28 + mag * 0.72;
      ctx.fillRect(x + 2, y, barW - 5, bh);
    }
    ctx.globalAlpha = 1;
  }

  const shoulder = Math.floor(SPINE * 0.36);
  const rootFar = pts[shoulder - 4]!;
  const rootNear = pts[shoulder]!;
  const flapHz = Math.max(0.75, dna.beatHz) * (0.92 + nowAmp * 0.38);
  const phase = time * flapHz * Math.PI * 2;
  const stroke =
    chrome === "clip"
      ? 0.24 + Math.min(1, nowAmp * 1.2 + onset * 0.4) * 0.76
      : 0.26 + Math.min(1, nowAmp * 0.95 + onset * 0.22) * 0.58;
  let flap: number;
  let flapFar: number;
  if (stillness > 0.65) {
    flap = 0.24 + glance * 0.05 * Math.sin(travel * 0.18);
    flapFar = flap;
  } else {
    const wave = 0.5 + 0.5 * Math.sin(phase);
    const waveFar = 0.5 + 0.5 * Math.sin(phase + 0.3);
    flap = Math.max(0.08, 0.14 + stroke * wave - onset * 0.42);
    flapFar = Math.max(0.08, 0.14 + stroke * waveFar - onset * 0.3);
  }
  drawWing(ctx, rootFar, flapFar, 0.72 * size, dna, true);
  drawLeg(ctx, pts, Math.floor(SPINE * 0.24), 0, travel * Math.max(0, 1 - stillness), dna, true, size);
  drawLeg(ctx, pts, Math.floor(SPINE * 0.52), Math.PI, travel * Math.max(0, 1 - stillness), dna, true, size);

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const halves = bodyHalves(pts, dna, size);
  ctx.beginPath();
  ctx.moveTo(halves.up[0]!.x, halves.up[0]!.y);
  for (let i = 1; i < halves.up.length - 1; i++) {
    const n = halves.up[i]!;
    const nx = halves.up[i + 1]!;
    ctx.quadraticCurveTo(n.x, n.y, (n.x + nx.x) * 0.5, (n.y + nx.y) * 0.5);
  }
  const lastUp = halves.up[halves.up.length - 1]!;
  ctx.lineTo(lastUp.x, lastUp.y);
  for (let i = halves.dn.length - 1; i > 0; i--) {
    const n = halves.dn[i]!;
    const nx = halves.dn[i - 1]!;
    ctx.quadraticCurveTo(n.x, n.y, (n.x + nx.x) * 0.5, (n.y + nx.y) * 0.5);
  }
  ctx.closePath();
  ctx.fillStyle = mixHex(rack ? "#041208" : "#1c1826", dna.ink, 0.22);
  ctx.fill();
  ctx.strokeStyle = mixHex(rack ? "#145828" : "#4a3f63", dna.ink, 0.5);
  ctx.lineWidth = 1.6 * Math.sqrt(size);
  ctx.stroke();
  ctx.strokeStyle = rack ? "#c8ffd4" : "#e8e2d4";
  ctx.lineWidth = 1.85 * Math.sqrt(size);
  smoothPath(ctx, halves.up);
  ctx.stroke();
  ctx.strokeStyle = `${dna.ink2}55`;
  ctx.lineWidth = 1.1;
  smoothPath(ctx, halves.dn);
  ctx.stroke();

  drawLeg(ctx, pts, Math.floor(SPINE * 0.32), Math.PI, travel * Math.max(0, 1 - stillness), dna, false, size);
  drawLeg(ctx, pts, Math.floor(SPINE * 0.58), 0, travel * Math.max(0, 1 - stillness), dna, false, size);
  drawWing(ctx, rootNear, flap, size, dna, false);
  drawAura(ctx, pts, dna, nowAmp, travel, time, size);

  if (chrome === "clip") {
    for (let i = 0; i < BARS; i++) {
      const mag = bars[i] ?? 0;
      if (mag < 0.38 - dna.intensity * 0.08) continue;
      const target = pts[Math.round((i / (BARS - 1)) * (SPINE - 1))]!;
      const x = 70 + i * barW + barW * 0.5;
      const y = barBase - (18 + mag * 118);
      ctx.globalAlpha = mag * (0.18 + dna.intensity * 0.28);
      ctx.strokeStyle = dna.ink;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  const scaleStep = Math.max(2, Math.round(4 - dna.peaky * 1.6));
  ctx.fillStyle = `${dna.ink2}99`;
  ctx.strokeStyle = `${dna.ink2}cc`;
  ctx.lineWidth = 1.05;
  for (let i = 8; i < SPINE - 14; i += scaleStep) {
    const p = pts[i]!;
    const nrm = normalAt(pts, i);
    let nx = nrm.nx;
    let ny = nrm.ny;
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    const s = (5 + (env[i] ?? 0) * 8 + dna.thick * 3) * size;
    ctx.beginPath();
    ctx.moveTo(p.x + nrm.tx * 4, p.y + nrm.ty * 4);
    ctx.lineTo(p.x + nx * s + nrm.tx * 2, p.y + ny * s + nrm.ty * 2);
    ctx.lineTo(p.x + nrm.tx * 9, p.y + nrm.ty * 9);
    ctx.lineTo(p.x - nx * 2 + nrm.tx * 5, p.y - ny * 2 + nrm.ty * 5);
    ctx.closePath();
    ctx.globalAlpha = 0.35 + (env[i] ?? 0) * 0.4;
    ctx.fill();
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  drawKindMarks(ctx, pts, dna, env, travel);

  ctx.strokeStyle = dna.ink;
  ctx.shadowColor = dna.ink;
  ctx.shadowBlur = (4 + dna.intensity * 14 + nowRms * 12 * dna.intensity) * (chrome === "clip" ? 1.25 : 1);
  ctx.lineWidth = (1.2 + dna.intensity * 1.6) * Math.sqrt(size);
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < SPINE - 1; i++) {
    const p = pts[i]!;
    const n = pts[i + 1]!;
    const jolt = (live[i] ?? 0) * (2 + dna.intensity * 7) * size;
    ctx.quadraticCurveTo(p.x, p.y + jolt, (p.x + n.x) * 0.5, (p.y + n.y) * 0.5 + jolt * 0.5);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  const headI = SPINE - 10;
  const head = pts[headI]!;
  const nose = pts[SPINE - 1]!;
  const neck = pts[SPINE - 18]!;
  const hx = nose.x - neck.x;
  const hy = nose.y - neck.y;
  const hl = Math.hypot(hx, hy) || 1;
  const ux = hx / hl;
  const uy = hy / hl;
  const px = -uy;
  const py = ux;
  const hs = 1 + (size - 1) * 0.72;
  const jawOpen =
    (stillness > 0.65
      ? 3 + glance * 2
      : 6 + dna.crest * 9 + nowAmp * 8 * dna.intensity + onset * 16 * dna.intensity) * hs;
  const snout = (32 + dna.air * 20) * hs;
  const brow = (10 + dna.voice * 5) * hs;

  ctx.fillStyle = mixHex("#241c32", dna.ink, 0.28);
  ctx.strokeStyle = "#e8e2d4";
  ctx.lineWidth = 2.1 * Math.sqrt(size);
  ctx.beginPath();
  ctx.moveTo(head.x + px * brow, head.y + py * brow);
  ctx.quadraticCurveTo(
    head.x + ux * snout * 0.42 + px * (brow * 0.75),
    head.y + uy * snout * 0.42 + py * (brow * 0.75),
    nose.x + ux * snout + px * 5,
    nose.y + uy * snout + py * 5,
  );
  ctx.lineTo(nose.x + ux * (snout + 16), nose.y + uy * (snout + 16));
  ctx.quadraticCurveTo(
    nose.x + ux * snout * 0.7 - px * 2,
    nose.y + uy * snout * 0.7 - py * 2,
    head.x - px * 5,
    head.y - py * 5,
  );
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(head.x - px * 3, head.y - py * 3);
  ctx.quadraticCurveTo(
    head.x + ux * snout * 0.45 - px * (jawOpen * 0.55),
    head.y + uy * snout * 0.45 - py * (jawOpen * 0.55),
    nose.x + ux * (snout - 2) - px * jawOpen,
    nose.y + uy * (snout - 2) - py * jawOpen,
  );
  ctx.lineTo(nose.x + ux * 6 - px * (jawOpen * 0.35), nose.y + uy * 6 - py * (jawOpen * 0.35));
  ctx.stroke();

  if (onset > 0.35 && stillness < 0.5) {
    ctx.strokeStyle = dna.ink;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(nose.x + ux * 8 - px * (jawOpen * 0.5), nose.y + uy * 8 - py * (jawOpen * 0.5));
    ctx.quadraticCurveTo(
      nose.x + ux * (snout + 10) - px * (jawOpen + 6),
      nose.y + uy * (snout + 10) - py * (jawOpen + 6),
      nose.x + ux * (snout + 22) - px * jawOpen,
      nose.y + uy * (snout + 22) - py * jawOpen,
    );
    ctx.stroke();
  }

  const teeth = 3 + Math.round(dna.peaky * 3);
  ctx.fillStyle = "#e8e2d4";
  for (let t = 0; t < teeth; t++) {
    const u = 0.28 + t * 0.14;
    const bx = head.x + ux * snout * u;
    const by = head.y + uy * snout * u;
    ctx.beginPath();
    ctx.moveTo(bx - px * 1.5, by - py * 1.5);
    ctx.lineTo(bx + ux * 2.5 - px * (7 + dna.crest * 5), by + uy * 2.5 - py * (7 + dna.crest * 5));
    ctx.lineTo(bx + ux * 6, by + uy * 6);
    ctx.fill();
  }

  ctx.fillStyle = mixHex("#1a1623", dna.ink, 0.4);
  ctx.beginPath();
  ctx.ellipse(
    nose.x + ux * snout * 0.82 + px * 3,
    nose.y + uy * snout * 0.82 + py * 3,
    2.2,
    1.4,
    Math.atan2(uy, ux),
    0,
    Math.PI * 2,
  );
  ctx.fill();

  for (let hn = 0; hn < dna.horns; hn++) {
    const len = (34 + dna.air * 46 + hn * 7) * hs;
    const rootx = head.x + px * (11 - hn * 3.2) * hs - ux * (4 + hn * 5) * hs;
    const rooty = head.y + py * (11 - hn * 3.2) * hs - uy * (4 + hn * 5) * hs;
    const midx = rootx + px * len * 0.55 + ux * (4 + hn * 3) * hs;
    const midy = rooty + py * len * 0.55 + uy * (4 + hn * 3) * hs;
    const tipx = rootx + px * len * 0.95 + ux * (16 + hn * 5) * hs + dna.lean * 6 * hs;
    const tipy = rooty + py * len * 0.95 + uy * (16 + hn * 5) * hs;
    ctx.strokeStyle = "#e8e2d4";
    ctx.lineWidth = (2.6 - hn * 0.28) * Math.sqrt(size);
    ctx.beginPath();
    ctx.moveTo(rootx, rooty);
    ctx.quadraticCurveTo(midx, midy, tipx, tipy);
    ctx.stroke();
  }

  const blink = glance > 0.4 && Math.sin(travel * 0.31) < -0.72;
  const eye = {
    x: head.x + ux * 12 * hs + px * 7 * hs,
    y: head.y + uy * 12 * hs + py * 7 * hs,
  };
  ctx.fillStyle = dna.ink;
  ctx.shadowColor = dna.ink;
  ctx.shadowBlur = blink ? 0 : 18 * size;
  if (blink) {
    ctx.beginPath();
    ctx.moveTo(eye.x - 7 * hs, eye.y);
    ctx.lineTo(eye.x + 7 * hs, eye.y);
    ctx.strokeStyle = dna.ink;
    ctx.lineWidth = 1.6 * Math.sqrt(size);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.ellipse(eye.x, eye.y, 7.5 * hs, 4.2 * hs, Math.atan2(uy, ux), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#14101c";
    ctx.beginPath();
    ctx.ellipse(eye.x + ux * 1.5 * hs, eye.y + uy * 1.5 * hs, 2.4 * hs, 3.4 * hs, Math.atan2(uy, ux), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f4efe6";
    ctx.beginPath();
    ctx.arc(eye.x + px * 2 * hs - ux, eye.y + py * 2 * hs - uy, 1.15 * hs, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  const tail = pts[3]!;
  const nrmT = normalAt(pts, 3);
  ctx.fillStyle = mixHex(rack ? "#c8ffd4" : "#e8e2d4", dna.ink, 0.15);
  ctx.strokeStyle = rack ? "#c8ffd4" : "#e8e2d4";
  ctx.lineWidth = 1.8 * Math.sqrt(size);
  ctx.beginPath();
  ctx.moveTo(tail.x, tail.y);
  ctx.lineTo(tail.x - nrmT.tx * 42 * hs - nrmT.nx * 8 * hs, tail.y - nrmT.ty * 42 * hs - nrmT.ny * 8 * hs);
  ctx.lineTo(tail.x - nrmT.tx * 18 * hs + nrmT.nx * 16 * hs, tail.y - nrmT.ty * 18 * hs + nrmT.ny * 16 * hs);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tail.x, tail.y);
  ctx.lineTo(tail.x - nrmT.tx * 36 * hs + nrmT.nx * 14 * hs, tail.y - nrmT.ty * 36 * hs + nrmT.ny * 14 * hs);
  ctx.lineTo(tail.x - nrmT.tx * 14 * hs - nrmT.nx * 6 * hs, tail.y - nrmT.ty * 14 * hs - nrmT.ny * 6 * hs);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  if (chrome === "live") {
    if (stillness < 0.7) {
      ctx.fillStyle = dna.ink;
      ctx.font = `600 ${Math.max(10, Math.round(h * 0.13))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.fillText(dna.element, 8, h - 8);
    }
    return;
  }

  if (rack) {
    ctx.shadowColor = "rgba(60, 255, 106, 0.55)";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "#1f6a34";
    ctx.font = "500 16px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText("SF-33  ·  RACK", 48, 46);
    ctx.fillStyle = "#3cff6a";
    ctx.font = "600 40px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText("SKYFORGE", 48, 92);
    ctx.shadowBlur = 6;
    ctx.font = "500 18px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(caller, 48, 122);
    ctx.fillStyle = "#9affb4";
    ctx.font = "500 16px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(dna.epithet, 48, 150);
    ctx.fillStyle = "#3cff6a";
    ctx.font = "500 14px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(dna.element, 48, 172);
    ctx.shadowBlur = 0;
    drawAxes(ctx, dna, w, true);
    drawScanlines(ctx, w, h);
  } else {
    ctx.fillStyle = "#9b93ab";
    ctx.font = "500 18px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText("SF-33", 48, 48);
    ctx.fillStyle = "#ece8f0";
    ctx.font = "500 42px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText("SkyForge", 48, 96);
    ctx.fillStyle = dna.ink;
    ctx.font = "500 18px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(caller, 48, 126);
    ctx.fillStyle = "#c9b8e4";
    ctx.font = "500 16px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(dna.epithet, 48, 154);
    ctx.fillStyle = dna.ink;
    ctx.font = "500 14px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(dna.element, 48, 176);
    drawAxes(ctx, dna, w);
  }
  if (chrome === "clip") ctx.setTransform(1, 0, 0, 1, 0, 0);
}

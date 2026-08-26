import {
  FILTER_TYPES,
  WAVEFORMS,
  type FilterType,
  type SynthParams,
  type Waveform,
} from "./types";

export type ScopeMeter = {
  fftSize: number;
  context: { sampleRate: number; currentTime: number };
  getByteTimeDomainData: (data: Uint8Array) => void;
  getFloatTimeDomainData: (data: Float32Array) => void;
};

export class LiveMeter implements ScopeMeter {
  fftSize = 2048;
  context = { sampleRate: 44_100, currentTime: 0 };
  private pcm = new Float32Array(2048);

  tick(dt = 1 / 60) {
    this.context.currentTime += dt;
  }

  ingest(samples: number[]) {
    if (samples.length === 0) return;
    const out = this.pcm;
    const n = samples.length;
    for (let i = 0; i < out.length; i++) {
      const t = (i / out.length) * n;
      const i0 = Math.min(n - 1, t | 0);
      const i1 = Math.min(n - 1, i0 + 1);
      const f = t - i0;
      const a = samples[i0] ?? 0;
      const b = samples[i1] ?? a;
      out[i] = a + (b - a) * f;
    }
  }

  getFloatTimeDomainData(data: Float32Array) {
    const n = Math.min(data.length, this.pcm.length);
    data.set(this.pcm.subarray(0, n));
    if (data.length > n) data.fill(0, n);
  }

  getByteTimeDomainData(data: Uint8Array) {
    const n = Math.min(data.length, this.pcm.length);
    for (let i = 0; i < n; i++) {
      const v = Math.max(-1, Math.min(1, this.pcm[i] ?? 0));
      data[i] = Math.round((v * 0.5 + 0.5) * 255);
    }
    if (data.length > n) data.fill(128, n);
  }
}

type LiveWindow = Window & {
  sendToPlugin?: (msg: unknown) => void;
  onPluginMessage?: (msg: LiveMsg) => void;
};

export type LiveKind = "EARTH" | "WATER" | "FIRE" | "WIND";

export type LiveMsg =
  | { type: "meter"; rms: number; scope: number[]; notes: number[] }
  | { type: "params"; params: Record<string, unknown> }
  | {
      type: "state";
      params?: Record<string, unknown>;
      skin?: string;
      trim?: string;
      handle?: string;
      kind?: string;
      preset?: string;
      rec?: string;
      scale?: number;
      banks?: string;
      version?: string;
    }
  | { type: "clip"; phase: "begin"; sr: number; n: number; mode?: string }
  | { type: "clip"; phase: "chunk"; data: string }
  | { type: "clip"; phase: "end" }
  | { type: "midi"; events: { t: number; type: "on" | "off"; midi: number; vel: number }[] }
  | { type: "saved"; ok: boolean; name: string }
  | {
      type: "wyrms";
      log: {
        id: string;
        epithet: string;
        element: string;
        at: number;
        name: string;
        thumb: string;
        stem: string;
      }[];
    };

export function isLiveHost(): boolean {
  if (typeof window === "undefined") return false;
  return typeof (window as LiveWindow).sendToPlugin === "function";
}

if (typeof navigator !== "undefined" && isLiveHost()) {
  Object.defineProperty(navigator, "requestMIDIAccess", {
    configurable: true,
    writable: true,
    value: () => Promise.reject(new DOMException("SkyForge leaves MIDI to the host", "NotSupportedError")),
  });
}

export function sendToPlugin(msg: unknown) {
  const w = window as LiveWindow;
  try {
    w.sendToPlugin?.(msg);
  } catch {
    /* plugin webview only */
  }
}

export function onPluginMessage(handler: (msg: LiveMsg) => void) {
  const w = window as LiveWindow & { __sfQ?: LiveMsg[] };
  w.onPluginMessage = handler;
  const queued = w.__sfQ;
  if (!queued || queued.length === 0) return;
  w.__sfQ = [];
  for (const msg of queued) handler(msg);
}

export function encodeB64(bytes: Uint8Array): string {
  let bin = "";
  const step = 0x2000;
  for (let i = 0; i < bytes.length; i += step) {
    const slice = bytes.subarray(i, i + step);
    bin += String.fromCharCode(...slice);
  }
  return btoa(bin);
}

export async function saveToPlugin(name: string, blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  sendToPlugin({ type: "SaveStart", name });
  const n = 24_576;
  for (let i = 0; i < bytes.length; i += n) {
    sendToPlugin({ type: "SaveChunk", data: encodeB64(bytes.subarray(i, i + n)) });
  }
  sendToPlugin({ type: "SaveEnd" });
}

function num(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

export function mergeLiveParams(prev: SynthParams, raw: Record<string, unknown> | undefined): SynthParams {
  if (!raw) return prev;
  const waveform = WAVEFORMS.includes(raw.waveform as Waveform) ? (raw.waveform as Waveform) : prev.waveform;
  const filterType = FILTER_TYPES.includes(raw.filterType as FilterType)
    ? (raw.filterType as FilterType)
    : prev.filterType;
  return {
    waveform,
    pulseWidth: num(raw.pulseWidth, prev.pulseWidth),
    filterType,
    cutoff: num(raw.cutoff, prev.cutoff),
    resonance: num(raw.resonance, prev.resonance),
    attack: num(raw.attack, prev.attack),
    decay: num(raw.decay, prev.decay),
    sustain: num(raw.sustain, prev.sustain),
    release: num(raw.release, prev.release),
    octave: Math.round(num(raw.octave, prev.octave)),
    volume: num(raw.volume, prev.volume),
    halloween: num(raw.halloween, prev.halloween),
    waters: num(raw.waters, prev.waters),
    aether: num(raw.aether, prev.aether),
    unison: Math.round(num(raw.unison, prev.unison)),
    twin: num(raw.twin, prev.twin),
    twinInterval: Math.round(num(raw.twinInterval, prev.twinInterval)),
  };
}

export function decodeClipChunk(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const even = bytes.byteLength & ~1;
  return new Int16Array(bytes.buffer, bytes.byteOffset, even / 2);
}

export function assembleClipPcm(parts: Int16Array[], n: number): Float32Array {
  const out = new Float32Array(Math.max(0, n));
  let o = 0;
  for (const part of parts) {
    for (let i = 0; i < part.length && o < out.length; i++) {
      const v = part[i] ?? 0;
      out[o++] = v < 0 ? v / 0x8000 : v / 0x7fff;
    }
  }
  return out;
}

import lameMin from "lamejs/lame.min.js?raw";

type Enc = {
  encodeBuffer: (left: Int16Array, right?: Int16Array) => Int8Array;
  flush: () => Int8Array;
};

let Encoder: (new (ch: number, rate: number, kbps: number) => Enc) | null = null;

function mp3Encoder(ch: number, rate: number, kbps: number): Enc {
  if (!Encoder) {
    const lib = new Function(`${lameMin}; return lamejs;`)() as {
      Mp3Encoder: new (ch: number, rate: number, kbps: number) => Enc;
    };
    Encoder = lib.Mp3Encoder;
  }
  return new Encoder(ch, rate, kbps);
}

const LAME_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

function pickRate(sr: number): number {
  if (LAME_RATES.includes(sr)) return sr;
  return sr > 44100 ? 48000 : 44100;
}

function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to || from <= 0) return samples;
  const n = Math.max(1, Math.round(samples.length * (to / from)));
  const out = new Float32Array(n);
  const ratio = samples.length / n;
  for (let i = 0; i < n; i++) {
    const x = i * ratio;
    const i0 = Math.min(samples.length - 1, x | 0);
    const i1 = Math.min(samples.length - 1, i0 + 1);
    const f = x - i0;
    out[i] = (samples[i0] ?? 0) * (1 - f) + (samples[i1] ?? 0) * f;
  }
  return out;
}

function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function encodeMp3(samples: Float32Array, sampleRate: number): Blob {
  const rate = pickRate(sampleRate);
  const pcm = toInt16(resample(samples, sampleRate, rate));
  const encoder = mp3Encoder(1, rate, 192);
  const parts: BlobPart[] = [];
  const frame = 1152;
  for (let i = 0; i < pcm.length; i += frame) {
    const slice = pcm.subarray(i, Math.min(i + frame, pcm.length));
    const copy = new Int16Array(slice);
    const buf = encoder.encodeBuffer(copy);
    if (buf.length) parts.push(Uint8Array.from(buf));
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(Uint8Array.from(tail));
  if (!parts.length) throw new Error("MP3 encoder produced no data");
  return new Blob(parts, { type: "audio/mpeg" });
}

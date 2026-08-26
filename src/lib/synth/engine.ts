import { midiToFreq } from "./notes";
import { concatFloat32, encodeWav } from "./wav";
import {
  DEFAULT_PARAMS,
  type MidiEvent,
  type SynthParams,
  type Waveform,
} from "./types";

const MAX_VOICES = 8;
const MAX_DYING = 10;

function finite(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, finite(n, lo)));
}
const REC_PROCESSOR = `
class ForgeRec extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice());
    return true;
  }
}
registerProcessor("forge-rec", ForgeRec);
`;

const AETHER_PROCESSOR = `
class ForgeAether extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "amount", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" }];
  }
  constructor() {
    super();
    this.held = 0;
    this.prev = 0;
    this.phase = 0;
    this.lp = 0;
    this.hpX = 0;
    this.hpY = 0;
    this.wow = 0;
    this.n = 0xA341316C;
  }
  rand() {
    this.n = (this.n * 1664525 + 1013904223) >>> 0;
    return (this.n / 4294967296) * 2 - 1;
  }
  process(inputs, outputs, parameters) {
    try {
    const input = inputs[0] && inputs[0][0];
    const output = outputs[0] && outputs[0][0];
    if (!output) return true;
    if (!input) {
      output.fill(0);
      return true;
    }
    const rawAmt = parameters.amount[0] ?? 0;
    const amt = rawAmt > 1 ? 1 : rawAmt < 0 ? 0 : rawAmt;
    if (!Number.isFinite(amt) || amt < 0.006) {
      for (let i = 0; i < input.length; i++) {
        const s = input[i];
        output[i] = Number.isFinite(s) ? s : 0;
      }
      return true;
    }
    const holdN = 1 + amt * amt * 13.5;
    const bits = 13.2 - amt * 6.0;
    const levels = Math.pow(2, bits - 1);
    const drive = 1.06 + amt * 0.78;
    const den = Math.tanh(drive);
    const hpA = 0.004 + amt * 0.012;
    const lpA = 0.18 + (1 - amt) * 0.5;
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      if (!Number.isFinite(x)) {
        output[i] = 0;
        continue;
      }
      this.phase += 1;
      if (this.phase >= holdN) {
        this.phase -= holdN;
        this.prev = this.held;
        const dith = (this.rand() - this.rand()) * (0.45 / levels);
        this.held = Math.round((x + dith) * levels) / levels;
        if (!Number.isFinite(this.held)) this.held = 0;
      }
      const frac = Math.max(0, Math.min(1, this.phase / holdN));
      let y = this.prev + (this.held - this.prev) * frac;
      y = Math.tanh(y * drive) / den;
      this.hpY = y - this.hpX + (1 - hpA) * this.hpY;
      this.hpX = y;
      y = this.hpY;
      this.lp += (y - this.lp) * lpA;
      y = this.lp;
      this.wow += ((0.17 + amt * 0.11) / sampleRate) * 6.283185307;
      if (this.wow > 6.283185307) this.wow -= 6.283185307;
      y *= 1 + Math.sin(this.wow) * amt * 0.012;
      const o = x * (1 - amt * 0.32) + y * (amt * 0.94);
      output[i] = Number.isFinite(o) ? Math.max(-1.2, Math.min(1.2, o)) : 0;
    }
    return true;
    } catch (e) {
      const out = outputs[0] && outputs[0][0];
      if (out) out.fill(0);
      return true;
    }
  }
}
registerProcessor("forge-aether", ForgeAether);
`;

type Voice = {
  midi: number;
  startedAt: number;
  osc: OscillatorNode | AudioBufferSourceNode;
  unison: OscillatorNode[];
  drift?: OscillatorNode;
  driftGain?: GainNode;
  drifts: OscillatorNode[];
  driftGains: GainNode[];
  ghost?: OscillatorNode;
  ghostGain?: GainNode;
  sub?: OscillatorNode;
  subGain?: GainNode;
  filter: BiquadFilterNode;
  amp: GainNode;
  releasing: boolean;
};

function unisonCents(n: number): number[] {
  if (n <= 1) return [0];
  if (n === 2) return [-8.5, 7.2];
  return [-12.4, 0.6, 11.1];
}

function audioContextCtor(): typeof AudioContext {
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) throw new Error("Web Audio is not available");
  return Ctor;
}

export function createAudioContext(): AudioContext {
  const ctx = new (audioContextCtor())();
  try {
    const resume = ctx.resume();
    void resume;
  } catch {
    /* first click may still unlock on the next gesture */
  }
  return ctx;
}

export class SynthEngine {
  readonly ctx: AudioContext;
  readonly analyser: AnalyserNode;
  private readonly master: GainNode;
  private readonly dry: GainNode;
  private readonly hauntSend: GainNode;
  private readonly hauntMix: GainNode;
  private readonly delay: DelayNode;
  private readonly delayLp: BiquadFilterNode;
  private readonly delayFb: GainNode;
  private readonly flutter: OscillatorNode;
  private readonly flutterGain: GainNode;
  private readonly ringOsc: OscillatorNode;
  private readonly ringDepth: GainNode;
  private readonly ringGain: GainNode;
  private readonly whisper: AudioBufferSourceNode;
  private readonly whisperFilter: BiquadFilterNode;
  private readonly whisperGain: GainNode;
  private readonly tideA: OscillatorNode;
  private readonly tideB: OscillatorNode;
  private readonly tideC: OscillatorNode;
  private readonly tideD: OscillatorNode;
  private readonly swell: GainNode;
  private readonly bodyGain: GainNode;
  private readonly sprayGain: GainNode;
  private readonly bodyAmt: GainNode;
  private readonly sprayAmt: GainNode;
  private readonly waterDelay2: DelayNode;
  private readonly waterDelay2Mod: GainNode;
  private readonly waterDelay3: DelayNode;
  private readonly waterDelay3Mod: GainNode;
  private readonly waterDelay4: DelayNode;
  private readonly waterDelay4Mod: GainNode;
  private readonly waterRoom: DelayNode;
  private readonly waterRoomFb: GainNode;
  private readonly waterSend: GainNode;
  private readonly waterDelay: DelayNode;
  private readonly waterDelayMod: GainNode;
  private readonly waterMix: GainNode;
  private readonly airShelf: BiquadFilterNode;
  private readonly haunt2: DelayNode;
  private readonly haunt2Lp: BiquadFilterNode;
  private readonly flutter2: OscillatorNode;
  private readonly flutter2Gain: GainNode;
  private readonly rootOut: GainNode;
  private readonly rootDry: GainNode;
  private readonly rootWet: GainNode;
  private readonly rootBody: BiquadFilterNode;
  private readonly rootWood: BiquadFilterNode;
  private readonly rootBoard: BiquadFilterNode;
  private readonly rootHp: BiquadFilterNode;
  private readonly rootCave: DelayNode;
  private readonly rootCaveLp: BiquadFilterNode;
  private readonly rootCaveAmt: GainNode;
  private kind: "EARTH" | "WATER" | "FIRE" | "WIND" | null = null;
  private readonly aetherIn: GainNode;
  private readonly aetherDry: GainNode;
  private readonly aetherWet: GainNode;
  private readonly aetherOut: GainNode;
  private readonly crush: WaveShaperNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly clipper: WaveShaperNode;
  private aetherNode: AudioWorkletNode | null = null;
  private aetherWorkletFailed = false;
  private dying = 0;
  private recSamples = 0;
  private readonly bodyLp: BiquadFilterNode;
  private readonly sprayHp: BiquadFilterNode;
  private readonly voices = new Map<number, Voice>();
  private params: SynthParams = { ...DEFAULT_PARAMS };
  private noiseBuffer: AudioBuffer | null = null;
  private pulseWave: PeriodicWave | null = null;
  private recNode: AudioNode | null = null;
  private recChunks: Float32Array[] = [];
  private recWorkletReady = false;
  private recWorkletFailed = false;
  recording = false;
  readonly midiLog: MidiEvent[] = [];
  onNotes?: (notes: number[]) => void;

  constructor(ctx?: AudioContext) {
    this.ctx = ctx ?? createAudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.params.volume;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.35;

    this.dry = this.ctx.createGain();
    this.hauntSend = this.ctx.createGain();
    this.hauntSend.gain.value = 0;
    this.hauntMix = this.ctx.createGain();

    this.delay = this.ctx.createDelay(1.2);
    this.delay.delayTime.value = 0.33;
    this.delayLp = this.ctx.createBiquadFilter();
    this.delayLp.type = "lowpass";
    this.delayLp.frequency.value = 1800;
    this.delayFb = this.ctx.createGain();
    this.delayFb.gain.value = 0;

    this.flutter = this.ctx.createOscillator();
    this.flutter.frequency.value = 0.21;
    this.flutterGain = this.ctx.createGain();
    this.flutterGain.gain.value = 0;
    this.flutter.connect(this.flutterGain);
    this.flutterGain.connect(this.delay.delayTime);
    this.flutter.start();

    this.flutter2 = this.ctx.createOscillator();
    this.flutter2.frequency.value = 1.63;
    this.flutter2Gain = this.ctx.createGain();
    this.flutter2Gain.gain.value = 0;
    this.flutter2.connect(this.flutter2Gain);
    this.flutter2Gain.connect(this.delay.delayTime);
    this.flutter2.start();

    this.haunt2 = this.ctx.createDelay(1.2);
    this.haunt2.delayTime.value = 0.41;
    this.haunt2Lp = this.ctx.createBiquadFilter();
    this.haunt2Lp.type = "lowpass";
    this.haunt2Lp.frequency.value = 1640;

    this.ringOsc = this.ctx.createOscillator();
    this.ringOsc.type = "sine";
    this.ringOsc.frequency.value = 0.41;
    this.ringDepth = this.ctx.createGain();
    this.ringDepth.gain.value = 0;
    this.ringGain = this.ctx.createGain();
    this.ringGain.gain.value = 0;
    this.ringOsc.connect(this.ringDepth);
    this.ringDepth.connect(this.ringGain.gain);
    this.ringOsc.start();

    this.noiseBuffer = this.makeNoise();
    this.whisper = this.ctx.createBufferSource();
    this.whisper.buffer = this.noiseBuffer;
    this.whisper.loop = true;
    this.whisperFilter = this.ctx.createBiquadFilter();
    this.whisperFilter.type = "bandpass";
    this.whisperFilter.frequency.value = 2100;
    this.whisperFilter.Q.value = 1.15;
    this.whisperGain = this.ctx.createGain();
    this.whisperGain.gain.value = 0;
    this.whisper.connect(this.whisperFilter);
    this.whisperFilter.connect(this.whisperGain);
    this.whisper.start();

    const swellCurve = this.makeWaveCurve();
    this.tideA = this.ctx.createOscillator();
    this.tideA.type = "sine";
    this.tideA.frequency.value = 0.11;
    this.tideB = this.ctx.createOscillator();
    this.tideB.type = "sine";
    this.tideB.frequency.value = 0.173;
    this.tideC = this.ctx.createOscillator();
    this.tideC.type = "sine";
    this.tideC.frequency.value = 0.241;
    this.tideD = this.ctx.createOscillator();
    this.tideD.type = "sine";
    this.tideD.frequency.value = 0.083;
    this.swell = this.ctx.createGain();
    this.swell.gain.value = 1;
    this.tideA.connect(this.swell);
    this.tideB.connect(this.swell);
    this.tideA.start();
    this.tideB.start();
    this.tideC.start();
    this.tideD.start();

    this.bodyLp = this.ctx.createBiquadFilter();
    this.bodyLp.type = "lowpass";
    this.bodyLp.frequency.value = 14000;
    this.bodyLp.Q.value = 0.52;
    this.sprayHp = this.ctx.createBiquadFilter();
    this.sprayHp.type = "peaking";
    this.sprayHp.frequency.value = 225;
    this.sprayHp.Q.value = 0.72;
    this.sprayHp.gain.value = 0;
    this.airShelf = this.ctx.createBiquadFilter();
    this.airShelf.type = "highshelf";
    this.airShelf.frequency.value = 5400;
    this.airShelf.gain.value = 0;

    this.bodyGain = this.ctx.createGain();
    this.bodyGain.gain.value = 0;
    this.bodyAmt = this.ctx.createGain();
    this.bodyAmt.gain.value = 0;
    this.sprayGain = this.ctx.createGain();
    this.sprayGain.gain.value = 0;
    this.sprayAmt = this.ctx.createGain();
    this.sprayAmt.gain.value = 0;

    const sat = this.ctx.createWaveShaper();
    sat.curve = swellCurve as unknown as Float32Array<ArrayBuffer>;
    sat.oversample = "2x";

    this.waterSend = this.ctx.createGain();
    this.waterSend.gain.value = 0;
    this.waterDelay = this.ctx.createDelay(0.12);
    this.waterDelay.delayTime.value = 0.016;
    this.waterDelayMod = this.ctx.createGain();
    this.waterDelayMod.gain.value = 0;
    this.waterDelay2 = this.ctx.createDelay(0.14);
    this.waterDelay2.delayTime.value = 0.011;
    this.waterDelay2Mod = this.ctx.createGain();
    this.waterDelay2Mod.gain.value = 0;
    this.waterDelay3 = this.ctx.createDelay(0.14);
    this.waterDelay3.delayTime.value = 0.016;
    this.waterDelay3Mod = this.ctx.createGain();
    this.waterDelay3Mod.gain.value = 0;
    this.waterDelay4 = this.ctx.createDelay(0.14);
    this.waterDelay4.delayTime.value = 0.021;
    this.waterDelay4Mod = this.ctx.createGain();
    this.waterDelay4Mod.gain.value = 0;
    this.waterRoom = this.ctx.createDelay(0.3);
    this.waterRoom.delayTime.value = 0.082;
    this.waterRoomFb = this.ctx.createGain();
    this.waterRoomFb.gain.value = 0;
    this.waterMix = this.ctx.createGain();
    this.waterMix.gain.value = 0.32;

    this.aetherIn = this.ctx.createGain();
    this.aetherDry = this.ctx.createGain();
    this.aetherDry.gain.value = 1;
    this.aetherWet = this.ctx.createGain();
    this.aetherWet.gain.value = 0;
    this.aetherOut = this.ctx.createGain();
    this.crush = this.ctx.createWaveShaper();
    this.crush.oversample = "none";
    this.crush.curve = this.makeCrushCurve(0) as unknown as Float32Array<ArrayBuffer>;

    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 10;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.14;
    this.clipper = this.ctx.createWaveShaper();
    this.clipper.oversample = "2x";
    this.clipper.curve = this.makeClipCurve() as unknown as Float32Array<ArrayBuffer>;

    this.rootHp = this.ctx.createBiquadFilter();
    this.rootHp.type = "highpass";
    this.rootHp.frequency.value = 28;
    this.rootHp.Q.value = 0.55;
    this.rootBody = this.ctx.createBiquadFilter();
    this.rootBody.type = "peaking";
    this.rootBody.frequency.value = 92;
    this.rootBody.Q.value = 1.05;
    this.rootBody.gain.value = 4.4;
    this.rootWood = this.ctx.createBiquadFilter();
    this.rootWood.type = "peaking";
    this.rootWood.frequency.value = 218;
    this.rootWood.Q.value = 0.82;
    this.rootWood.gain.value = 3.3;
    this.rootBoard = this.ctx.createBiquadFilter();
    this.rootBoard.type = "peaking";
    this.rootBoard.frequency.value = 465;
    this.rootBoard.Q.value = 0.7;
    this.rootBoard.gain.value = 2.2;
    const rootSat = this.ctx.createWaveShaper();
    rootSat.curve = this.makeClipCurve() as unknown as Float32Array<ArrayBuffer>;
    rootSat.oversample = "2x";
    this.rootDry = this.ctx.createGain();
    this.rootDry.gain.value = 1;
    this.rootWet = this.ctx.createGain();
    this.rootWet.gain.value = 0;
    this.rootOut = this.ctx.createGain();
    this.rootCave = this.ctx.createDelay(0.08);
    this.rootCave.delayTime.value = 0.024;
    this.rootCaveLp = this.ctx.createBiquadFilter();
    this.rootCaveLp.type = "lowpass";
    this.rootCaveLp.frequency.value = 1180;
    this.rootCaveAmt = this.ctx.createGain();
    this.rootCaveAmt.gain.value = 0;

    this.master.connect(this.rootHp);
    this.rootHp.connect(this.rootDry);
    this.rootDry.connect(this.rootOut);
    this.rootHp.connect(this.rootBody);
    this.rootBody.connect(this.rootWood);
    this.rootWood.connect(this.rootBoard);
    this.rootBoard.connect(rootSat);
    rootSat.connect(this.rootWet);
    this.rootWet.connect(this.rootOut);
    rootSat.connect(this.rootCave);
    this.rootCave.connect(this.rootCaveLp);
    this.rootCaveLp.connect(this.rootCaveAmt);
    this.rootCaveAmt.connect(this.rootOut);

    this.rootOut.connect(this.waterSend);
    this.waterSend.connect(this.bodyLp);
    this.bodyLp.connect(this.sprayHp);
    this.sprayHp.connect(this.airShelf);
    this.airShelf.connect(sat);
    sat.connect(this.waterDelay);
    sat.connect(this.waterDelay2);
    sat.connect(this.waterDelay3);
    sat.connect(this.waterDelay4);
    sat.connect(this.waterRoom);
    this.waterDelay.connect(this.waterMix);
    this.waterDelay2.connect(this.waterMix);
    this.waterDelay3.connect(this.waterMix);
    this.waterDelay4.connect(this.waterMix);
    this.waterRoom.connect(this.waterMix);
    this.waterRoom.connect(this.waterRoomFb);
    this.waterRoomFb.connect(this.waterRoom);
    this.tideA.connect(this.waterDelayMod);
    this.waterDelayMod.connect(this.waterDelay.delayTime);
    this.tideB.connect(this.waterDelay2Mod);
    this.waterDelay2Mod.connect(this.waterDelay2.delayTime);
    this.tideC.connect(this.waterDelay3Mod);
    this.waterDelay3Mod.connect(this.waterDelay3.delayTime);
    this.tideD.connect(this.waterDelay4Mod);
    this.waterDelay4Mod.connect(this.waterDelay4.delayTime);

    this.rootOut.connect(this.dry);
    this.dry.connect(this.aetherIn);

    this.rootOut.connect(this.hauntSend);
    this.hauntSend.connect(this.delay);
    this.delay.connect(this.delayLp);
    this.delayLp.connect(this.delayFb);
    this.delayFb.connect(this.delay);
    this.delayLp.connect(this.hauntMix);
    this.hauntSend.connect(this.haunt2);
    this.haunt2.connect(this.haunt2Lp);
    this.haunt2Lp.connect(this.hauntMix);
    this.flutter2Gain.connect(this.haunt2.delayTime);

    this.rootOut.connect(this.ringGain);
    this.ringGain.connect(this.hauntMix);
    this.whisperGain.connect(this.hauntMix);
    this.waterMix.connect(this.hauntMix);
    this.hauntMix.connect(this.aetherIn);

    this.aetherIn.connect(this.aetherDry);
    this.aetherDry.connect(this.aetherOut);
    this.aetherIn.connect(this.crush);
    this.crush.connect(this.aetherWet);
    this.aetherWet.connect(this.aetherOut);
    this.aetherOut.connect(this.limiter);
    this.limiter.connect(this.clipper);
    this.clipper.connect(this.analyser);

    this.analyser.connect(this.ctx.destination);
    this.pulseWave = this.makePulse(this.params.pulseWidth);
    this.applyHalloween(this.params.halloween, this.ctx.currentTime);
    this.applyWaters(this.params.waters, this.ctx.currentTime);
    this.applyMix(this.ctx.currentTime);
    this.applyAether(this.params.aether, this.ctx.currentTime);
    window.setTimeout(() => void this.installAether(), 0);
  }

  get sampleRate(): number {
    return this.ctx.sampleRate;
  }

  get isRunning(): boolean {
    return this.ctx.state === "running";
  }

  async resume(): Promise<void> {
    if (this.ctx.state === "running") return;
    try {
      await Promise.race([
        this.ctx.resume(),
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, 800);
        }),
      ]);
    } catch {
      /* overlay already dismissed; later notes call resume again */
    }
  }

  setParams(partial: Partial<SynthParams>) {
    this.params = { ...this.params, ...partial };
    const now = this.ctx.currentTime;
    if (partial.pulseWidth !== undefined) {
      this.pulseWave = this.makePulse(this.params.pulseWidth);
    }
    this.applyMix(now);
    if (partial.halloween !== undefined) this.applyHalloween(this.params.halloween, now);
    if (partial.waters !== undefined || partial.cutoff !== undefined) {
      this.applyWaters(this.params.waters, now);
    }
    if (partial.aether !== undefined) this.applyAether(this.params.aether, now);
    const h = this.params.halloween;
    for (const voice of this.voices.values()) {
      voice.filter.type = this.params.filterType;
      voice.filter.frequency.setTargetAtTime(this.filterFreq(), now, 0.02);
      voice.filter.Q.setTargetAtTime(this.filterQ(), now, 0.02);
      voice.driftGain?.gain.setTargetAtTime(4.2 + h * 28, now, 0.04);
      for (const g of voice.driftGains) g.gain.setTargetAtTime(4.2 + h * 28, now, 0.04);
      voice.ghostGain?.gain.setTargetAtTime(h * 0.16, now, 0.04);
      const oscs = [voice.osc, ...voice.unison];
      for (const o of oscs) {
        if (
          partial.waveform &&
          o instanceof OscillatorNode &&
          this.isStandardWave(partial.waveform)
        ) {
          o.type = partial.waveform;
        }
        if (
          partial.pulseWidth !== undefined &&
          this.params.waveform === "pulse" &&
          o instanceof OscillatorNode &&
          this.pulseWave
        ) {
          o.setPeriodicWave(this.pulseWave);
        }
      }
    }
  }

  setKind(kind: "EARTH" | "WATER" | "FIRE" | "WIND" | null) {
    this.kind = kind;
    const now = this.ctx.currentTime;
    const on = kind === "EARTH" ? 1 : 0;
    this.rootDry.gain.setTargetAtTime(1 - on, now, 0.05);
    this.rootWet.gain.setTargetAtTime(on, now, 0.05);
    this.rootCaveAmt.gain.setTargetAtTime(on * 0.22, now, 0.05);
    for (const voice of this.voices.values()) {
      voice.subGain?.gain.setTargetAtTime(on * 0.24, now, 0.04);
    }
  }

  noteOn(midi: number, velocity = 0.85) {
    const now = this.ctx.currentTime;
    const existing = this.voices.get(midi);
    if (existing) {
      existing.releasing = true;
      const eg = existing.amp.gain;
      const cur = finite(eg.value, 0.0001);
      eg.cancelScheduledValues(now);
      eg.setValueAtTime(Math.max(cur, 0.0001), now);
      eg.setTargetAtTime(0.0001, now, 0.006);
      this.voices.delete(midi);
      this.releaseVoice(existing, 36);
    }
    if (this.voices.size >= MAX_VOICES) this.stealOldest(now);

    const freq = clamp(midiToFreq(midi), 20, this.ctx.sampleRate * 0.4);
    const h = this.params.halloween;
    const filter = this.ctx.createBiquadFilter();
    filter.type = this.params.filterType;
    filter.frequency.value = this.filterFreq();
    filter.Q.value = this.filterQ();

    const amp = this.ctx.createGain();
    amp.gain.value = 0.0001;

    const count =
      this.params.waveform === "noise" ? 1 : Math.max(1, Math.min(3, Math.round(this.params.unison)));
    const cents = unisonCents(count);
    const osc = this.createSource(freq, cents[0] ?? 0);
    osc.connect(filter);
    const extra: OscillatorNode[] = [];
    const drifts: OscillatorNode[] = [];
    const driftGains: GainNode[] = [];
    for (let i = 1; i < count; i++) {
      const u = this.createSource(freq, cents[i] ?? 0);
      if (u instanceof OscillatorNode) {
        u.connect(filter);
        extra.push(u);
      } else {
        u.disconnect();
        u.stop();
      }
    }
    filter.connect(amp);
    amp.connect(this.master);

    const vel = Math.max(0.05, Math.min(1, velocity));
    const peak = (vel * (this.kind === "EARTH" ? 0.82 : 0.72)) / Math.sqrt(count);
    const a = Math.max(0.001, this.params.attack);
    const d = Math.max(0.008, this.params.decay);
    const s = Math.max(0.0001, peak * this.params.sustain);
    amp.gain.cancelScheduledValues(now);
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.setTargetAtTime(peak, now, a / 3);
    amp.gain.setTargetAtTime(s, now + a, d / 3);

    const voice: Voice = {
      midi,
      startedAt: now,
      osc,
      unison: extra,
      drifts,
      driftGains,
      filter,
      amp,
      releasing: false,
    };
    if (osc instanceof OscillatorNode) {
      const drifted = this.startDrift(osc, h);
      voice.drift = drifted.lfo;
      voice.driftGain = drifted.gain;
      for (const u of extra) {
        const d2 = this.startDrift(u, h);
        drifts.push(d2.lfo);
        driftGains.push(d2.gain);
      }
      const ghost = this.startGhost(freq, filter, h);
      voice.ghost = ghost.osc;
      voice.ghostGain = ghost.gain;
      const sub = this.startSub(freq, filter);
      voice.sub = sub.osc;
      voice.subGain = sub.gain;
    }
    this.voices.set(midi, voice);
    this.midiLog.push({ t: now, type: "on", midi, vel });
    this.emitNotes();
  }

  noteOff(midi: number) {
    const voice = this.voices.get(midi);
    if (!voice || voice.releasing) return;
    const now = this.ctx.currentTime;
    voice.releasing = true;
    const r = this.params.release + this.params.halloween * 0.58;
    const g = voice.amp.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(g.value, 0.0001), now);
    g.setTargetAtTime(0.0001, now, Math.max(0.008, r / 3));
    this.midiLog.push({ t: now, type: "off", midi, vel: 0 });
    window.setTimeout(
      () => {
        this.killVoice(voice, this.ctx.currentTime);
        if (this.voices.get(midi) === voice) this.voices.delete(midi);
        this.emitNotes();
      },
      Math.max(30, r * 1000 + 40),
    );
    this.emitNotes();
  }

  panic() {
    const now = this.ctx.currentTime;
    for (const [midi, voice] of this.voices) {
      this.killVoice(voice, now);
      this.voices.delete(midi);
    }
    this.emitNotes();
  }

  async startRecording(): Promise<boolean> {
    if (this.recording) return true;
    await this.ensureRecorder();
    if (!this.recNode) this.attachScriptRecorder();
    if (!this.recNode) return false;
    this.recChunks = [];
    this.recSamples = 0;
    this.recording = true;
    return true;
  }

  stopRecording(): Blob | null {
    const take = this.stopRecordingPcm();
    if (!take) return null;
    return encodeWav(take.samples, take.sampleRate);
  }

  stopRecordingPcm(): { samples: Float32Array; sampleRate: number } | null {
    this.recording = false;
    if (this.recChunks.length === 0) return null;
    const samples = concatFloat32(this.recChunks);
    this.recChunks = [];
    return { samples, sampleRate: this.ctx.sampleRate };
  }

  private applyMix(now: number) {
    const h = clamp(this.params.halloween, 0, 1);
    const t = clamp(this.params.waters, 0, 1);
    const a = clamp(this.params.aether, 0, 1);
    const vol = clamp(this.params.volume, 0, 1);
    const makeup = 1 / (1 + h * 0.12 + t * 0.1 + a * 0.08);
    this.master.gain.setTargetAtTime(vol * makeup, now, 0.05);
    this.dry.gain.setTargetAtTime((1 - h * 0.1) * (1 - t * 0.12), now, 0.05);
    this.hauntSend.gain.setTargetAtTime(h * 0.36, now, 0.05);
    this.waterSend.gain.setTargetAtTime(t * (0.52 + t * 0.38), now, 0.06);
  }

  private applyHalloween(h: number, now: number) {
    this.applyMix(now);
    this.delayFb.gain.setTargetAtTime(h * 0.56, now, 0.05);
    this.delay.delayTime.setTargetAtTime(0.38 + h * 0.26, now, 0.08);
    this.haunt2.delayTime.setTargetAtTime((0.38 + h * 0.26) * 1.073, now, 0.08);
    this.flutterGain.gain.setTargetAtTime(h * 0.0048, now, 0.05);
    this.flutter2Gain.gain.setTargetAtTime(h * 0.0017, now, 0.05);
    this.ringDepth.gain.setTargetAtTime(h * 0.12, now, 0.04);
    this.whisperGain.gain.setTargetAtTime(h * 0.038, now, 0.05);
    this.delayLp.frequency.setTargetAtTime(this.safeFreq(1880 - h * 780), now, 0.06);
    this.haunt2Lp.frequency.setTargetAtTime(this.safeFreq(1640 - h * 720), now, 0.06);
    this.ringOsc.frequency.setTargetAtTime(0.37 + h * 0.11, now, 0.08);
  }

  private applyWaters(w: number, now: number) {
    const t = Math.max(0, Math.min(1, w));
    this.applyMix(now);
    this.bodyLp.frequency.setTargetAtTime(this.safeFreq(14000 * Math.pow(2150 / 14000, t * 0.78)), now, 0.1);
    this.bodyLp.Q.setTargetAtTime(0.52 + t * 0.28, now, 0.1);
    this.sprayHp.frequency.setTargetAtTime(225 + t * 55, now, 0.1);
    this.sprayHp.gain.setTargetAtTime(t * 2.35, now, 0.1);
    this.airShelf.gain.setTargetAtTime(t * 3.1, now, 0.1);
    this.waterDelay.delayTime.setTargetAtTime(0.0076 + t * 0.0038, now, 0.12);
    this.waterDelayMod.gain.setTargetAtTime(t * 0.0026, now, 0.12);
    this.waterDelay2.delayTime.setTargetAtTime(0.0114 + t * 0.0046, now, 0.12);
    this.waterDelay2Mod.gain.setTargetAtTime(t * 0.0031, now, 0.12);
    this.waterDelay3.delayTime.setTargetAtTime(0.0158 + t * 0.0042, now, 0.12);
    this.waterDelay3Mod.gain.setTargetAtTime(t * 0.0023, now, 0.12);
    this.waterDelay4.delayTime.setTargetAtTime(0.0214 + t * 0.0055, now, 0.12);
    this.waterDelay4Mod.gain.setTargetAtTime(t * 0.0034, now, 0.12);
    this.waterRoom.delayTime.setTargetAtTime(0.082 + t * 0.048, now, 0.14);
    this.waterRoomFb.gain.setTargetAtTime(t * 0.28, now, 0.1);
    this.tideA.frequency.setTargetAtTime(0.11 + t * 0.07, now, 0.14);
    this.tideB.frequency.setTargetAtTime(0.173 + t * 0.09, now, 0.14);
    this.tideC.frequency.setTargetAtTime(0.241 + t * 0.055, now, 0.14);
    this.tideD.frequency.setTargetAtTime(0.083 + t * 0.12, now, 0.14);
  }

  private applyAether(a: number, now: number) {
    this.applyMix(now);
    const t = Math.max(0, Math.min(1, a));
    const param = this.aetherNode?.parameters.get("amount");
    if (param) {
      param.setTargetAtTime(t, now, 0.05);
      this.aetherDry.gain.setTargetAtTime(0, now, 0.04);
      this.aetherWet.gain.setTargetAtTime(0, now, 0.04);
      return;
    }
    this.crush.curve = this.makeCrushCurve(t) as unknown as Float32Array<ArrayBuffer>;
    this.aetherDry.gain.setTargetAtTime(1 - t * 0.32, now, 0.05);
    this.aetherWet.gain.setTargetAtTime(t * 0.94, now, 0.05);
  }

  private makeCrushCurve(amount: number): Float32Array {
    const n = 2048;
    const curve = new Float32Array(n);
    const bits = 8.5 - amount * 5.2;
    const levels = Math.pow(2, bits - 1);
    const dead = amount * 0.045;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      if (Math.abs(x) < dead) curve[i] = 0;
      else curve[i] = Math.round(x * levels) / levels;
    }
    return curve;
  }

  private async installAether() {
    if (this.aetherNode || this.aetherWorkletFailed) return;
    try {
      const blob = new Blob([AETHER_PROCESSOR], { type: "text/javascript" });
      const url = URL.createObjectURL(blob);
      await this.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(this.ctx, "forge-aether", {
        parameterData: { amount: this.params.aether },
      });
      try {
        this.aetherIn.disconnect();
        this.crush.disconnect();
        this.aetherDry.disconnect();
        this.aetherWet.disconnect();
      } catch {
        /* already torn down */
      }
      this.aetherIn.connect(node);
      node.connect(this.aetherOut);
      this.aetherNode = node;
      this.applyAether(this.params.aether, this.ctx.currentTime);
    } catch {
      this.aetherWorkletFailed = true;
    }
  }

  private filterFreq(): number {
    const h = this.params.halloween;
    return this.safeFreq(this.params.cutoff * (1 - h * 0.18));
  }

  private filterQ(): number {
    const h = this.params.halloween;
    const f = this.filterFreq();
    const nyq = this.ctx.sampleRate * 0.45;
    const edge = clamp(Math.min(f / 90, (nyq - f) / 500), 0.25, 1);
    const raw = this.params.resonance * (1 + h * 0.16);
    return clamp(raw * (0.4 + 0.6 * edge), 0.0001, 8.5);
  }

  private safeFreq(hz: number): number {
    return clamp(hz, 30, this.ctx.sampleRate * 0.45);
  }

  private makeClipCurve(): Float32Array {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.2);
    }
    return curve;
  }

  private releaseVoice(voice: Voice, waitMs: number) {
    if (this.dying >= MAX_DYING) {
      this.killVoice(voice, this.ctx.currentTime);
      return;
    }
    this.dying += 1;
    window.setTimeout(() => {
      this.dying = Math.max(0, this.dying - 1);
      this.killVoice(voice, this.ctx.currentTime);
    }, waitMs);
  }

  private makeWaveCurve(): Float32Array {
    const n = 2048;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.65);
    }
    return curve;
  }

  private async ensureRecorder() {
    if (this.recNode) return;
    if (!this.recWorkletFailed) {
      try {
        if (!this.recWorkletReady) {
          const blob = new Blob([REC_PROCESSOR], { type: "text/javascript" });
          const url = URL.createObjectURL(blob);
          await this.ctx.audioWorklet.addModule(url);
          URL.revokeObjectURL(url);
          this.recWorkletReady = true;
        }
        const node = new AudioWorkletNode(this.ctx, "forge-rec");
        node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
          if (!this.recording || !ev.data) return;
          this.recSamples += ev.data.length;
          if (this.recSamples > this.ctx.sampleRate * 32) return;
          this.recChunks.push(ev.data);
        };
        this.analyser.connect(node);
        const mute = this.ctx.createGain();
        mute.gain.value = 0;
        node.connect(mute);
        mute.connect(this.ctx.destination);
        this.recNode = node;
        return;
      } catch {
        this.recWorkletFailed = true;
      }
    }
    this.attachScriptRecorder();
  }

  private attachScriptRecorder() {
    if (this.recNode) return;
    const Ctor = (
      this.ctx as AudioContext & {
        createScriptProcessor?: (s: number, i: number, o: number) => ScriptProcessorNode;
      }
    ).createScriptProcessor;
    if (!Ctor) return;
    const proc = Ctor.call(this.ctx, 2048, 1, 1);
    proc.onaudioprocess = (e) => {
      if (!this.recording) return;
      const ch = e.inputBuffer.getChannelData(0);
      if (!ch.length) return;
      this.recSamples += ch.length;
      if (this.recSamples > this.ctx.sampleRate * 32) return;
      this.recChunks.push(new Float32Array(ch));
    };
    this.analyser.connect(proc);
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    proc.connect(mute);
    mute.connect(this.ctx.destination);
    this.recNode = proc;
  }

  private isStandardWave(
    wave: Waveform,
  ): wave is "sine" | "square" | "sawtooth" | "triangle" {
    return (
      wave === "sine" ||
      wave === "square" ||
      wave === "sawtooth" ||
      wave === "triangle"
    );
  }

  private createSource(freq: number, cents = 0): OscillatorNode | AudioBufferSourceNode {
    const wave = this.params.waveform;
    if (wave === "noise") {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      src.start();
      return src;
    }
    const osc = this.ctx.createOscillator();
    osc.frequency.value = freq;
    osc.detune.value = cents;
    if (wave === "pulse" && this.pulseWave) osc.setPeriodicWave(this.pulseWave);
    else if (this.isStandardWave(wave)) osc.type = wave;
    osc.start();
    return osc;
  }

  private startDrift(osc: OscillatorNode, halloween: number): { lfo: OscillatorNode; gain: GainNode } {
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.21 + Math.random() * 0.17 + halloween * 1.5;
    const gain = this.ctx.createGain();
    gain.gain.value = 4.2 + halloween * 28;
    lfo.connect(gain);
    gain.connect(osc.detune);
    lfo.start();
    return { lfo, gain };
  }

  private startGhost(
    freq: number,
    dest: AudioNode,
    halloween: number,
  ): { osc: OscillatorNode; gain: GainNode } {
    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq * 1.0064;
    const gain = this.ctx.createGain();
    gain.gain.value = halloween * 0.16;
    osc.connect(gain);
    gain.connect(dest);
    osc.start();
    return { osc, gain };
  }

  private startSub(freq: number, dest: AudioNode): { osc: OscillatorNode; gain: GainNode } {
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq * 0.5;
    const gain = this.ctx.createGain();
    gain.gain.value = this.kind === "EARTH" ? 0.24 : 0;
    osc.connect(gain);
    gain.connect(dest);
    osc.start();
    return { osc, gain };
  }

  private stealOldest(now: number) {
    let oldest: Voice | undefined;
    for (const v of this.voices.values()) {
      if (!oldest || v.startedAt < oldest.startedAt) oldest = v;
    }
    if (!oldest) return;
    this.killVoice(oldest, now);
    this.voices.delete(oldest.midi);
  }

  private killVoice(voice: Voice, now: number) {
    try {
      voice.amp.gain.cancelScheduledValues(now);
      voice.amp.gain.setTargetAtTime(0, now, 0.004);
      voice.osc.stop(now + 0.03);
      for (const u of voice.unison) u.stop(now + 0.03);
      voice.drift?.stop(now + 0.03);
      for (const d of voice.drifts) d.stop(now + 0.03);
      voice.ghost?.stop(now + 0.03);
      voice.sub?.stop(now + 0.03);
    } catch {
      /* already stopped */
    }
    window.setTimeout(() => {
      try {
        voice.osc.disconnect();
        for (const u of voice.unison) u.disconnect();
        voice.filter.disconnect();
        voice.amp.disconnect();
        voice.drift?.disconnect();
        voice.driftGain?.disconnect();
        for (const d of voice.drifts) d.disconnect();
        for (const g of voice.driftGains) g.disconnect();
        voice.ghost?.disconnect();
        voice.ghostGain?.disconnect();
        voice.sub?.disconnect();
        voice.subGain?.disconnect();
      } catch {
        /* noop */
      }
    }, 80);
  }

  private makeNoise(): AudioBuffer {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private makePulse(width: number): PeriodicWave {
    const n = 64;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    const w = Math.max(0.05, Math.min(0.5, width));
    for (let i = 1; i < n; i++) {
      imag[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * w);
    }
    return this.ctx.createPeriodicWave(real, imag);
  }

  private emitNotes() {
    const notes: number[] = [];
    for (const v of this.voices.values()) {
      if (!v.releasing) notes.push(v.midi);
    }
    this.onNotes?.(notes);
  }
}

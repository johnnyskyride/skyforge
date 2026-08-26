export const WAVEFORMS = [
  "sine",
  "triangle",
  "sawtooth",
  "square",
  "pulse",
  "noise",
] as const;

export type Waveform = (typeof WAVEFORMS)[number];

export const FILTER_TYPES = ["lowpass", "highpass", "bandpass"] as const;
export type FilterType = (typeof FILTER_TYPES)[number];

export type SynthParams = {
  waveform: Waveform;
  pulseWidth: number;
  filterType: FilterType;
  cutoff: number;
  resonance: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  octave: number;
  volume: number;
  halloween: number;
  waters: number;
  aether: number;
  unison: number;
  twin: number;
  twinInterval: number;
};

export const DEFAULT_PARAMS: SynthParams = {
  waveform: "sawtooth",
  pulseWidth: 0.25,
  filterType: "lowpass",
  cutoff: 1400,
  resonance: 2.2,
  attack: 0.008,
  decay: 0.22,
  sustain: 0.72,
  release: 0.28,
  octave: 0,
  volume: 0.84,
  halloween: 0,
  waters: 0,
  aether: 0,
  unison: 2,
  twin: 0,
  twinInterval: 7,
};

export const PARAM_RANGE = {
  pulseWidth: { min: 0.05, max: 0.5 },
  cutoff: { min: 40, max: 16000, log: true },
  resonance: { min: 0.1, max: 18 },
  attack: { min: 0.001, max: 4, log: true },
  decay: { min: 0.01, max: 4, log: true },
  sustain: { min: 0, max: 1 },
  release: { min: 0.01, max: 8, log: true },
  octave: { min: -2, max: 2, step: 1 },
  volume: { min: 0, max: 1 },
  halloween: { min: 0, max: 1 },
  waters: { min: 0, max: 1 },
  aether: { min: 0, max: 1 },
  unison: { min: 1, max: 3, step: 1 },
  twin: { min: 0, max: 1 },
  twinInterval: { min: -24, max: 24, step: 1 },
} as const;

export type MidiEvent = {
  t: number;
  type: "on" | "off";
  midi: number;
  vel: number;
};

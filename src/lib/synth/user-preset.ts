import {
  FILTER_TYPES,
  WAVEFORMS,
  type FilterType,
  type SynthParams,
  type Waveform,
} from "./types";
import type { DragonElement } from "./dragon-summon";

export const USER_PRESET_KEY = "skyforge.userPresets";
export const SCALE_KEY = "skyforge.scale";
export const SCALE_STOPS = [0.75, 1, 1.25, 1.5, 2] as const;
export type FaceScale = (typeof SCALE_STOPS)[number];
export type ChassisSkin = "forge" | "rack";
export type TrimMode = "off" | "plasma" | "purple" | "green";

export type UserBank = {
  skyforge: 1;
  id: string;
  name: string;
  params: SynthParams;
  skin: ChassisSkin;
  trim: TrimMode;
  kind: DragonElement | null;
};

const FALLBACK_PARAMS: SynthParams = {
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

function num(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

export function snapScale(raw: number): FaceScale {
  let best: FaceScale = 1;
  let dist = Infinity;
  for (const s of SCALE_STOPS) {
    const d = Math.abs(s - raw);
    if (d < dist) {
      dist = d;
      best = s;
    }
  }
  return best;
}

export function parseBank(raw: unknown, fallback: SynthParams = FALLBACK_PARAMS): UserBank | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim().slice(0, 32) : "";
  if (!name) return null;
  const src = (o.params && typeof o.params === "object" ? o.params : o) as Record<string, unknown>;
  const waveform = WAVEFORMS.includes(src.waveform as Waveform) ? (src.waveform as Waveform) : fallback.waveform;
  const filterType = FILTER_TYPES.includes(src.filterType as FilterType)
    ? (src.filterType as FilterType)
    : fallback.filterType;
  const skin: ChassisSkin = o.skin === "rack" ? "rack" : "forge";
  const trim: TrimMode =
    o.trim === "plasma" || o.trim === "purple" || o.trim === "green" || o.trim === "off" ? o.trim : "off";
  const kindRaw = typeof o.kind === "string" ? o.kind.toUpperCase() : "";
  const kind: DragonElement | null =
    kindRaw === "EARTH" || kindRaw === "WATER" || kindRaw === "FIRE" || kindRaw === "WIND"
      ? kindRaw
      : null;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28);
  const id = typeof o.id === "string" && o.id ? o.id.slice(0, 40) : `u-${slug || "bank"}`;
  return {
    skyforge: 1,
    id,
    name,
    skin,
    trim,
    kind,
    params: {
      waveform,
      pulseWidth: num(src.pulseWidth, fallback.pulseWidth),
      filterType,
      cutoff: num(src.cutoff, fallback.cutoff),
      resonance: num(src.resonance, fallback.resonance),
      attack: num(src.attack, fallback.attack),
      decay: num(src.decay, fallback.decay),
      sustain: num(src.sustain, fallback.sustain),
      release: num(src.release, fallback.release),
      octave: Math.round(num(src.octave, fallback.octave)),
      volume: num(src.volume, fallback.volume),
      halloween: num(src.halloween, fallback.halloween),
      waters: num(src.waters, fallback.waters),
      aether: num(src.aether, fallback.aether),
      unison: Math.round(num(src.unison, fallback.unison)),
      twin: num(src.twin, fallback.twin),
      twinInterval: Math.round(num(src.twinInterval, fallback.twinInterval)),
    },
  };
}

export function serializeBank(bank: UserBank): string {
  return JSON.stringify(bank, null, 2);
}

export function parseBanksJson(raw: string, fallback: SynthParams = FALLBACK_PARAMS): UserBank[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: UserBank[] = [];
    for (const row of parsed) {
      const bank = parseBank(row, fallback);
      if (bank) out.push(bank);
    }
    return out.slice(0, 24);
  } catch {
    return [];
  }
}

export function loadUserPresets(): UserBank[] {
  try {
    return parseBanksJson(localStorage.getItem(USER_PRESET_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function storeUserPresets(list: UserBank[]) {
  try {
    localStorage.setItem(USER_PRESET_KEY, JSON.stringify(list.slice(0, 24)));
  } catch {
    /* private */
  }
}

export function slugBank(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28);
  return s || "preset";
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Circle, Clapperboard, Download, HardDriveDownload, Minus, Plus, Power } from "lucide-react";
import { SynthEngine, createAudioContext } from "@/lib/synth/engine";
import { computerKeyOffset, isLivePassthroughKey } from "@/lib/synth/keyboard-map";
import { renderSkyForgeClip, CLIP_MAX_SEC, BOUNCE_MAX_SEC, formatXHandle } from "@/lib/synth/clip-video";
import { encodeWav } from "@/lib/synth/wav";
import { encodeMp3 } from "@/lib/synth/mp3";
import { shareWyrmOnX } from "@/lib/synth/share-x";
import { encodeMidiFile } from "@/lib/synth/midi-file";
import { formatDb, formatHz, formatTime, midiToName } from "@/lib/synth/notes";
import { saveSkyForgeOffline } from "@/lib/synth/offline-file";
import { PRESETS } from "@/lib/synth/presets";
import {
  DEFAULT_PARAMS,
  PARAM_RANGE,
  type MidiEvent,
  type FilterType,
  type SynthParams,
  type Waveform,
} from "@/lib/synth/types";
import { KIND_VOICE } from "@/lib/synth/kind-voice";
import type { DragonElement } from "@/lib/synth/dragon-summon";
import { cn } from "@/lib/utils";
import { ArmGate } from "./arm-gate";
import { DragonEtch } from "./dragon-etch";
import { Knob } from "./knob";
import { Piano } from "./piano";
import { LevelMeter, Oscilloscope } from "./scope";
import { SummonWell } from "./summon-well";
import { loadWyrms, pushWyrm, type WyrmRecord } from "@/lib/synth/wyrm-log";
import { WyrmLog, WyrmPreview, WyrmSaveCard } from "./wyrm-log";
import { FilterBank, KindBank, WaveBank } from "./wave-bank";
import { TrimDeck, ChassisTube, type TrimMode } from "./trim-deck";
import {
  isLiveHost,
  LiveMeter,
  onPluginMessage,
  sendToPlugin,
  decodeClipChunk,
  assembleClipPcm,
  mergeLiveParams,
  saveToPlugin,
  type ScopeMeter,
} from "@/lib/synth/scope-meter";
import type { ClipTake } from "@/lib/synth/clip-video";
import { OptionsMenu } from "./options-menu";
import { PresetSelect } from "./preset-select";
import {
  loadUserPresets,
  parseBank,
  parseBanksJson,
  SCALE_KEY,
  serializeBank,
  slugBank,
  snapScale,
  storeUserPresets,
  type FaceScale,
  type UserBank,
} from "@/lib/synth/user-preset";

const KEY_SPAN = 25;
const BASE_C = 48;
const HANDLE_KEY = "skyforge.xHandle";
const SKIN_KEY = "skyforge.skin";
const TRIM_KEY = "skyforge.trim";
const KEYS_LIVE_KEY = "skyforge.keysLive";
type ChassisSkin = "forge" | "rack";

function skipMidiPort(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("wavetable") || n.includes("mapper") || n.includes("gs synth") || n.includes("microsoft gs");
}

function formatInterval(v: number): string {
  const n = Math.round(v);
  if (n === 0) return "uni";
  if (n === 7) return "5th";
  if (n === 5) return "4th";
  if (n === 12) return "+oct";
  if (n === -12) return "-oct";
  return n > 0 ? `+${n}` : `${n}`;
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 4000);
}

export function ForgeApp() {
  const engineRef = useRef<SynthEngine | null>(null);
  const keysHeld = useRef(new Map<string, number>());
  const sustain = useRef(false);
  const sustained = useRef(new Set<number>());
  const clipTimer = useRef(0);
  const clippingRef = useRef(false);
  const bounceRef = useRef(false);
  const [params, setParams] = useState<SynthParams>(DEFAULT_PARAMS);
  const [armed, setArmed] = useState(false);
  const [activeNotes, setActiveNotes] = useState<number[]>([]);
  const [midiOn, setMidiOn] = useState(false);
  const [keysLive, setKeysLive] = useState(() => {
    if (typeof window === "undefined") return false;
    if (isLiveHost()) return true;
    try {
      return localStorage.getItem(KEYS_LIVE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [hostPlatform, setHostPlatform] = useState("");
  const [recording, setRecording] = useState(false);
  const [clipping, setClipping] = useState(false);
  const [cutting, setCutting] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [clipSave, setClipSave] = useState<{
    url: string;
    name: string;
    thumb: string;
    epithet: string;
    element: string;
    stem: string;
    samples: Float32Array | null;
    sampleRate: number;
    fromHistory: boolean;
  } | null>(null);
  const [wyrmLog, setWyrmLog] = useState<WyrmRecord[]>([]);
  const clipBlobs = useRef(
    new Map<
      string,
      {
        url: string;
        name: string;
        stem: string;
        samples: Float32Array;
        sampleRate: number;
      }
    >(),
  );
  const [presetId, setPresetId] = useState("init");
  const [analyser, setAnalyser] = useState<ScopeMeter | null>(null);
  const [xHandle, setXHandle] = useState("");
  const [skin, setSkin] = useState<ChassisSkin>("forge");
  const [trim, setTrim] = useState<TrimMode>("off");
  const [kindLock, setKindLock] = useState<DragonElement | null>(null);
  const [scale, setScale] = useState<FaceScale>(1);
  const [userPresets, setUserPresets] = useState<UserBank[]>([]);
  const xHandleRef = useRef(xHandle);
  const skinRef = useRef(skin);
  const trimRef = useRef(trim);
  const kindLockRef = useRef(kindLock);
  const presetIdRef = useRef(presetId);
  const wyrmLogRef = useRef(wyrmLog);
  const keysLiveRef = useRef(keysLive);
  const hostPlatformRef = useRef(hostPlatform);
  const midiOuts = useRef<MIDIOutput[]>([]);
  xHandleRef.current = xHandle;
  skinRef.current = skin;
  trimRef.current = trim;
  kindLockRef.current = kindLock;
  presetIdRef.current = presetId;
  wyrmLogRef.current = wyrmLog;
  keysLiveRef.current = keysLive;
  hostPlatformRef.current = hostPlatform;
  const clipAcc = useRef<{ sr: number; n: number; parts: Int16Array[]; mode: "bounce" | "wyrm" } | null>(null);
  const finishTakeRef = useRef<(take: ClipTake) => Promise<void>>(async () => {});
  const liveReadyRef = useRef(!isLiveHost());

  const startMidi = BASE_C + params.octave * 12;

  const pushFace = (partial?: {
    skin?: ChassisSkin;
    trim?: TrimMode;
    handle?: string;
    kind?: DragonElement | null;
    preset?: string;
    scale?: FaceScale;
    banks?: string;
    keysLive?: boolean;
  }) => {
    if (!isLiveHost()) return;
    if (partial?.skin !== undefined) skinRef.current = partial.skin;
    if (partial?.trim !== undefined) trimRef.current = partial.trim;
    if (partial?.handle !== undefined) xHandleRef.current = partial.handle;
    if (partial && "kind" in partial) kindLockRef.current = partial.kind ?? null;
    if (partial?.preset !== undefined) presetIdRef.current = partial.preset;
    if (partial?.keysLive !== undefined) keysLiveRef.current = partial.keysLive;
    sendToPlugin({
      type: "Face",
      skin: skinRef.current,
      trim: trimRef.current,
      handle: xHandleRef.current,
      kind: kindLockRef.current ?? "free",
      preset: presetIdRef.current,
      scale: partial?.scale ?? scale,
      banks: partial?.banks,
      keysLive: keysLiveRef.current,
    });
  };

  const patch = useCallback((partial: Partial<SynthParams>) => {
    setParams((prev) => {
      const next = { ...prev, ...partial };
      if (isLiveHost()) {
        if (liveReadyRef.current) sendToPlugin({ type: "Patch", params: next });
      } else {
        engineRef.current?.setParams(next);
      }
      return next;
    });
    if (!isLiveHost() || liveReadyRef.current) setPresetId("custom");
  }, []);

  const paramsRef = useRef(params);
  paramsRef.current = params;

  const arm = useCallback(() => {
    try {
      flushSync(() => setArmed(true));
    } catch {
      setArmed(true);
    }
    try {
      if (isLiveHost()) return;
      if (!engineRef.current) {
        const ctx = createAudioContext();
        void ctx.resume();
        const engine = new SynthEngine(ctx);
        engine.setParams(paramsRef.current);
        engine.setKind(kindLockRef.current);
        engine.onNotes = setActiveNotes;
        engineRef.current = engine;
        setAnalyser(engine.analyser as ScopeMeter);
        void ctx.resume();
      } else {
        void engineRef.current.resume();
      }
    } catch {
      /* overlay is already gone; next tap retries audio */
    }
  }, []);

  const ensureEngine = useCallback(async () => {
    arm();
    const engine = engineRef.current;
    if (!engine) throw new Error("Audio engine failed to start");
    await engine.resume();
    return engine;
  }, [arm]);

  const tapLive = (key: string, down: boolean) => {
    sendToPlugin({ type: "TapLive", key, down });
  };

  const setKeysMode = (live: boolean) => {
    keysLiveRef.current = live;
    setKeysLive(live);
    if (isLiveHost()) {
      sendToPlugin({ type: "KeysLive", on: live });
      pushFace({ keysLive: live });
      if (live) sendToPlugin({ type: "FocusLive" });
      return;
    }
    try {
      localStorage.setItem(KEYS_LIVE_KEY, live ? "1" : "0");
    } catch {
      /* private */
    }
  };

  const emitMidiOut = (midi: number, on: boolean, velocity = 0.85) => {
    if (!keysLiveRef.current || midiOuts.current.length === 0) return;
    const v = Math.max(1, Math.min(127, Math.round(velocity * 127)));
    const bytes = on ? [0x90, midi & 127, v] : [0x80, midi & 127, 0x40];
    for (const port of midiOuts.current) {
      try {
        port.send(bytes);
      } catch {
        /* unplugged */
      }
    }
  };

  const noteOn = useCallback(
    async (midi: number, velocity = 0.85) => {
      emitMidiOut(midi, true, velocity);
      if (isLiveHost()) {
        sendToPlugin({ type: "NoteOn", note: midi, vel: velocity });
        setActiveNotes((n) => (n.includes(midi) ? n : [...n, midi]));
        return;
      }
      const engine = await ensureEngine();
      engine.noteOn(midi, velocity);
    },
    [ensureEngine],
  );

  const noteOff = useCallback((midi: number) => {
    if (sustain.current) {
      sustained.current.add(midi);
      return;
    }
    emitMidiOut(midi, false);
    if (isLiveHost()) {
      sendToPlugin({ type: "NoteOff", note: midi });
      setActiveNotes((n) => n.filter((x) => x !== midi));
      return;
    }
    engineRef.current?.noteOff(midi);
  }, []);

  useEffect(() => {
    const writesLive = () => isLiveHost() && keysLiveRef.current && hostPlatformRef.current === "windows";
    const liveMapOn = () => isLiveHost() && keysLiveRef.current;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.isContentEditable)) {
        return;
      }
      const k = e.key.toLowerCase();
      if (liveMapOn() && (k === "z" || k === "x")) {
        e.preventDefault();
        if (k === "z") patch({ octave: Math.max(PARAM_RANGE.octave.min, params.octave - 1) });
        else patch({ octave: Math.min(PARAM_RANGE.octave.max, params.octave + 1) });
        if (writesLive() && !keysHeld.current.has(e.key)) {
          keysHeld.current.set(e.key, -1);
          tapLive(k, true);
        }
        return;
      }
      if (writesLive() && isLivePassthroughKey(e.key)) {
        e.preventDefault();
        if (!keysHeld.current.has(e.key)) {
          keysHeld.current.set(e.key, -1);
          tapLive(k, true);
        }
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        sustain.current = true;
        return;
      }
      if (e.key === "[" || e.key === "-") {
        e.preventDefault();
        patch({ octave: Math.max(PARAM_RANGE.octave.min, params.octave - 1) });
        return;
      }
      if (e.key === "]" || e.key === "=") {
        e.preventDefault();
        patch({ octave: Math.min(PARAM_RANGE.octave.max, params.octave + 1) });
        return;
      }
      const liveMap = isLiveHost() && keysLiveRef.current;
      const offset = computerKeyOffset(e.key, liveMap);
      if (offset === undefined) return;
      e.preventDefault();
      if (keysHeld.current.has(e.key)) return;
      const midi = BASE_C + params.octave * 12 + offset;
      keysHeld.current.set(e.key, midi);
      void noteOn(midi);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (writesLive() && isLivePassthroughKey(e.key)) {
        e.preventDefault();
        if (keysHeld.current.has(e.key)) keysHeld.current.delete(e.key);
        tapLive(e.key.toLowerCase(), false);
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        sustain.current = false;
        for (const midi of sustained.current) {
          emitMidiOut(midi, false);
          if (isLiveHost()) {
            sendToPlugin({ type: "NoteOff", note: midi });
            setActiveNotes((n) => n.filter((x) => x !== midi));
          } else {
            engineRef.current?.noteOff(midi);
          }
        }
        sustained.current.clear();
        return;
      }
      const midi = keysHeld.current.get(e.key);
      if (midi === undefined) return;
      keysHeld.current.delete(e.key);
      if (midi >= 0) noteOff(midi);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [noteOff, noteOn, params.octave, patch]);

  useLayoutEffect(() => {
    if (!isLiveHost()) return;
    document.documentElement.dataset.live = "1";
    const meter = new LiveMeter();
    setAnalyser(meter);
    setArmed(true);
    let gotState = false;
    onPluginMessage((msg) => {
      if (msg.type === "state") {
        gotState = true;
        liveReadyRef.current = true;
        setParams((prev) => mergeLiveParams(prev, msg.params));
        if (msg.skin === "rack" || msg.skin === "forge") setSkin(msg.skin);
        if (msg.trim === "plasma" || msg.trim === "purple" || msg.trim === "green" || msg.trim === "off") {
          setTrim(msg.trim);
        }
        if (typeof msg.handle === "string") {
          setXHandle(msg.handle.replace(/^@+/, "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 15));
        }
        const kind = (msg.kind ?? "").toUpperCase();
        if (kind === "EARTH" || kind === "WATER" || kind === "FIRE" || kind === "WIND") {
          setKindLock(kind);
          engineRef.current?.setKind(kind);
        } else {
          setKindLock(null);
          engineRef.current?.setKind(null);
        }
        if (typeof msg.preset === "string" && msg.preset) setPresetId(msg.preset);
        if (typeof msg.scale === "number") setScale(snapScale(msg.scale));
        if (typeof msg.banks === "string" && msg.banks) {
          setUserPresets(parseBanksJson(msg.banks, paramsRef.current));
        }
        if (typeof msg.keysLive === "boolean") {
          keysLiveRef.current = msg.keysLive;
          setKeysLive(msg.keysLive);
        }
        if (typeof msg.platform === "string") {
          hostPlatformRef.current = msg.platform;
          setHostPlatform(msg.platform);
        }
        if (msg.rec === "bounce") {
          bounceRef.current = true;
          clippingRef.current = false;
          setRecording(true);
          setClipping(false);
        } else if (msg.rec === "wyrm") {
          bounceRef.current = false;
          clippingRef.current = true;
          setClipping(true);
          setRecording(false);
        }
        return;
      }
      if (msg.type === "saved") {
        bounceRef.current = false;
        setRecording(false);
        setSavedMsg(msg.ok ? `Saved · ${msg.name}` : "Could not save");
        window.setTimeout(() => setSavedMsg(""), 5000);
        return;
      }
      if (msg.type === "wyrms") {
        setWyrmLog(
          msg.log.map((w) => ({
            id: w.id,
            epithet: w.epithet,
            element: (w.element as DragonElement) || "FIRE",
            at: w.at,
            name: w.name,
            thumb: w.thumb,
            stem: w.stem,
          })),
        );
        return;
      }
      if (msg.type === "meter") {
        meter.ingest(msg.scope);
        meter.tick();
        setActiveNotes(msg.notes);
        return;
      }
      if (msg.type !== "clip") return;
      if (msg.phase === "begin") {
        clipAcc.current = {
          sr: msg.sr,
          n: msg.n,
          parts: [],
          mode: msg.mode === "bounce" ? "bounce" : "wyrm",
        };
        return;
      }
      if (msg.phase === "chunk") {
        const acc = clipAcc.current;
        if (!acc) return;
        acc.parts.push(decodeClipChunk(msg.data));
        return;
      }
      if (msg.phase === "end") {
        const acc = clipAcc.current;
        clipAcc.current = null;
        const bounce = acc?.mode === "bounce" || bounceRef.current;
        bounceRef.current = false;
        setRecording(false);
        setClipping(false);
        if (!acc || acc.n < 1) {
          setCutting(false);
          return;
        }
        const samples = assembleClipPcm(acc.parts, acc.n);
        if (bounce) {
          const wav = encodeWav(samples, acc.sr);
          if (isLiveHost()) {
            void saveToPlugin(`skyforge-bounce-${Date.now()}.wav`, wav);
          } else {
            downloadBlob(wav, "skyforge-bounce.wav");
          }
          setSavedMsg("Saved · bounce WAV");
          window.setTimeout(() => setSavedMsg(""), 5000);
          setCutting(false);
          return;
        }
        void finishTakeRef.current({ samples, sampleRate: acc.sr });
      }
    });
    sendToPlugin({ type: "Init" });
    const retry = window.setInterval(() => {
      if (gotState) {
        window.clearInterval(retry);
        return;
      }
      sendToPlugin({ type: "Init" });
    }, 160);
    const giveUp = window.setTimeout(() => {
      window.clearInterval(retry);
      liveReadyRef.current = true;
    }, 4000);
    return () => {
      window.clearInterval(retry);
      window.clearTimeout(giveUp);
      onPluginMessage(() => {});
      delete document.documentElement.dataset.live;
    };
  }, []);

  useEffect(() => {
    if (armed) return;
    const onFirst = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("[data-offline-download]")) return;
      arm();
    };
    window.addEventListener("pointerdown", onFirst, { capture: true });
    window.addEventListener("touchstart", onFirst as EventListener, { capture: true, passive: true });
    return () => {
      window.removeEventListener("pointerdown", onFirst, { capture: true });
      window.removeEventListener("touchstart", onFirst as EventListener, { capture: true });
    };
  }, [armed, arm]);

  useEffect(() => {
    const kick = () => {
      void engineRef.current?.resume();
    };
    window.addEventListener("pointerdown", kick, { capture: true });
    window.addEventListener("keydown", kick, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", kick, { capture: true });
      window.removeEventListener("keydown", kick, { capture: true });
    };
  }, []);

  useEffect(() => {
    if (!armed || isLiveHost()) return;
    let access: MIDIAccess | null = null;
    const bind = (a: MIDIAccess) => {
      access = a;
      const handle = (ev: MIDIMessageEvent) => {
        const data = ev.data;
        if (!data || data.length < 2) return;
        const status = data[0]! & 0xf0;
        const midi = data[1]!;
        const vel = (data[2] ?? 0) / 127;
        if (status === 0x90 && vel > 0) void noteOn(midi, vel);
        else if (status === 0x80 || (status === 0x90 && vel === 0)) noteOff(midi);
      };
      const hook = () => {
        for (const input of a.inputs.values()) input.onmidimessage = handle;
        midiOuts.current = [...(a.outputs?.values() ?? [])].filter((p) => !skipMidiPort(p.name ?? ""));
      };
      hook();
      a.onstatechange = hook;
      setMidiOn(a.inputs.size > 0 || midiOuts.current.length > 0);
    };
    if (!navigator.requestMIDIAccess) return;
    navigator.requestMIDIAccess().then(bind).catch(() => setMidiOn(false));
    return () => {
      midiOuts.current = [];
      if (!access) return;
      for (const input of access.inputs.values()) input.onmidimessage = null;
    };
  }, [armed, noteOff, noteOn]);

  const applyPreset = (id: string) => {
    const mine = userPresets.find((p) => p.id === id);
    if (mine) {
      applyUserBank(mine);
      return;
    }
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setParams(preset.params);
    if (isLiveHost()) {
      sendToPlugin({ type: "Patch", params: preset.params });
      setPresetId(id);
      pushFace({ preset: id });
    } else {
      engineRef.current?.setParams(preset.params);
      setPresetId(id);
    }
  };

  const applyUserBank = (bank: UserBank) => {
    setParams(bank.params);
    setSkin(bank.skin);
    setTrim(bank.trim);
    setKindLock(bank.kind);
    setPresetId(bank.id);
    if (isLiveHost()) {
      sendToPlugin({ type: "Patch", params: bank.params });
      pushFace({
        skin: bank.skin,
        trim: bank.trim,
        kind: bank.kind,
        preset: bank.id,
      });
    } else {
      engineRef.current?.setParams(bank.params);
      engineRef.current?.setKind(bank.kind);
      try {
        localStorage.setItem(SKIN_KEY, bank.skin);
        localStorage.setItem(TRIM_KEY, bank.trim);
      } catch {
        /* private */
      }
    }
  };

  const saveUserBank = (name: string) => {
    const bank: UserBank = {
      skyforge: 1,
      id: `u-${slugBank(name)}-${Date.now().toString(36)}`,
      name,
      params: { ...paramsRef.current },
      skin: skinRef.current,
      trim: trimRef.current,
      kind: kindLockRef.current,
    };
    const next = [bank, ...userPresets.filter((b) => b.id !== bank.id && b.name !== bank.name)].slice(0, 24);
    setUserPresets(next);
    storeUserPresets(next);
    setPresetId(bank.id);
    const file = new Blob([serializeBank(bank)], { type: "application/json" });
    const fileName = `skyforge-${slugBank(name)}.json`;
    if (isLiveHost()) {
      pushFace({ preset: bank.id, banks: JSON.stringify(next) });
      void saveToPlugin(fileName, file);
    } else {
      downloadBlob(file, fileName);
    }
  };

  const loadUserBankFile = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text()) as unknown;
      const bank = parseBank(raw, paramsRef.current);
      if (!bank) return;
      applyUserBank(bank);
      const next = [bank, ...userPresets.filter((b) => b.id !== bank.id)].slice(0, 24);
      setUserPresets(next);
      storeUserPresets(next);
      if (isLiveHost()) pushFace({ banks: JSON.stringify(next), preset: bank.id });
    } catch {
      /* ignore bad file */
    }
  };

  const changeScale = (next: FaceScale) => {
    setScale(next);
    document.documentElement.style.setProperty("--face-scale", String(next));
    if (isLiveHost()) sendToPlugin({ type: "Scale", factor: next });
    else {
      try {
        localStorage.setItem(SCALE_KEY, String(next));
      } catch {
        /* private */
      }
    }
  };

  const toggleRecord = async () => {
    if (clipping || cutting) return;
    if (isLiveHost()) {
      if (recording) {
        bounceRef.current = true;
        window.clearTimeout(clipTimer.current);
        setRecording(false);
        sendToPlugin({ type: "ClipStop" });
        return;
      }
      bounceRef.current = true;
      clippingRef.current = false;
      clipAcc.current = null;
      sendToPlugin({ type: "ClipStart", mode: "bounce" });
      setRecording(true);
      window.clearTimeout(clipTimer.current);
      clipTimer.current = window.setTimeout(() => {
        document.getElementById("skyforge-bounce")?.click();
      }, BOUNCE_MAX_SEC * 1000);
      return;
    }
    const engine = await ensureEngine();
    if (recording) {
      const wav = engine.stopRecording();
      setRecording(false);
      if (wav) downloadBlob(wav, "skyforge-bounce.wav");
      return;
    }
    const ok = await engine.startRecording();
    if (ok) setRecording(true);
  };

  const finishTake = useCallback(async (take: ClipTake) => {
    if (!take.samples.length) {
      setCutting(false);
      setClipping(false);
      return;
    }
    setCutting(true);
    try {
      const file = await renderSkyForgeClip(
        take,
        xHandleRef.current,
        kindLockRef.current,
        skinRef.current,
      );
      const hasVideo = file.blob.size > 2000;
      const url = hasVideo ? URL.createObjectURL(file.blob) : "";
      setClipSave({
        url,
        name: file.name,
        thumb: file.thumb,
        epithet: file.epithet,
        element: file.element,
        stem: file.stem,
        samples: file.samples,
        sampleRate: file.sampleRate,
        fromHistory: false,
      });
      const { log, id } = await pushWyrm(
        {
          epithet: file.epithet,
          element: file.element,
          name: file.name,
          thumb: file.thumb,
          stem: file.stem,
        },
        { video: file.blob, samples: file.samples, sampleRate: file.sampleRate },
        wyrmLogRef.current,
      );
      setWyrmLog(log);
      const stale = [...clipBlobs.current.keys()].filter((k) => !log.some((w) => w.id === k));
      for (const k of stale) {
        const old = clipBlobs.current.get(k);
        if (old) URL.revokeObjectURL(old.url);
        clipBlobs.current.delete(k);
      }
      clipBlobs.current.set(id, {
        url,
        name: file.name,
        stem: file.stem,
        samples: file.samples,
        sampleRate: file.sampleRate,
      });
      if (isLiveHost()) {
        sendToPlugin({
          type: "WyrmKeep",
          id,
          epithet: file.epithet,
          element: file.element,
          at: Date.now(),
          name: file.name,
          thumb: file.thumb,
          stem: file.stem,
        });
        if (hasVideo) await saveToPlugin(file.name, file.blob);
      }
    } catch {
      /* WAV bounce still works */
    } finally {
      setCutting(false);
    }
  }, []);
  finishTakeRef.current = finishTake;

  const toggleClip = async () => {
    if (recording && !clipping) return;
    if (isLiveHost()) {
      if (clippingRef.current) {
        clippingRef.current = false;
        window.clearTimeout(clipTimer.current);
        setClipping(false);
        setCutting(true);
        sendToPlugin({ type: "ClipStop" });
        return;
      }
      clipAcc.current = null;
      sendToPlugin({ type: "ClipStart", mode: "wyrm" });
      clippingRef.current = true;
      setClipping(true);
      window.clearTimeout(clipTimer.current);
      clipTimer.current = window.setTimeout(() => {
        document.getElementById("skyforge-clip")?.click();
      }, CLIP_MAX_SEC * 1000);
      return;
    }
    const engine = await ensureEngine();
    if (clippingRef.current) {
      clippingRef.current = false;
      window.clearTimeout(clipTimer.current);
      const take = engine.stopRecordingPcm();
      setClipping(false);
      if (!take || take.samples.length < engine.sampleRate * 0.15) {
        setCutting(false);
        return;
      }
      await finishTake(take);
      return;
    }
    const ok = await engine.startRecording();
    if (ok) {
      clippingRef.current = true;
      setClipping(true);
      window.clearTimeout(clipTimer.current);
      clipTimer.current = window.setTimeout(() => {
        document.getElementById("skyforge-clip")?.click();
      }, CLIP_MAX_SEC * 1000);
    }
  };

  const exportMidi = () => {
    if (isLiveHost()) {
      sendToPlugin({ type: "MidiDump" });
      return;
    }
    const engine = engineRef.current;
    if (!engine || engine.midiLog.length === 0) return;
    const blob = encodeMidiFile(engine.midiLog);
    downloadBlob(blob, "skyforge-clip.mid");
  };

  const downloadOffline = () => {
    saveSkyForgeOffline();
  };

  useEffect(() => {
    if (isLiveHost()) return;
    try {
      const saved = localStorage.getItem(HANDLE_KEY);
      if (saved) setXHandle(saved);
      const skinSaved = localStorage.getItem(SKIN_KEY);
      if (skinSaved === "rack" || skinSaved === "forge") setSkin(skinSaved);
      const trimSaved = localStorage.getItem(TRIM_KEY);
      if (trimSaved === "plasma" || trimSaved === "purple" || trimSaved === "green" || trimSaved === "off") {
        setTrim(trimSaved);
      }
      const scaleSaved = localStorage.getItem(SCALE_KEY);
      if (scaleSaved) setScale(snapScale(Number(scaleSaved)));
    } catch {
      /* private mode */
    }
    setUserPresets(loadUserPresets());
    void loadWyrms().then(({ log, blobs }) => {
      clipBlobs.current = blobs;
      setWyrmLog(log);
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.skin = skin;
  }, [skin]);

  useEffect(() => {
    document.documentElement.style.setProperty("--face-scale", String(scale));
  }, [scale]);

  const onHandleChange = (raw: string) => {
    const clean = raw.replace(/^@+/, "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 15);
    setXHandle(clean);
    if (isLiveHost()) {
      pushFace({ handle: clean });
      return;
    }
    try {
      localStorage.setItem(HANDLE_KEY, clean);
    } catch {
      /* ignore */
    }
  };

  const shareClip = () => {
    const take = clipSave;
    if (!take) return;
    void shareWyrmOnX({
      epithet: take.epithet,
      element: take.element,
      videoUrl: take.url || undefined,
      videoName: take.name,
      thumb: take.thumb,
      handle: formatXHandle(xHandleRef.current),
    }).then((how) => {
      setSavedMsg(how === "sheet" ? "Share sheet · pick X" : "Opened X · drop the wyrm onto the post");
    });
  };

  const saveClipAudio = (kind: "wav" | "mp3") => {
    const take = clipSave;
    if (!take?.samples?.length) return;
    try {
      if (kind === "wav") {
        if (isLiveHost()) {
          sendToPlugin({ type: "SaveWav", stem: take.stem });
          setSavedMsg("Saved · WAV");
          return;
        }
        downloadBlob(encodeWav(take.samples, take.sampleRate), `${take.stem}.wav`);
        setSavedMsg("Saved · WAV");
        return;
      }
      const blob = encodeMp3(take.samples, take.sampleRate);
      if (blob.size < 64) throw new Error("empty mp3");
      if (isLiveHost()) void saveToPlugin(`${take.stem}.mp3`, blob);
      else downloadBlob(blob, `${take.stem}.mp3`);
      setSavedMsg("Saved · MP3");
    } catch {
      if (isLiveHost()) sendToPlugin({ type: "SaveWav", stem: take.stem });
      else downloadBlob(encodeWav(take.samples, take.sampleRate), `${take.stem}.wav`);
      setSavedMsg("MP3 failed · WAV instead");
    }
  };

  const noteLabel = useMemo(() => {
    if (activeNotes.length === 0) return "—";
    return [...activeNotes].sort((a, b) => a - b).map(midiToName).join("  ");
  }, [activeNotes]);

  return (
    <main
      className="live-stage studio-bg relative"
      data-skin={skin}
      onPointerUp={(e) => {
        if (!isLiveHost() || !keysLiveRef.current) return;
        const t = e.target as HTMLElement | null;
        if (t?.closest("input, textarea, select")) return;
        sendToPlugin({ type: "FocusLive" });
      }}
    >
      <h1 className="sr-only">SkyForge analog synthesizer by johnnyskyride</h1>
      {!armed && !isLiveHost() ? <ArmGate onArm={arm} /> : null}
      <section
        className="forge-chassis relative mx-auto w-full max-w-5xl"
        data-haunt={params.halloween > 0.4 ? "1" : "0"}
        data-tide={params.waters > 0.42 ? "1" : "0"}
        data-skin={skin}
        data-trim={skin === "forge" ? trim : "off"}
      >
          <ChassisTube />
          <span className="chassis-screw tl" aria-hidden />
          <span className="chassis-screw tr" aria-hidden />
          <span className="chassis-screw bl" aria-hidden />
          <span className="chassis-screw br" aria-hidden />
          <header className="chassis-head flex flex-wrap items-center gap-3 px-4 py-2.5 sm:px-5">
            <button
              type="button"
              onPointerDown={(e) => {
                e.stopPropagation();
                arm();
              }}
              onClick={() => arm()}
              className={cn("power-led relative z-10", armed && "is-on")}
              aria-pressed={armed}
              aria-label={armed ? "Audio armed" : "Arm audio"}
            >
              <Power className="size-4" strokeWidth={1.75} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-2xs tracking-[0.18em] text-muted">
                <span className="uppercase">SF-33</span>
                <span className="text-subtle"> · </span>
                <span className="normal-case tracking-wide">@johnnyskyride</span>
                {savedMsg ? (
                  <span className="ml-2 tracking-[0.12em] text-led">{savedMsg}</span>
                ) : midiOn ? (
                  <span className="ml-2 inline-flex items-center gap-1 tracking-[0.16em] text-led">
                    <Circle className="size-2 fill-current" />
                    Port
                  </span>
                ) : null}
              </p>
            </div>
            <div className="keys-midi" role="group" aria-label="Computer keyboard">
              <button
                type="button"
                className={cn("keys-midi-btn", !keysLive && "is-on")}
                aria-pressed={!keysLive}
                onClick={() => setKeysMode(false)}
              >
                Keys
              </button>
              <button
                type="button"
                className={cn("keys-midi-btn", keysLive && "is-on")}
                aria-pressed={keysLive}
                onClick={() => setKeysMode(true)}
              >
                MIDI
              </button>
            </div>
            <OptionsMenu
              scale={scale}
              onScale={changeScale}
              userPresets={userPresets}
              onSave={saveUserBank}
              onLoadFile={(file) => void loadUserBankFile(file)}
              onPickUser={(id) => applyPreset(id)}
            />
            <PresetSelect
              value={
                PRESETS.some((p) => p.id === presetId) || userPresets.some((p) => p.id === presetId)
                  ? presetId
                  : "init"
              }
              forge={PRESETS}
              yours={userPresets}
              onPick={(id) => applyPreset(id)}
            />
            <button
              id="skyforge-bounce"
              type="button"
              onClick={() => void toggleRecord()}
              disabled={clipping || cutting}
              className={cn("header-btn", recording && "is-rec")}
            >
              <Circle className={cn("size-3", recording ? "fill-clip text-clip" : "fill-current")} />
              {recording ? "Stop" : "Bounce"}
            </button>
            <label className="header-handle">
              <span className="sr-only">X username for Ear Wyrm</span>
              <span aria-hidden>@</span>
              <input
                type="text"
                value={xHandle}
                onChange={(e) => onHandleChange(e.target.value)}
                placeholder="you"
                autoComplete="username"
                spellCheck={false}
                maxLength={15}
                suppressHydrationWarning
              />
            </label>
            <button
              id="skyforge-clip"
              type="button"
              onClick={() => void toggleClip()}
              disabled={recording || cutting}
              className={cn("header-btn", (clipping || cutting) && "is-rec")}
            >
              <Clapperboard className="size-3.5" />
              {cutting ? "Cut…" : clipping ? "Stop" : "Ear Wyrm"}
            </button>
            <button type="button" onClick={exportMidi} className="header-btn hidden sm:inline-flex">
              <Download className="size-3.5" />
              MIDI
            </button>
            <button
              type="button"
              className={cn("header-btn", skin === "rack" && "is-on")}
              onClick={() => {
                const next: ChassisSkin = skin === "rack" ? "forge" : "rack";
                setSkin(next);
                if (isLiveHost()) {
                  pushFace({ skin: next });
                  return;
                }
                try {
                  localStorage.setItem(SKIN_KEY, next);
                } catch {
                  /* private */
                }
              }}
            >
              {skin === "rack" ? "Forge" : "Rack"}
            </button>
            {!isLiveHost() ? (
            <button
              type="button"
              data-offline-download
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                downloadOffline();
              }}
              className="header-btn"
            >
              <HardDriveDownload className="size-3.5" />
              Offline
            </button>
            ) : null}
          </header>
          <div className="wyrm-stage">
          {clipSave && !clipSave.fromHistory ? (
            <WyrmPreview
              epithet={clipSave.epithet}
              element={clipSave.element}
              url={clipSave.url}
              thumb={clipSave.thumb}
              canAudio={!!clipSave.samples && clipSave.samples.length > 0}
              onClose={() => setClipSave(null)}
              onWav={() => saveClipAudio("wav")}
              onMp3={() => saveClipAudio("mp3")}
              onShare={shareClip}
            />
          ) : null}
          {clipSave?.fromHistory ? (
            <WyrmSaveCard
              epithet={clipSave.epithet}
              element={clipSave.element}
              thumb={clipSave.thumb}
              url={clipSave.url}
              name={clipSave.name}
              canAudio={!!clipSave.samples && clipSave.samples.length > 0}
              onClose={() => setClipSave(null)}
              onShare={shareClip}
              onWav={() => saveClipAudio("wav")}
              onMp3={() => saveClipAudio("mp3")}
            />
          ) : null}
          <div className="wyrm-bar">
            <WyrmLog
              log={wyrmLog}
              onOpen={(entry) => {
                const blob = clipBlobs.current.get(entry.id);
                setClipSave({
                  url: blob?.url ?? "",
                  name: blob?.name ?? entry.name,
                  thumb: entry.thumb,
                  epithet: entry.epithet,
                  element: entry.element,
                  stem: blob?.stem ?? entry.name.replace(/\.[^.]+$/, ""),
                  samples: blob?.samples ?? null,
                  sampleRate: blob?.sampleRate ?? 44100,
                  fromHistory: true,
                });
              }}
            />
            <span className="nameplate">
              <DragonEtch variant="mark" className="h-5 w-8 shrink-0" />
              <p className="font-sans text-lg font-medium tracking-tight text-fg">SkyForge</p>
              <DragonEtch variant="mark" className="h-5 w-8 shrink-0 -scale-x-100" />
            </span>
          </div>
          </div>

          <div className="panel-deck grid gap-3 px-4 py-3 sm:px-5 md:grid-cols-2">
            <div className="flex gap-3">
              <Oscilloscope analyser={analyser} armed={armed} className="min-h-20 flex-1 sm:min-h-28" />
              <LevelMeter analyser={analyser} armed={armed} />
            </div>

            <WaveBank
              value={params.waveform}
              onChange={(waveform: Waveform) => patch({ waveform })}
            />
          </div>

          <div className="panel-row flex flex-wrap items-end gap-x-2 gap-y-1 px-4 py-2 sm:px-5">
            <div className="flex flex-col gap-1 pb-1">
              <span className="font-mono text-2xs font-medium uppercase tracking-[0.16em] text-muted">
                Filter
              </span>
              <FilterBank
                value={params.filterType}
                onChange={(filterType: FilterType) => patch({ filterType })}
              />
            </div>
            <Knob
              compact
              tone="emerald"
              label="Cutoff"
              value={params.cutoff}
              min={PARAM_RANGE.cutoff.min}
              max={PARAM_RANGE.cutoff.max}
              log
              format={formatHz}
              defaultValue={DEFAULT_PARAMS.cutoff}
              onChange={(cutoff) => patch({ cutoff })}
            />
            <Knob
              compact
              tone="emerald"
              label="Reso"
              value={params.resonance}
              min={PARAM_RANGE.resonance.min}
              max={PARAM_RANGE.resonance.max}
              format={(v) => v.toFixed(1)}
              defaultValue={DEFAULT_PARAMS.resonance}
              onChange={(resonance) => patch({ resonance })}
            />
            <KindBank
              variant={skin}
              value={kindLock}
              onChange={(kind) => {
                setKindLock(kind);
                if (kind) patch(KIND_VOICE[kind]);
                engineRef.current?.setKind(kind);
                pushFace({ kind });
              }}
            />
            <SummonWell
              analyser={analyser}
              armed={armed}
              kind={kindLock}
              className="mb-0.5 ml-4 h-[5.75rem] w-72 min-w-72 flex-none sm:ml-5 sm:w-80 sm:min-w-80"
            />
            {params.waveform === "pulse" ? (
              <Knob
                compact
                tone="emerald"
                label="Width"
                value={params.pulseWidth}
                min={PARAM_RANGE.pulseWidth.min}
                max={PARAM_RANGE.pulseWidth.max}
                format={(v) => `${Math.round(v * 100)}%`}
                defaultValue={DEFAULT_PARAMS.pulseWidth}
                onChange={(pulseWidth) => patch({ pulseWidth })}
              />
            ) : null}
            <div className="ml-auto flex items-center gap-1 pb-2">
              <button
                type="button"
                className="oct-btn"
                aria-label="Octave down"
                onClick={() =>
                  patch({ octave: Math.max(PARAM_RANGE.octave.min, params.octave - 1) })
                }
              >
                <Minus className="size-4" />
              </button>
              <span className="w-8 text-center font-mono text-sm tabular-nums text-fg">
                {params.octave > 0 ? `+${params.octave}` : params.octave}
              </span>
              <button
                type="button"
                className="oct-btn"
                aria-label="Octave up"
                onClick={() =>
                  patch({ octave: Math.min(PARAM_RANGE.octave.max, params.octave + 1) })
                }
              >
                <Plus className="size-4" />
              </button>
            </div>
          </div>

          <div
            className={cn(
              "piano-dock border-t border-border bg-chassis px-3 py-2.5 sm:px-4",
              !armed && "max-sm:hidden",
            )}
          >
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <p className={cn("font-mono text-2xs uppercase tracking-[0.16em]", armed ? "text-pearl" : "text-muted")}>
                {armed ? "Live" : "Standby"} · {noteLabel}
              </p>
              <p className="hidden font-mono text-2xs text-subtle sm:block">
                {isLiveHost() && keysLive
                  ? hostPlatform === "windows"
                    ? "A–L writes the clip · Z/X octave · Live keyboard on"
                    : "A–L plays · MIDI out on the track"
                  : keysLive
                    ? "Z–M lower · Q–P upper · MIDI out"
                    : "Z–M lower · Q–P upper · space sustain"}
              </p>
            </div>
            <div className="mb-2 flex items-end gap-1 overflow-x-auto sm:gap-2">
              <span className="hidden pb-6 font-mono text-2xs font-medium uppercase tracking-[0.16em] text-pearl sm:block">
                Env
              </span>
              <Knob
                compact
                tone="pearl"
                label="Attack"
                value={params.attack}
                min={PARAM_RANGE.attack.min}
                max={PARAM_RANGE.attack.max}
                log
                format={formatTime}
                defaultValue={DEFAULT_PARAMS.attack}
                onChange={(attack) => patch({ attack })}
              />
              <Knob
                compact
                tone="pearl"
                label="Decay"
                value={params.decay}
                min={PARAM_RANGE.decay.min}
                max={PARAM_RANGE.decay.max}
                log
                format={formatTime}
                defaultValue={DEFAULT_PARAMS.decay}
                onChange={(decay) => patch({ decay })}
              />
              <Knob
                compact
                tone="pearl"
                label="Sustain"
                value={params.sustain}
                min={PARAM_RANGE.sustain.min}
                max={PARAM_RANGE.sustain.max}
                format={(v) => v.toFixed(2)}
                defaultValue={DEFAULT_PARAMS.sustain}
                onChange={(sustainVal) => patch({ sustain: sustainVal })}
              />
              <Knob
                compact
                tone="pearl"
                label="Release"
                value={params.release}
                min={PARAM_RANGE.release.min}
                max={PARAM_RANGE.release.max}
                log
                format={formatTime}
                defaultValue={DEFAULT_PARAMS.release}
                onChange={(release) => patch({ release })}
              />
              <Knob
                compact
                tone="pearl"
                label="Volume"
                value={params.volume}
                min={PARAM_RANGE.volume.min}
                max={PARAM_RANGE.volume.max}
                format={formatDb}
                defaultValue={DEFAULT_PARAMS.volume}
                onChange={(volume) => patch({ volume })}
              />
              <Knob
                compact
                tone="pearl"
                label="Unison"
                value={params.unison}
                min={PARAM_RANGE.unison.min}
                max={PARAM_RANGE.unison.max}
                format={(v) => `${Math.round(v)}`}
                defaultValue={DEFAULT_PARAMS.unison}
                onChange={(unison) => patch({ unison: Math.max(1, Math.min(3, Math.round(unison))) })}
              />
              <Knob
                compact
                tone="pearl"
                label="Osc 2"
                value={params.twin}
                min={PARAM_RANGE.twin.min}
                max={PARAM_RANGE.twin.max}
                format={(v) => (v < 0.01 ? "off" : `${Math.round(v * 100)}`)}
                defaultValue={DEFAULT_PARAMS.twin}
                onChange={(twin) => patch({ twin })}
              />
              <Knob
                compact
                tone="pearl"
                label="Tune"
                value={params.twinInterval}
                min={PARAM_RANGE.twinInterval.min}
                max={PARAM_RANGE.twinInterval.max}
                format={formatInterval}
                defaultValue={DEFAULT_PARAMS.twinInterval}
                onChange={(twinInterval) =>
                  patch({ twinInterval: Math.max(-24, Math.min(24, Math.round(twinInterval))) })
                }
              />
              <div className="ml-4 flex shrink-0 gap-1 sm:ml-6 sm:gap-2">
                <Knob
                  compact
                  label="Waters"
                  value={params.waters}
                  min={PARAM_RANGE.waters.min}
                  max={PARAM_RANGE.waters.max}
                  format={(v) => (v < 0.01 ? "off" : `${Math.round(v * 100)}`)}
                  defaultValue={0}
                  tone="tide"
                  onChange={(waters) => patch({ waters })}
                />
                <div className="haunt-stack">
                  {skin === "rack" ? <HauntSpider /> : null}
                  <Knob
                    compact
                    label="Halloween"
                    value={params.halloween}
                    min={PARAM_RANGE.halloween.min}
                    max={PARAM_RANGE.halloween.max}
                    format={(v) => (v < 0.01 ? "off" : `${Math.round(v * 100)}`)}
                    defaultValue={0}
                    tone="ghost"
                    labelTone="haunt"
                    onChange={(halloween) => patch({ halloween })}
                  />
                </div>
                <Knob
                  compact
                  label="Aether"
                  value={params.aether}
                  min={PARAM_RANGE.aether.min}
                  max={PARAM_RANGE.aether.max}
                  format={(v) => (v < 0.01 ? "off" : `${Math.round(v * 100)}`)}
                  defaultValue={0}
                  tone="aether"
                  onChange={(aether) => patch({ aether })}
                />
              </div>
            </div>
            <div className="relative">
              {skin === "rack" ? (
                <img
                  className="crazy-88"
                  src="/crazy-88.jpg"
                  alt=""
                  width={220}
                  height={220}
                  draggable={false}
                />
              ) : (
                <TrimDeck
                  analyser={analyser}
                  armed={armed}
                  mode={trim}
                  onMode={(next) => {
                    setTrim(next);
                    if (isLiveHost()) {
                      pushFace({ trim: next });
                      return;
                    }
                    try {
                      localStorage.setItem(TRIM_KEY, next);
                    } catch {
                      /* private */
                    }
                  }}
                />
              )}
              <Piano
                startMidi={startMidi}
                count={KEY_SPAN}
                activeNotes={activeNotes}
                onNoteOn={(m, v) => void noteOn(m, v)}
                onNoteOff={noteOff}
                showComputerKeys
                liveKeys={isLiveHost() && keysLive}
              />
            </div>
          </div>
      </section>
    </main>
  );
}

function HauntSpider() {
  return (
    <svg className="haunt-spider" viewBox="0 0 72 52" aria-hidden>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="square"
        strokeLinejoin="miter"
      >
        <path d="M28 16 L16 7 L6 3" />
        <path d="M26 22 L12 18 L2 14" />
        <path d="M26 30 L12 36 L3 46" />
        <path d="M28 36 L16 45 L8 51" />
        <path d="M44 16 L56 7 L66 3" />
        <path d="M46 22 L60 18 L70 14" />
        <path d="M46 30 L60 36 L69 46" />
        <path d="M44 36 L56 45 L64 51" />
        <circle cx="36" cy="15" r="5.2" />
        <ellipse cx="36" cy="30.5" rx="6.4" ry="11" />
        <path d="M36 21.5 V40.5" strokeWidth="1.15" />
      </g>
    </svg>
  );
}

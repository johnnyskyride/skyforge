import { useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { isBlackKey, midiToName } from "@/lib/synth/notes";
import { OFFSET_TO_COMPUTER_KEY, OFFSET_TO_LIVE_KEY } from "@/lib/synth/keyboard-map";

type PianoProps = {
  startMidi: number;
  count: number;
  activeNotes: number[];
  onNoteOn: (midi: number, velocity: number) => void;
  onNoteOff: (midi: number) => void;
  disabled?: boolean;
  showComputerKeys?: boolean;
  liveKeys?: boolean;
};

function whiteCount(start: number, count: number) {
  let n = 0;
  for (let i = 0; i < count; i++) if (!isBlackKey(start + i)) n++;
  return n;
}

function whitesBefore(start: number, midi: number) {
  let n = 0;
  for (let m = start; m < midi; m++) if (!isBlackKey(m)) n++;
  return n;
}

export function Piano({
  startMidi,
  count,
  activeNotes,
  onNoteOn,
  onNoteOff,
  disabled,
  showComputerKeys,
  liveKeys,
}: PianoProps) {
  const held = useRef<number | null>(null);
  const active = useMemo(() => new Set(activeNotes), [activeNotes]);
  const whites = whiteCount(startMidi, count);
  const keys = useMemo(
    () => Array.from({ length: count }, (_, i) => startMidi + i),
    [count, startMidi],
  );
  const whiteKeys = keys.filter((m) => !isBlackKey(m));
  const blackKeys = keys.filter((m) => isBlackKey(m));

  const velocityFromEvent = (el: HTMLElement, clientY: number) => {
    const rect = el.getBoundingClientRect();
    const t = (clientY - rect.top) / rect.height;
    return Math.max(0.15, Math.min(1, 0.25 + t * 0.85));
  };

  const pointerNote = (el: HTMLElement, midi: number, e: React.PointerEvent) => {
    if (disabled) return;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events may lack a real pointer id */
    }
    if (held.current !== null && held.current !== midi) onNoteOff(held.current);
    held.current = midi;
    onNoteOn(midi, velocityFromEvent(el, e.clientY));
  };

  const release = (midi: number) => {
    if (held.current === midi) held.current = null;
    onNoteOff(midi);
  };

  return (
    <div
      className="piano relative isolate h-24 w-full select-none sm:h-28"
      onPointerUp={() => {
        if (held.current !== null) {
          onNoteOff(held.current);
          held.current = null;
        }
      }}
      onPointerLeave={() => {
        if (held.current !== null) {
          onNoteOff(held.current);
          held.current = null;
        }
      }}
    >
      <div className="absolute inset-0 flex">
        {whiteKeys.map((midi) => {
          const on = active.has(midi);
          const label = (liveKeys ? OFFSET_TO_LIVE_KEY : OFFSET_TO_COMPUTER_KEY)[midi - startMidi];
          return (
            <button
              key={midi}
              type="button"
              aria-label={midiToName(midi)}
              aria-pressed={on}
              disabled={disabled}
              className={cn("piano-white", on && "is-on", midi % 12 === 0 && "is-c")}
              onPointerDown={(e) => {
                e.preventDefault();
                pointerNote(e.currentTarget, midi, e);
              }}
              onPointerEnter={(e) => {
                if (e.buttons !== 1 || disabled) return;
                pointerNote(e.currentTarget, midi, e);
              }}
              onPointerUp={() => release(midi)}
            >
              <span className="piano-note">{midiToName(midi)}</span>
              {showComputerKeys && label ? (
                <span className="piano-qwerty">{label}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-0">
        {blackKeys.map((midi) => {
          const on = active.has(midi);
          const idx = whitesBefore(startMidi, midi);
          const left = ((idx - 0.32) / whites) * 100;
          const width = (0.62 / whites) * 100;
          const label = (liveKeys ? OFFSET_TO_LIVE_KEY : OFFSET_TO_COMPUTER_KEY)[midi - startMidi];
          return (
            <button
              key={midi}
              type="button"
              aria-label={midiToName(midi)}
              aria-pressed={on}
              disabled={disabled}
              className={cn("piano-black pointer-events-auto", on && "is-on")}
              style={{ left: `${left}%`, width: `${width}%` }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                pointerNote(e.currentTarget, midi, e);
              }}
              onPointerEnter={(e) => {
                if (e.buttons !== 1 || disabled) return;
                pointerNote(e.currentTarget, midi, e);
              }}
              onPointerUp={(e) => {
                e.stopPropagation();
                release(midi);
              }}
            >
              {showComputerKeys && label ? (
                <span className="piano-qwerty is-black">{label}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Preset } from "@/lib/synth/presets";
import type { UserBank } from "@/lib/synth/user-preset";

type PresetSelectProps = {
  value: string;
  forge: Preset[];
  yours: UserBank[];
  onPick: (id: string) => void;
};

export function PresetSelect({ value, forge, yours, onPick }: PresetSelectProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current =
    forge.find((p) => p.id === value)?.name ??
    yours.find((p) => p.id === value)?.name ??
    "Forge Init";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (id: string) => {
    onPick(id);
    setOpen(false);
  };

  return (
    <div className="options-anchor preset-anchor" ref={root}>
      <button
        type="button"
        id="forge-preset"
        className={cn("preset-select", open && "is-on")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Preset"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="preset-select-label">{current}</span>
        <ChevronDown className="size-3.5 shrink-0" />
      </button>
      {open ? (
        <div className="options-plate preset-plate" role="listbox" aria-labelledby="forge-preset">
          <p className="options-kicker">Forge</p>
          <div className="preset-list">
            {forge.map((p) => (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={p.id === value}
                className={cn("options-item", p.id === value && "is-on")}
                onClick={() => pick(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
          {yours.length > 0 ? (
            <>
              <p className="options-kicker">Yours</p>
              <div className="preset-list">
                {yours.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={p.id === value}
                    className={cn("options-item", p.id === value && "is-on")}
                    onClick={() => pick(p.id)}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

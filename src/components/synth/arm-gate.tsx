import { HardDriveDownload, Power } from "lucide-react";
import { SKYFORGE_OFFLINE_HREF, SKYFORGE_OFFLINE_NAME, saveSkyForgeOffline } from "@/lib/synth/offline-file";
import { DragonEtch } from "./dragon-etch";

export function ArmGate({ onArm }: { onArm: () => void }) {
  return (
    <div
      className="arm-veil fixed inset-0 z-[100] grid place-items-center p-4"
      style={{ zIndex: 2147483646 }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement | null)?.closest("[data-offline-download]")) return;
        onArm();
      }}
      onClick={(e) => {
        if ((e.target as HTMLElement | null)?.closest("[data-offline-download]")) return;
        onArm();
      }}
    >
      <div className="flex w-full max-w-md flex-col items-center">
        <button
          type="button"
          aria-label="Arm SkyForge audio"
          className="arm-card relative flex w-full flex-col items-center px-10 py-9 text-center"
          onPointerDown={(e) => {
            e.stopPropagation();
            onArm();
          }}
          onClick={(e) => {
            e.stopPropagation();
            onArm();
          }}
        >
          <span className="arm-screw tl" aria-hidden />
          <span className="arm-screw tr" aria-hidden />
          <span className="arm-screw bl" aria-hidden />
          <span className="arm-screw br" aria-hidden />
          <p className="arm-serial">SF-33  ·  Analog instrument</p>
          <DragonEtch variant="sigil" className="arm-sigil mt-5 h-11 w-56 text-fg/70" />
          <span className="arm-rule mt-5" />
          <span className="mt-4 flex items-center gap-3">
            <DragonEtch variant="mark" className="h-5 w-8 shrink-0 text-fg/55" />
            <span className="font-sans text-4xl font-medium tracking-[0.04em] text-fg">SkyForge</span>
            <DragonEtch variant="mark" className="h-5 w-8 shrink-0 -scale-x-100 text-fg/55" />
          </span>
          <p className="mt-2 font-mono text-xs tracking-[0.22em] text-accent/90">SoSkyride</p>
          <span className="arm-power mt-7 grid size-[4.5rem] place-items-center rounded-full">
            <Power className="size-7 text-fg" strokeWidth={1.4} />
          </span>
          <p className="mt-3 font-mono text-2xs uppercase tracking-[0.22em] text-muted">Arm</p>
        </button>
        <a
          data-offline-download
          href={SKYFORGE_OFFLINE_HREF}
          download={SKYFORGE_OFFLINE_NAME}
          target="_blank"
          rel="noopener noreferrer"
          className="arm-quiet relative z-10 mt-4 inline-flex items-center gap-1.5 no-underline"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            try {
              saveSkyForgeOffline();
              if (window.self === window.top) e.preventDefault();
            } catch {
              /* native download / new tab still runs */
            }
          }}
        >
          <HardDriveDownload className="size-3.5" />
          Offline file
        </a>
      </div>
    </div>
  );
}

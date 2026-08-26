import type { WyrmRecord } from "@/lib/synth/wyrm-log";
import { X } from "lucide-react";

export function WyrmLog({
  log,
  onOpen,
}: {
  log: WyrmRecord[];
  onOpen: (entry: WyrmRecord) => void;
}) {
  if (log.length === 0) {
    return (
      <div className="wyrm-log">
        <span className="font-mono text-2xs uppercase tracking-[0.16em] text-muted">Wyrms</span>
        <span className="font-mono text-2xs text-subtle">empty</span>
      </div>
    );
  }
  return (
    <div className="wyrm-log">
      <span className="font-mono text-2xs uppercase tracking-[0.16em] text-muted">Wyrms</span>
      <div className="flex gap-1.5 overflow-x-auto">
        {log.map((w) => (
          <button
            key={w.id}
            type="button"
            className="wyrm-log-card"
            onClick={() => onOpen(w)}
            title={`${w.epithet} · ${w.element}`}
          >
            <img src={w.thumb} alt="" width={72} height={40} />
            <span>{w.element}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function WyrmPreview({
  epithet,
  element,
  url,
  thumb,
  canAudio,
  onClose,
  onWav,
  onMp3,
  onShare,
}: {
  epithet: string;
  element: string;
  url: string;
  thumb?: string;
  canAudio?: boolean;
  onClose: () => void;
  onWav?: () => void;
  onMp3?: () => void;
  onShare?: () => void;
}) {
  return (
    <div className="wyrm-preview">
      {url ? (
        <video src={url} controls autoPlay loop playsInline preload="metadata" />
      ) : thumb ? (
        <img src={thumb} alt="" width={256} height={144} />
      ) : (
        <p className="font-mono text-2xs text-muted">No picture for this take.</p>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-mono text-2xs uppercase tracking-[0.14em] text-muted">Ear Wyrm</p>
        <p className="truncate font-sans text-sm text-fg">{epithet}</p>
        <p className="font-mono text-2xs uppercase tracking-[0.14em]">{element}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <button type="button" className="header-btn" onClick={onWav} disabled={!canAudio}>
            WAV
          </button>
          <button type="button" className="header-btn" onClick={onMp3} disabled={!canAudio}>
            MP3
          </button>
          {onShare ? (
            <button type="button" className="header-btn" onClick={onShare}>
              Share on X
            </button>
          ) : null}
          <button type="button" className="header-btn" onClick={onClose}>
            <X className="size-3.5" />
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function WyrmSaveCard({
  epithet,
  element,
  thumb,
  url,
  name,
  canAudio,
  onClose,
  onShare,
  onWav,
  onMp3,
}: {
  epithet: string;
  element: string;
  thumb: string;
  url: string;
  name: string;
  canAudio: boolean;
  onClose: () => void;
  onShare: () => void;
  onWav: () => void;
  onMp3: () => void;
}) {
  return (
    <div className="wyrm-save">
      {url ? (
        <video src={url} controls playsInline preload="metadata" />
      ) : (
        <img src={thumb} alt="" width={160} height={90} />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-mono text-2xs uppercase tracking-[0.14em] text-muted">Ear Wyrm</p>
        <p className="truncate font-sans text-sm text-fg">{epithet}</p>
        <p className="font-mono text-2xs uppercase tracking-[0.14em]">{element}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {url ? (
            <a className="header-btn" href={url} download={name}>
              Video
            </a>
          ) : null}
          <button type="button" className="header-btn" onClick={onWav} disabled={!canAudio}>
            WAV
          </button>
          <button type="button" className="header-btn" onClick={onMp3} disabled={!canAudio}>
            MP3
          </button>
          <button type="button" className="header-btn" onClick={onShare}>
            Share on X
          </button>
          <button type="button" className="header-btn" onClick={onClose}>
            <X className="size-3.5" />
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

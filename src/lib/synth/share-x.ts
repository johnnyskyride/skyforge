import { isLiveHost, sendToPlugin } from "./scope-meter";

export type ShareWyrm = {
  epithet: string;
  element: string;
  videoUrl?: string;
  videoName?: string;
  thumb?: string;
  handle?: string;
};

export type ShareResult = "sheet" | "browser";

function caption(s: ShareWyrm): string {
  const who = s.handle?.trim() ? `\n${s.handle.trim()}` : "";
  return `${s.epithet} · ${s.element}\nEar Wyrm — SkyForge SF-33${who}`;
}

export function intentUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

export function openInBrowser(url: string) {
  if (typeof window === "undefined") return;
  if (isLiveHost()) {
    sendToPlugin({ type: "OpenUrl", url });
    return;
  }
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.referrerPolicy = "no-referrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function fileFromUrl(url: string, name: string): Promise<File | null> {
  if (!url) return null;
  try {
    const blob = await fetch(url).then((r) => r.blob());
    if (!blob.size) return null;
    const type = blob.type || (name.endsWith(".webm") ? "video/webm" : "video/mp4");
    return new File([blob], name, { type });
  } catch {
    return null;
  }
}

export async function shareWyrmOnX(s: ShareWyrm): Promise<ShareResult> {
  const text = caption(s);
  const name = s.videoName || "ear-wyrm.mp4";
  const file = s.videoUrl ? await fileFromUrl(s.videoUrl, name) : null;

  if (file && typeof navigator.canShare === "function") {
    try {
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          text,
          title: `${s.epithet} · SkyForge`,
        });
        return "sheet";
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "sheet";
    }
  }

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* webview clipboard may be locked */
  }

  if (s.thumb && navigator.clipboard && "write" in navigator.clipboard) {
    try {
      const img = await fetch(s.thumb).then((r) => r.blob());
      if (img.type.startsWith("image/")) {
        await navigator.clipboard.write([
          new ClipboardItem({
            [img.type]: img,
            "text/plain": new Blob([text], { type: "text/plain" }),
          }),
        ]);
      }
    } catch {
      /* image paste is extra */
    }
  }

  openInBrowser(intentUrl(text));
  return "browser";
}

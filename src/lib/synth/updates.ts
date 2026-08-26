export const SKYFORGE_VERSION = "2.11.0";
export const RELEASES_PAGE = "https://github.com/johnnyskyride/skyforge/releases";

export type UpdateInfo =
  | { ok: true; tag: string; name: string; url: string }
  | { ok: false; reason: string };

type GhRelease = {
  tag_name?: string;
  name?: string;
  html_url?: string;
};

export async function latestLiveBuild(): Promise<UpdateInfo> {
  try {
    const res = await fetch("https://api.github.com/repos/johnnyskyride/skyforge/releases?per_page=12", {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return { ok: false, reason: "GitHub did not answer" };
    const list = (await res.json()) as GhRelease[];
    const hit = list.find((r) => typeof r.tag_name === "string" && r.tag_name.startsWith("vst3-"));
    if (!hit?.tag_name || !hit.html_url) return { ok: false, reason: "No Live build listed yet" };
    return {
      ok: true,
      tag: hit.tag_name,
      name: hit.name || hit.tag_name,
      url: hit.html_url,
    };
  } catch {
    return { ok: false, reason: "Could not reach GitHub" };
  }
}

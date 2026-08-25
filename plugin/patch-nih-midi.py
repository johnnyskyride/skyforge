"""Stamp VST3 MIDI out so Ableton Live actually records it.

nih-plug zeroes Event.flags and Event.ppq_position. Live then ignores the
notes or parks them at beat 0. This patch sets kIsLive and the real PPQ,
and names the event buses MIDI In / MIDI Out so they show in MIDI From.
"""
from pathlib import Path
import os
import sys

NEEDLE_OFFSET = """                        vst3_event.sample_offset = clamp_output_event_timing(
                            event.timing() + block_start as u32,
                            total_buffer_len as u32,
                        ) as i32;"""

STAMP = """                        vst3_event.sample_offset = clamp_output_event_timing(
                            event.timing() + block_start as u32,
                            total_buffer_len as u32,
                        ) as i32;
                        // kIsLive — Ableton drops plugin MIDI without this bit.
                        vst3_event.flags = 1;
                        if !data.context.is_null() {
                            let ctx = &*data.context;
                            if ctx.state & (1 << 9) != 0 {
                                let tempo = if ctx.state & (1 << 10) != 0 && ctx.tempo > 0.0 {
                                    ctx.tempo
                                } else {
                                    120.0
                                };
                                let beats_per_sample = (tempo / 60.0) / f64::from(sample_rate.max(1.0));
                                vst3_event.ppq_position = ctx.project_time_music
                                    + f64::from(vst3_event.sample_offset) * beats_per_sample;
                            }
                        }"""

HOME = Path(os.environ.get("CARGO_HOME", Path.home() / ".cargo"))


def patch_text(t: str) -> str:
    t = t.replace('u16strlcpy(&mut info.name, "Note Output");', 'u16strlcpy(&mut info.name, "MIDI Out");')
    t = t.replace('u16strlcpy(&mut info.name, "Note Input");', 'u16strlcpy(&mut info.name, "MIDI In");')
    if "kIsLive — Ableton" in t or "vst3_event.flags = 1;" in t:
        return t
    if NEEDLE_OFFSET not in t:
        raise SystemExit("patch-nih-midi: sample_offset block not found")
    return t.replace(NEEDLE_OFFSET, STAMP, 1)


def main() -> None:
    roots = [HOME / "git" / "checkouts"]
    files = []
    for root in roots:
        if not root.is_dir():
            continue
        files.extend(root.glob("nih-plug-*/**/src/wrapper/vst3/wrapper.rs"))
    if not files:
        print("patch-nih-midi: no nih-plug checkout yet", file=sys.stderr)
        sys.exit(1)
    n = 0
    for path in files:
        old = path.read_text(encoding="utf-8")
        new = patch_text(old)
        if new != old:
            path.write_text(new, encoding="utf-8")
            n += 1
            print(f"patched {path}")
        else:
            print(f"already patched {path}")
    if n == 0 and files:
        print("patch-nih-midi: checkouts already stamped")


if __name__ == "__main__":
    main()

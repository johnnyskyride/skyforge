#!/usr/bin/env python3
"""Pack the compiled SkyForge cdylib into a .vst3 bundle Ableton will scan."""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TARGET = ROOT / "target" / "release"
OUT = ROOT / "dist" / "SkyForge.vst3"

CANDIDATES = [
    TARGET / "skyforge_vst.dll",
    TARGET / "libskyforge_vst.dll",
    TARGET / "skyforge_vst.so",
    TARGET / "libskyforge_vst.so",
    TARGET / "libskyforge_vst.dylib",
    TARGET / "skyforge_vst.dylib",
]

INFO_PLIST = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>English</string>
  <key>CFBundleExecutable</key>
  <string>SkyForge</string>
  <key>CFBundleIdentifier</key>
  <string>com.johnnyskyride.skyforge</string>
  <key>CFBundleName</key>
  <string>SkyForge</string>
  <key>CFBundleDisplayName</key>
  <string>SkyForge</string>
  <key>CFBundlePackageType</key>
  <string>BNDL</string>
  <key>CFBundleSignature</key>
  <string>????</string>
  <key>CFBundleVersion</key>
  <string>2.0.0</string>
  <key>CFBundleShortVersionString</key>
  <string>2.0.0</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
</dict>
</plist>
"""


def main() -> int:
    src = next((p for p in CANDIDATES if p.exists()), None)
    if src is None:
        print("No compiled plugin found in", TARGET, file=sys.stderr)
        return 1

    if src.suffix == ".dll":
        inner = OUT / "Contents" / "x86_64-win" / "SkyForge.vst3"
    elif src.suffix == ".dylib":
        inner = OUT / "Contents" / "MacOS" / "SkyForge"
    else:
        inner = OUT / "Contents" / "x86_64-linux" / "SkyForge.so"

    if OUT.exists():
        shutil.rmtree(OUT)
    inner.parent.mkdir(parents=True)
    shutil.copy2(src, inner)
    (OUT / "Contents" / "Info.plist").write_text(INFO_PLIST, encoding="utf-8")
    print("wrote", inner)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

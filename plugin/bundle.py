#!/usr/bin/env python3
"""Pack the compiled SkyForge cdylib into a .vst3 bundle Ableton will scan."""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TARGET = ROOT / "target" / "release"
OUT = ROOT / "dist" / "SkyForge.vst3"
MAC_DIR = ROOT / "mac"

CANDIDATES = [
    TARGET / "skyforge_vst.dll",
    TARGET / "libskyforge_vst.dll",
    TARGET / "skyforge_vst.so",
    TARGET / "libskyforge_vst.so",
    TARGET / "libskyforge_vst.dylib",
    TARGET / "skyforge_vst.dylib",
]


def cargo_version() -> str:
    for line in (ROOT / "Cargo.toml").read_text(encoding="utf-8").splitlines():
        if line.startswith("version"):
            return line.split("=", 1)[1].strip().strip('"')
    return "1.0.0"


def info_plist(version: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
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
  <string>{version}</string>
  <key>CFBundleShortVersionString</key>
  <string>{version}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleGetInfoString</key>
  <string>SkyForge {version}, SoSkyride</string>
  <key>NSHumanReadableCopyright</key>
  <string>© 2026 SoSkyride</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.music</string>
</dict>
</plist>
"""


def mac_libs() -> list[Path]:
    found: list[Path] = []
    for triple in ("aarch64-apple-darwin", "x86_64-apple-darwin"):
        p = ROOT / "target" / triple / "release" / "libskyforge_vst.dylib"
        if p.exists():
            found.append(p)
    if found:
        return found
    native = next((p for p in CANDIDATES if p.suffix == ".dylib" and p.exists()), None)
    return [native] if native else []


def copy_mac_extras() -> None:
    dist = OUT.parent
    for name in ("README.txt", "Install-SkyForge.command"):
        src = MAC_DIR / name
        if src.exists():
            dst = dist / name
            shutil.copy2(src, dst)
            if name.endswith(".command"):
                dst.chmod(0o755)


def main() -> int:
    version = cargo_version()
    libs = mac_libs() if sys.platform == "darwin" else []
    src = libs[0] if libs else next((p for p in CANDIDATES if p.exists()), None)
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
    if src.suffix == ".dylib" and len(libs) > 1:
        subprocess.check_call(["lipo", "-create", "-output", str(inner), *[str(p) for p in libs]])
        print("universal", *[p.parent.parent.name for p in libs])
    else:
        shutil.copy2(src, inner)
    if src.suffix == ".dylib":
        inner.chmod(0o755)
        (OUT / "Contents" / "PkgInfo").write_text("BNDL????", encoding="utf-8")
    (OUT / "Contents" / "Info.plist").write_text(info_plist(version), encoding="utf-8")

    if sys.platform == "darwin":
        subprocess.check_call(
            [
                "codesign",
                "--force",
                "--deep",
                "--sign",
                "-",
                "--timestamp=none",
                str(OUT),
            ]
        )
        copy_mac_extras()
        subprocess.check_call(["file", str(inner)])
        subprocess.check_call(["lipo", "-info", str(inner)])

    print("wrote", inner)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

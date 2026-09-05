#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
DEST="$HOME/Library/Audio/Plug-Ins/VST3"
if [ ! -d "SkyForge.vst3" ]; then
  echo "SkyForge.vst3 is not next to this installer."
  echo "Unzip the whole Mac zip first, then run this again."
  read -r -p "Press Return to close "
  exit 1
fi
mkdir -p "$DEST"
rm -rf "$DEST/SkyForge.vst3"
cp -R "SkyForge.vst3" "$DEST/"
xattr -cr "$DEST/SkyForge.vst3" 2>/dev/null || true
echo
echo "SkyForge is in:"
echo "  $DEST/SkyForge.vst3"
echo
echo "Open Ableton Live → Settings → Plug-Ins → Rescan."
open "$DEST"
read -r -p "Press Return to close "

SkyForge for macOS — SoSkyride
Analog instrument for Ableton Live (VST3)
Intel + Apple Silicon. macOS 11 or newer.

Install
1. Unzip this file. Keep SkyForge.vst3 next to Install-SkyForge.command.
2. Double-click Install-SkyForge.command
   If macOS says it can’t be opened: right-click the command → Open → Open.
3. Ableton Live → Settings → Plug-Ins → Rescan.

Manual install (Terminal), from this folder:

  mkdir -p ~/Library/Audio/Plug-Ins/VST3
  cp -R SkyForge.vst3 ~/Library/Audio/Plug-Ins/VST3/
  xattr -cr ~/Library/Audio/Plug-Ins/VST3/SkyForge.vst3

That last line clears Gatekeeper. This build is signed ad-hoc (not Apple-notarized).
You do not need to disable SIP. Then rescan in Live.

Put SkyForge on a MIDI track. Arm the track. Play.

Computer keyboard: header Keys / MIDI switch.
- MIDI (default): computer keys write the clip. Arm, Record, click SkyForge, play A–L.
  Turn Live’s computer MIDI keyboard on (keyboard icon, or M). Z/X shift octave.
- Keys: SkyForge keeps the keys and sounds itself.

https://johnnyskyride.itch.io/skyforge

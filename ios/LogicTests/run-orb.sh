#!/bin/bash
# kosmos#7896: the KOSMOS orb's geometry (OrbLogic.swift), compiled for macOS and run, as run.sh does for the other
# UIKit-free files. Pass a directory to compile the app sources from somewhere else (to run against a broken copy);
# it must hold OrbLogic.swift, AgentsView.swift (the palette), ShellLogic.swift and Assets.xcassets, which the launch
# checks read.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../Kosmos}"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
# kosmos#7945: the launch screen first, so this prints exactly one VERDICT line: a failure here prints only its own
# VERDICT: FAIL and stops, and a pass leaves the orb suite's VERDICT as the only one (CI greps for a PASS line).
#
# Its colours are the app's palette (Palette.ground, Palette.starGold in AgentsView.swift), read here rather than
# trusted: change the palette without the launch screen and this fails, rather than the navy flash coming back silently.
palette() { grep -oE "static let $1 = pair\(0x[0-9a-fA-F]{6}, 0x[0-9a-fA-F]{6}\)" "$src/AgentsView.swift" | grep -oE '0x[0-9a-fA-F]{6}' | tr 'A-F' 'a-f'; }
ground=$(palette ground || true); gold=$(palette starGold || true)   # || true: a miss reaches the VERDICT below
[ "$(printf '%s\n' "$ground" | wc -l | tr -d ' ')" -eq 2 ] && [ "$(printf '%s\n' "$gold" | wc -l | tr -d ' ')" -eq 2 ] \
  || { echo "VERDICT: FAIL (could not read Palette.ground and Palette.starGold from AgentsView.swift)"; exit 1; }
colorset="$src/Assets.xcassets/LaunchBackground.colorset/Contents.json"
launch_hex() {   # the colorset's entry $1 (0 light, 1 dark) as 0xrrggbb
  local r g b
  r=$(plutil -extract "colors.$1.color.components.red" raw -o - "$colorset") || return 1
  g=$(plutil -extract "colors.$1.color.components.green" raw -o - "$colorset") || return 1
  b=$(plutil -extract "colors.$1.color.components.blue" raw -o - "$colorset") || return 1
  printf '0x%02x%02x%02x\n' "$r" "$g" "$b"
}
want_launch=$(printf '%s\n' "$ground")
have_launch=$( { launch_hex 0 && launch_hex 1; } 2>/dev/null || true)
[ "$have_launch" = "$want_launch" ] \
  || { echo "VERDICT: FAIL (LaunchBackground is $(echo $have_launch) but Palette.ground is $(echo $want_launch); the colorset's components must be 0xNN hex, as Xcode's 8-bit hex field writes them)"; exit 1; }
echo "ok   the launch ground is Palette.ground, light and dark ($(echo $want_launch))"
# Which entry is dark, and which PNG is which, by the catalog's own tags rather than by position or by file name.
[ "$(plutil -extract colors.0.appearances raw -o - "$colorset" 2>/dev/null || echo none)" = none ] \
  && [ "$(plutil -extract colors.1.appearances.0.value raw -o - "$colorset" 2>/dev/null || true)" = dark ] \
  || { echo "VERDICT: FAIL (LaunchBackground's second entry is not the dark one, or its first is not the plain one)"; exit 1; }
imageset="$src/Assets.xcassets/LaunchOrb.imageset/Contents.json"
seen=""
for i in 0 1 2 3 4 5; do
  file=$(plutil -extract "images.$i.filename" raw -o - "$imageset" 2>/dev/null || true)
  look=$(plutil -extract "images.$i.appearances.0.value" raw -o - "$imageset" 2>/dev/null || echo light)
  if plutil -extract "images.$i.appearances.0" raw -o - "$imageset" >/dev/null 2>&1; then
    [ "$(plutil -extract "images.$i.appearances.0.appearance" raw -o - "$imageset" 2>/dev/null || true)" = luminosity ] \
      || { echo "VERDICT: FAIL (LaunchOrb entry $i is tagged by something other than luminosity)"; exit 1; }
  fi
  scale=$(plutil -extract "images.$i.scale" raw -o - "$imageset" 2>/dev/null || true)
  case "$scale" in 1x) want="launch-orb-$look.png" ;; 2x|3x) want="launch-orb-$look@$scale.png" ;; *) want="" ;; esac
  [ -n "$want" ] && [ "$file" = "$want" ] \
    || { echo "VERDICT: FAIL (LaunchOrb entry $i shows ${file:-nothing} for the $look appearance at ${scale:-no} scale)"; exit 1; }
  seen="$seen $look-$scale"
done
# All six, each once: light and dark at 1x, 2x and 3x (six light entries would otherwise pass one by one).
[ "$(echo $seen | tr ' ' '\n' | sort -u | tr '\n' ' ')" = "dark-1x dark-2x dark-3x light-1x light-2x light-3x " ] \
  || { echo "VERDICT: FAIL (LaunchOrb's entries are$seen, not light and dark at 1x, 2x and 3x)"; exit 1; }
if plutil -extract images.6 raw -o - "$imageset" >/dev/null 2>&1; then
  echo "VERDICT: FAIL (LaunchOrb has more than the six entries this checks)"; exit 1
fi
echo "ok   the dark colour and the three dark PNGs are tagged dark; light and dark each at 1x, 2x and 3x"
have_gold=$( { grep -E '^let golds' "$here/../tools/launch-orb/main.swift" | grep -oE '0x[0-9a-fA-F]{2}, 0x[0-9a-fA-F]{2}, 0x[0-9a-fA-F]{2}' \
  | sed -E 's/0x([0-9a-fA-F]{2}), 0x([0-9a-fA-F]{2}), 0x([0-9a-fA-F]{2})/0x\1\2\3/' | tr 'A-F' 'a-f'; } || true)
[ "$have_gold" = "$(printf '%s\n' "$gold")" ] \
  || { echo "VERDICT: FAIL (the launch orb's golds are $(echo $have_gold) but Palette.starGold is $(echo $gold))"; exit 1; }
echo "ok   the launch orb's golds are Palette.starGold, light and dark ($(echo $gold))"
# The launch ground is right because a shipped launch opens on a native screen (sign-in or Agents). With the Today tab
# on, it opens on the navy board instead, so turning it on must bring the launch screen back into question.
# This reads the shipped (#else) line only: the KOSMOS_STORE_SHOTS build turns Today on and opens on the board, and is
# out of scope (it makes App Store screenshots, never a launch a person sees).
grep -qE '^[[:space:]]*static let todayTab = false([[:space:]]|$)' "$src/ShellLogic.swift" \
  || { echo "VERDICT: FAIL (AppTabs.todayTab is no longer off in shipped builds: the launch ground (#7945) assumed a native first screen)"; exit 1; }
echo "ok   a shipped launch opens on a native screen (Today off), so the launch ground matches it"
# The launch orb's PNGs, drawn again and compared, decoded, with the committed ones (pixels, with a small tolerance,
# not file bytes), so a change to OrbLogic cannot leave the launch screen's orb behind (ios/tools/render-launch-orb.sh).
xcrun swiftc -O -o "$out/render-launch-orb" "$src/OrbLogic.swift" "$here/../tools/launch-orb/main.swift"
if "$out/render-launch-orb" --check "$src/Assets.xcassets/LaunchOrb.imageset" 120 | grep -v '^ok$'; [ "${PIPESTATUS[0]}" -eq 0 ]; then
  echo "ok   the launch screen's orb matches OrbLogic (6 PNGs)"
else
  echo "VERDICT: FAIL (the launch screen's orb is stale)"; exit 1
fi

xcrun swiftc -O -o "$out/orb-logic-tests" "$src/OrbLogic.swift" "$here/orb/main.swift"
"$out/orb-logic-tests"

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
# kosmos#7945: the launch screen first, so the orb suite's own VERDICT line stays the last one this prints (a failure
# here prints only its own VERDICT: FAIL, and CI reads the first VERDICT line).
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
  || { echo "VERDICT: FAIL (LaunchBackground is $(echo $have_launch) but Palette.ground is $(echo $want_launch))"; exit 1; }
echo "ok   the launch ground is Palette.ground, light and dark ($(echo $want_launch))"
have_gold=$( { grep -E '^let golds' "$here/../tools/launch-orb/main.swift" | grep -oE '0x[0-9a-fA-F]{2}, 0x[0-9a-fA-F]{2}, 0x[0-9a-fA-F]{2}' \
  | sed -E 's/0x([0-9a-fA-F]{2}), 0x([0-9a-fA-F]{2}), 0x([0-9a-fA-F]{2})/0x\1\2\3/' | tr 'A-F' 'a-f'; } || true)
[ "$have_gold" = "$(printf '%s\n' "$gold")" ] \
  || { echo "VERDICT: FAIL (the launch orb's golds are $(echo $have_gold) but Palette.starGold is $(echo $gold))"; exit 1; }
echo "ok   the launch orb's golds are Palette.starGold, light and dark ($(echo $gold))"
# The launch ground is right because a shipped launch opens on a native screen (sign-in or Agents). With the Today tab
# on, it opens on the navy board instead, so turning it on must bring the launch screen back into question.
grep -qE '^    static let todayTab = false$' "$src/ShellLogic.swift" \
  || { echo "VERDICT: FAIL (AppTabs.todayTab is no longer off in shipped builds: the launch ground (#7945) assumed a native first screen)"; exit 1; }
echo "ok   a shipped launch opens on a native screen (Today off), so the launch ground matches it"
# The launch orb's PNGs, drawn again and compared, decoded, with the committed ones (pixels, with a small tolerance,
# not file bytes), so a change to OrbLogic cannot leave the launch screen's orb behind (ios/tools/render-launch-orb.sh).
xcrun swiftc -O -o "$out/render-launch-orb" "$src/OrbLogic.swift" "$here/../tools/launch-orb/main.swift"
if "$out/render-launch-orb" --check "$src/Assets.xcassets/LaunchOrb.imageset" 120; then
  echo "ok   the launch screen's orb matches OrbLogic (6 PNGs)"
else
  echo "VERDICT: FAIL (the launch screen's orb is stale)"; exit 1
fi

xcrun swiftc -O -o "$out/orb-logic-tests" "$src/OrbLogic.swift" "$here/orb/main.swift"
"$out/orb-logic-tests"


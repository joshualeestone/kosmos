#!/bin/bash
# kosmos#7954: the board's Sweep loader on the iPhone (SweepLogic.swift), compiled for macOS and run, as run-orb.sh does.
# It reads web/index.html from KOSMOS_REPO, so ios.board-parity-7084.test.js runs it in the board's own suite too.
# Pass a directory to compile the app sources from somewhere else (to run against a broken copy); it must hold
# SweepLogic.swift, SweepDots.swift, AgentsView.swift (the palette and the wait), ShellLogic.swift and Assets.xcassets,
# which the launch checks read. The #8058 checks (every wait, and the guard over ios/Kosmos and ios/KosmosNotice) read KOSMOS_REPO (this checkout) whatever
# directory is passed.
# The launch renderer and its render script (ios/tools/launch-sweep, render-launch-sweep.sh) are always read from this
# checkout, whatever directory is passed.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../Kosmos}"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
# kosmos#7945: the launch screen first, so this prints exactly one VERDICT line: a failure here prints only its own
# VERDICT: FAIL and stops, and a pass leaves the sweep suite's VERDICT as the only one (CI greps for a PASS line).
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
imageset="$src/Assets.xcassets/LaunchSweep.imageset/Contents.json"
seen=""
for i in 0 1 2 3 4 5; do
  file=$(plutil -extract "images.$i.filename" raw -o - "$imageset" 2>/dev/null || true)
  look=$(plutil -extract "images.$i.appearances.0.value" raw -o - "$imageset" 2>/dev/null || echo light)
  if plutil -extract "images.$i.appearances.0" raw -o - "$imageset" >/dev/null 2>&1; then
    [ "$(plutil -extract "images.$i.appearances.0.appearance" raw -o - "$imageset" 2>/dev/null || true)" = luminosity ] \
      || { echo "VERDICT: FAIL (LaunchSweep entry $i is tagged by something other than luminosity)"; exit 1; }
  fi
  scale=$(plutil -extract "images.$i.scale" raw -o - "$imageset" 2>/dev/null || true)
  case "$scale" in 1x) want="launch-sweep-$look.png" ;; 2x|3x) want="launch-sweep-$look@$scale.png" ;; *) want="" ;; esac
  [ -n "$want" ] && [ "$file" = "$want" ] \
    || { echo "VERDICT: FAIL (LaunchSweep entry $i shows ${file:-nothing} for the $look appearance at ${scale:-no} scale)"; exit 1; }
  seen="$seen $look-$scale"
done
# All six, each once: light and dark at 1x, 2x and 3x (six light entries would otherwise pass one by one).
[ "$(echo $seen | tr ' ' '\n' | sort -u | tr '\n' ' ')" = "dark-1x dark-2x dark-3x light-1x light-2x light-3x " ] \
  || { echo "VERDICT: FAIL (LaunchSweep's entries are$seen, not light and dark at 1x, 2x and 3x)"; exit 1; }
if plutil -extract images.6 raw -o - "$imageset" >/dev/null 2>&1; then
  echo "VERDICT: FAIL (LaunchSweep has more than the six entries this checks)"; exit 1
fi
echo "ok   the dark colour and the three dark PNGs are tagged dark; light and dark each at 1x, 2x and 3x"
have_gold=$( { grep -E '^let golds' "$here/../tools/launch-sweep/main.swift" | grep -oE '0x[0-9a-fA-F]{2}, 0x[0-9a-fA-F]{2}, 0x[0-9a-fA-F]{2}' \
  | sed -E 's/0x([0-9a-fA-F]{2}), 0x([0-9a-fA-F]{2}), 0x([0-9a-fA-F]{2})/0x\1\2\3/' | tr 'A-F' 'a-f'; } || true)
[ "$have_gold" = "$(printf '%s\n' "$gold")" ] \
  || { echo "VERDICT: FAIL (the launch mark's golds are $(echo $have_gold) but Palette.starGold is $(echo $gold))"; exit 1; }
echo "ok   the launch mark's golds are Palette.starGold, light and dark ($(echo $gold))"
# The launch ground is right because a shipped launch opens on a native screen (sign-in or Agents). With the Today tab
# on, it opens on the navy board instead, so turning it on must bring the launch screen back into question.
# This reads the shipped (#else) line only: the KOSMOS_STORE_SHOTS build turns Today on and opens on the board, and is
# out of scope (it makes App Store screenshots, never a launch a person sees).
grep -qE '^[[:space:]]*static let todayTab = false([[:space:]]|$)' "$src/ShellLogic.swift" \
  || { echo "VERDICT: FAIL (AppTabs.todayTab is no longer off in shipped builds: the launch ground (#7945) assumed a native first screen)"; exit 1; }
echo "ok   a shipped launch opens on a native screen (Today off), so the launch ground matches it"
# One ring, one size, one place (Josh 11-04 on build 43: the big orb, then a small one, was a jump). The launch mark is
# drawn at SweepDots' default side, and the first waits to connect (ConnectingWait) centre their ring on the SCREEN, as
# a launch image is, not on the space between the bars, which differs by iPhone.
side=$(grep -oE 'var size: CGFloat = [0-9.]+' "$src/SweepDots.swift" | grep -oE '[0-9.]+$' || true)
render_side=$(grep -oE 'LaunchSweep.imageset" [0-9.]+$' "$here/../tools/render-launch-sweep.sh" | grep -oE '[0-9.]+$' || true)
[ -n "$side" ] && [ "$side" = "$render_side" ] \
  || { echo "VERDICT: FAIL (the launch mark is drawn at ${render_side:-?} pt but SweepDots' default side is ${side:-?} pt)"; exit 1; }
# ConnectingWait's code with its // comments removed, so a comment cannot satisfy any of this. Its shape: the ring is the
# view that is centred (no stack, which would centre ring and words together and put the ring above the launch mark),
# the ring keeps one size at every text size (scales: false, as the launch picture is fixed), the frame fills the space,
# the words ride in an overlay on that frame (the screen's width, so they wrap at large text sizes) with their top 18 pt
# below its centre (half the ring, then 8 pt), and the whole is stretched over the safe areas, in that order.
wait_view=$(awk '/^struct ConnectingWait: View/{on=1} on{print} on&&/^}$/{exit}' "$src/SweepDots.swift" | sed 's#//.*##')
order=$(printf '%s\n' "$wait_view" | grep -oE 'SweepDots\([^)]*\)|\.overlay\(alignment: [.a-z]+\)|Text\(words\)|\.fixedSize\([^)]*\)|\.alignmentGuide\([^)]*\) \{ _ in -?[0-9]+ \}|\.frame\(maxWidth: \.infinity, maxHeight: \.infinity\)|\.ignoresSafeArea\(\)|VStack|HStack|ZStack' | tr '\n' '|' || true)
[ "$order" = 'SweepDots(scales: false)|.frame(maxWidth: .infinity, maxHeight: .infinity)|.overlay(alignment: .center)|Text(words)|.fixedSize(horizontal: false, vertical: true)|.alignmentGuide(VerticalAlignment.center) { _ in -18 }|.ignoresSafeArea()|' ] \
  || { echo "VERDICT: FAIL (ConnectingWait is no longer the ring alone, one size, centred on the screen, words across the screen 8 pt below it; read: ${order:-nothing}; so it would not sit where the launch mark is)"; exit 1; }
# Both first waits that can follow the launch screen draw it: Agents (its reaching wait) and Projects (a launch from a
# room notification opens there).
reaching=$(awk '/private var reaching: some View/{on=1} on{print} on&&/^    }$/{exit}' "$src/AgentsView.swift" | sed 's#//.*##')
# kosmos#8193: grep -c, not grep -q, after a pipe. Under pipefail, grep -q stops reading at its first match, the writer
# then dies of SIGPIPE (141) and the pipeline reads as a failure: the check failed precisely because it matched. grep -c
# reads to the end and still exits 1 when nothing matches.
printf '%s\n' "$reaching" | grep -cE '^[[:space:]]*ConnectingWait\(words: "Connecting\\u\{2026\}"\)[[:space:]]*$' >/dev/null \
  || { echo "VERDICT: FAIL (the Agents tab's wait to connect is no longer ConnectingWait, so it would not sit where the launch mark is)"; exit 1; }
sed 's#//.*##' "$src/ProjectsView.swift" | grep -cE 'ConnectingWait\(words: "Reaching your computer\\u\{2026\}"\)' >/dev/null \
  || { echo "VERDICT: FAIL (the Projects tab's first wait, where a launch from a room notification opens, is no longer ConnectingWait)"; exit 1; }
# One place draws the wait (BoardStates' body): two would be two view identities, and a phase change from one to the
# other mid-wait would restart the loop at its first frame (SweepDots runs from when it appears).
uses=$(awk '/^struct BoardStates/{on=1} on{print} on&&/^}$/{exit}' "$src/AgentsView.swift" | sed 's#//.*##' \
  | grep -vE 'private var reaching: some View' | grep -oE '(^|[^A-Za-z_])reaching([^A-Za-z_]|$)' | wc -l | tr -d ' ' || true)
[ "$uses" = 1 ] \
  || { echo "VERDICT: FAIL (BoardStates draws the wait to connect in ${uses:-?} places, not one, so a change of phase mid-wait restarts its ring)"; exit 1; }
# SweepDots draws SweepLogic.shown from when it appeared, whose first frame is the launch screen's (sweep/main.swift).
grep -qE 'let elapsed = tl\.date\.timeIntervalSince\(shownAt\)' "$src/SweepDots.swift" \
  && grep -qE 'SweepLogic\.shown\(elapsed, ' "$src/SweepDots.swift" \
  || { echo "VERDICT: FAIL (SweepDots no longer draws SweepLogic.shown from when it appeared, so its first frame is not the launch screen's)"; exit 1; }
echo "ok   the launch mark is SweepDots' $side pt ring at its first frame, and the wait to connect centres it on the screen as the launch screen does"
# The launch mark's PNGs, drawn again and compared, decoded, with the committed ones (pixels, with a small tolerance,
# not file bytes), so a change to SweepLogic cannot leave the launch screen behind (ios/tools/render-launch-sweep.sh).
xcrun swiftc -O -o "$out/render-launch-sweep" "$src/SweepLogic.swift" "$here/../tools/launch-sweep/main.swift"
if "$out/render-launch-sweep" --check "$src/Assets.xcassets/LaunchSweep.imageset" "$side" | grep -v '^ok$'; [ "${PIPESTATUS[0]}" -eq 0 ]; then
  echo "ok   the launch screen's mark matches SweepLogic (6 PNGs)"
else
  echo "VERDICT: FAIL (the launch screen's mark is stale)"; exit 1
fi

xcrun swiftc -O -o "$out/sweep-logic-tests" "$src/SweepLogic.swift" "$here/sweep/main.swift"
KOSMOS_REPO="$here/../.." "$out/sweep-logic-tests"

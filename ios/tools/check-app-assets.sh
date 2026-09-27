#!/bin/bash
# The app icon and the navy launch screen, checked in a BUILT app (#3643). The store rejects an
# upload with no app icon, and a launch screen that names a colour the catalog does not hold
# shows white, so both are read from what the build produced, not from the project file.
#
# Needs a Mac with the iOS simulator runtime, because the asset catalog does not compile without
# it; CI has one (.github/workflows/ios.yml).
# Usage: ios/tools/check-app-assets.sh <path to Kosmos.app>
# Ends with one VERDICT line; no verdict line means the check did not finish.
set -u
app="${1:?usage: check-app-assets.sh <Kosmos.app>}"
plist="$app/Info.plist"
car="$app/Assets.car"
[ -s "$plist" ] || { echo "check-app-assets: no Info.plist at $plist"; echo "VERDICT: FAIL"; exit 2; }
fail=0

icon=$(plutil -extract CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconName raw -o - "$plist" 2>/dev/null)
if [ "$icon" = "AppIcon" ]; then echo "ok       Info.plist names the app icon: $icon"
else echo "MISSING  Info.plist CFBundleIcons names no AppIcon (got '${icon}')"; fail=1; fi

launch=$(plutil -extract UILaunchScreen.UIColorName raw -o - "$plist" 2>/dev/null)
if [ "$launch" = "LaunchBackground" ]; then echo "ok       launch screen colour: $launch"
else echo "MISSING  UILaunchScreen.UIColorName is not LaunchBackground (got '${launch}')"; fail=1; fi

if [ -s "$car" ]; then
  info=$(xcrun assetutil --info "$car" 2>/dev/null)
  # The compiled catalog must hold both names the Info.plist points at.
  if printf '%s' "$info" | grep -q '"Name" : "AppIcon"'; then echo "ok       Assets.car holds AppIcon"
  else echo "MISSING  Assets.car holds no AppIcon"; fail=1; fi
  if printf '%s' "$info" | grep -q '"Name" : "LaunchBackground"'; then echo "ok       Assets.car holds LaunchBackground"
  else echo "MISSING  Assets.car holds no LaunchBackground"; fail=1; fi
else
  echo "MISSING  no compiled asset catalog at $car"; fail=1
fi

[ "$fail" -eq 0 ] && echo "VERDICT: PASS" || echo "VERDICT: FAIL"
exit "$fail"

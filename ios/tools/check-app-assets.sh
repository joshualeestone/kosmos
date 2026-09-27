#!/bin/bash
# Checks the BUILT app carries the app icon and the navy launch screen (kosmos #4089, #718).
# App Store Connect refuses an upload with no icon, and a launch screen that lost its colour
# shows white before the navy first screen, so check what was built, not the project settings.
#
#   - Info.plist names the icon (CFBundleIcons > CFBundlePrimaryIcon > CFBundleIconName = AppIcon)
#     and the launch colour (UILaunchScreen > UIColorName = LaunchBackground);
#   - Assets.car exists and holds both of those names (assetutil reads the compiled catalog);
#   - the icon in the repo's catalog is byte-for-byte assets/Kosmos-1024.png, so the artwork has
#     one source.
#
# Usage: ios/tools/check-app-assets.sh <path to built Kosmos.app>
# Ends with one VERDICT line; no verdict line means the check did not finish.
set -u
app="${1:?usage: check-app-assets.sh <Kosmos.app>}"
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
plist="$app/Info.plist"
[ -s "$plist" ] || { echo "check-app-assets: no Info.plist at $plist"; echo "VERDICT: FAIL"; exit 2; }

fail=0
expect_key() { # key-path wanted
  local got
  got=$(plutil -extract "$1" raw -o - "$plist" 2>/dev/null)
  if [ "$got" = "$2" ]; then echo "ok       $1: $got"; else echo "WRONG    $1: ${got:-<absent>} (want $2)"; fail=1; fi
}
expect_key CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconName AppIcon
expect_key UILaunchScreen.UIColorName LaunchBackground

car="$app/Assets.car"
if [ -s "$car" ]; then
  info=$(xcrun --sdk iphoneos assetutil --info "$car" 2>/dev/null)
  for name in AppIcon LaunchBackground; do
    if printf '%s\n' "$info" | grep -q "\"Name\" : \"$name\""; then
      echo "ok       Assets.car holds $name"
    else
      echo "MISSING  Assets.car does not hold $name"; fail=1
    fi
  done
else
  echo "MISSING  $car (the asset catalog was not compiled into the app)"; fail=1
fi

if cmp -s "$repo/assets/Kosmos-1024.png" "$repo/ios/Kosmos/Assets.xcassets/AppIcon.appiconset/AppIcon.png"; then
  echo "ok       the catalog icon is assets/Kosmos-1024.png"
else
  echo "WRONG    ios/Kosmos/Assets.xcassets/AppIcon.appiconset/AppIcon.png differs from assets/Kosmos-1024.png"; fail=1
fi

[ "$fail" -eq 0 ] && echo "VERDICT: PASS" || echo "VERDICT: FAIL"
exit "$fail"

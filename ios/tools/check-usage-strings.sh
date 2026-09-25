#!/bin/bash
# The permission strings iOS requires before it lets the app use a feature
# (kosmos#718). Without one, iOS closes the app the moment the feature is used,
# and App Review tests exactly that. The board's file and photo pickers offer
# Take Photo/Video inside the WebView, and a long-pressed image offers Add to
# Photos, so the camera, microphone and photo-add strings are needed even though
# no Swift code asks for them.
#
# Reads the BUILT app's Info.plist (the strings are INFOPLIST_KEY_* build
# settings, not a file in the repo), so it checks what ships.
# Usage: ios/tools/check-usage-strings.sh <path to Kosmos.app/Info.plist>
set -u
plist="${1:?usage: check-usage-strings.sh <Kosmos.app/Info.plist>}"
[ -s "$plist" ] || { echo "check-usage-strings: no Info.plist at $plist"; exit 2; }
fail=0
for key in NSCameraUsageDescription NSMicrophoneUsageDescription NSPhotoLibraryAddUsageDescription NSFaceIDUsageDescription; do
  value=$(plutil -extract "$key" raw -o - "$plist" 2>/dev/null)
  if [ -z "$value" ]; then
    echo "MISSING  $key"
    fail=1
  else
    echo "ok       $key: $value"
  fi
done
[ "$fail" -eq 0 ] && echo "VERDICT: PASS" || echo "VERDICT: FAIL"
exit "$fail"

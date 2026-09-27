#!/bin/bash
# Archive the Kosmos iOS app for the App Store and export it (#3643).
#
#   ios/tools/archive.sh            archive, export a signed .ipa, check its entitlements
#   ios/tools/archive.sh --upload   the same, then upload that archive to App Store Connect
#
# Nothing is uploaded without --upload. The export to disk always comes first, because the
# entitlements can only be checked on a file that exists: an upload goes straight from the
# archive to Apple and leaves nothing here to look at.
#
# The Team ID is read from ios/Team.xcconfig and nowhere else. The script refuses to run
# while it is empty.
#
# Signing and upload use the Apple account signed in to Xcode on this Mac. To use an App Store
# Connect API key instead (a Mac nobody has signed in to), set all three:
#   ASC_KEY_PATH=/path/AuthKey_XXXX.p8  ASC_KEY_ID=XXXX  ASC_ISSUER_ID=<uuid>
#
# Output goes to ios/build/archive/ (ignored by git). Ends with one VERDICT line.
set -euo pipefail

UPLOAD=0
case "${1:-}" in
  '') ;;
  --upload) UPLOAD=1 ;;
  *) echo "usage: $0 [--upload]" >&2; exit 2 ;;
esac

IOS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEAM_FILE="$IOS_DIR/Team.xcconfig"
OUT="$IOS_DIR/build/archive"

TEAM="$(sed -n 's/^[[:space:]]*DEVELOPMENT_TEAM[[:space:]]*=[[:space:]]*\([^[:space:]]*\)[[:space:]]*$/\1/p' "$TEAM_FILE" | tail -1)"
if [ -z "$TEAM" ]; then
  echo "archive: no Team ID yet. Put the Kosmos Agent Manager, Inc. Team ID in ios/Team.xcconfig" >&2
  echo "         (DEVELOPMENT_TEAM = <ten characters>), then run this again." >&2
  echo "VERDICT: FAIL"; exit 1
fi
case "$TEAM" in
  [A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9]) ;;
  *) echo "archive: '$TEAM' in ios/Team.xcconfig is not a Team ID (ten capital letters and digits)" >&2
     echo "VERDICT: FAIL"; exit 1 ;;
esac

AUTH=()
if [ -n "${ASC_KEY_PATH:-}${ASC_KEY_ID:-}${ASC_ISSUER_ID:-}" ]; then
  if [ -z "${ASC_KEY_PATH:-}" ] || [ -z "${ASC_KEY_ID:-}" ] || [ -z "${ASC_ISSUER_ID:-}" ]; then
    echo "archive: set all three of ASC_KEY_PATH, ASC_KEY_ID and ASC_ISSUER_ID, or none" >&2
    echo "VERDICT: FAIL"; exit 1
  fi
  AUTH=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi

rm -rf "$OUT"
mkdir -p "$OUT"
ARCHIVE="$OUT/Kosmos.xcarchive"

echo "== Archiving (Release, team $TEAM)"
xcodebuild -project "$IOS_DIR/Kosmos.xcodeproj" -scheme Kosmos -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"} archive

# The committed options say destination=upload. The copy used for the local export says
# export, and both copies get the team from Team.xcconfig, so the committed file never holds it.
opts() {  # $1 = destination, $2 = output path
  cp "$IOS_DIR/ExportOptions.plist" "$2"
  /usr/libexec/PlistBuddy -c "Set :destination $1" "$2"
  /usr/libexec/PlistBuddy -c "Add :teamID string $TEAM" "$2"
}

echo "== Exporting a signed .ipa to $OUT/export"
opts export "$OUT/ExportOptions-export.plist"
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$OUT/export" \
  -exportOptionsPlist "$OUT/ExportOptions-export.plist" \
  -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"}

IPA=""
for f in "$OUT"/export/*.ipa; do [ -f "$f" ] && IPA="$f" && break; done
[ -n "$IPA" ] || { echo "archive: the export produced no .ipa in $OUT/export" >&2; echo "VERDICT: FAIL"; exit 1; }

echo "== Checking the exported app's entitlements"
if ! "$IOS_DIR/tools/check-ipa-entitlements.sh" "$IPA"; then
  echo "archive: not uploading a build whose entitlements are wrong" >&2
  echo "VERDICT: FAIL"; exit 1
fi

if [ "$UPLOAD" -eq 1 ]; then
  echo "== Uploading to App Store Connect"
  opts upload "$OUT/ExportOptions-upload.plist"
  xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$OUT/upload" \
    -exportOptionsPlist "$OUT/ExportOptions-upload.plist" \
    -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"}
  echo "Uploaded. The build appears in App Store Connect under TestFlight once Apple has processed it."
else
  echo "Not uploaded (run with --upload to send this archive to App Store Connect)."
fi
echo "VERDICT: PASS  $IPA"

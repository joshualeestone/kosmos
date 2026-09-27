#!/bin/bash
# Archive, export and (with --upload) upload the iOS app to App Store Connect (kosmos #4089, #718).
#
# Ready for the day Apple approves the Kosmos Agent Manager, Inc. developer org (#3643). Until then
# it stops at the first check below, because there is no Team ID to sign with.
#
#   ios/tools/archive.sh --build <N>            archive + export an .ipa, then check it
#   ios/tools/archive.sh --build <N> --upload   the same, then upload that build to App Store Connect
#
# --build is required: App Store Connect refuses a build number it has seen before, so the number is
# chosen on purpose for every upload rather than read from the project.
#
# The Team ID comes from ios/Signing.xcconfig and nowhere else. Signing is automatic, so the Mac
# running this needs Xcode signed in to an Apple ID on that team (Xcode, Settings, Accounts), or an
# App Store Connect API key given as ASC_KEY_PATH (the AuthKey_<id>.p8 file), ASC_KEY_ID and
# ASC_ISSUER_ID. --upload needs the key.
#
# Nothing is uploaded unless the exported .ipa passes check-ipa-entitlements.sh (push must be
# production), and the upload sends that same .ipa file, so a build that could never receive a
# push does not reach TestFlight.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
ios=$(cd "$here/.." && pwd)

build=""
upload=0
while [ $# -gt 0 ]; do
  case "$1" in
    --build) build="${2:-}"; shift 2 ;;
    --upload) upload=1; shift ;;
    -h|--help) sed -n '2,21p' "$0"; exit 0 ;;
    *) echo "archive.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done
case "$build" in
  ''|*[!0-9]*) echo "archive.sh: --build <N> is required, a whole number higher than any build already uploaded" >&2; exit 2 ;;
esac

team=$(sed -n 's/^DEVELOPMENT_TEAM *= *\([^ ]*\) *$/\1/p' "$ios/Signing.xcconfig")
case "$team" in
  [A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9]) ;;
  '') echo "archive.sh: DEVELOPMENT_TEAM is empty in ios/Signing.xcconfig. Set it to the Kosmos Agent Manager, Inc. Team ID once Apple approves the org (#3643)." >&2; exit 1 ;;
  *) echo "archive.sh: DEVELOPMENT_TEAM in ios/Signing.xcconfig is '$team', not a 10-character Team ID." >&2; exit 1 ;;
esac

auth=(-allowProvisioningUpdates)
if [ "$upload" -eq 1 ] && [ -z "${ASC_KEY_PATH:-}" ]; then
  echo "archive.sh: --upload needs an App Store Connect API key (ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID). Without one, run without --upload and send the checked .ipa with Apple's Transporter app." >&2
  exit 2
fi
if [ -n "${ASC_KEY_PATH:-}" ]; then
  [ -f "$ASC_KEY_PATH" ] || { echo "archive.sh: no key file at ASC_KEY_PATH=$ASC_KEY_PATH" >&2; exit 2; }
  : "${ASC_KEY_ID:?ASC_KEY_PATH is set, so ASC_KEY_ID must be too}"
  : "${ASC_ISSUER_ID:?ASC_KEY_PATH is set, so ASC_ISSUER_ID must be too}"
  auth+=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi

out="$ios/build/archive-$build"
rm -rf "$out"
mkdir -p "$out"
archive="$out/Kosmos.xcarchive"

# The export options are committed without a team; this copy gets the one from Signing.xcconfig.
options="$out/ExportOptions.plist"
cp "$here/ExportOptions.plist" "$options"
/usr/libexec/PlistBuddy -c "Add :teamID string $team" "$options"

echo "== archive: team $team, build $build"
xcodebuild -project "$ios/Kosmos.xcodeproj" -scheme Kosmos -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$archive" \
  CURRENT_PROJECT_VERSION="$build" "${auth[@]}" archive

echo "== export"
xcodebuild -exportArchive -archivePath "$archive" -exportOptionsPlist "$options" \
  -exportPath "$out/export" "${auth[@]}"

ipa=$(find "$out/export" -maxdepth 1 -name '*.ipa' | head -1)
[ -n "$ipa" ] || { echo "archive.sh: the export wrote no .ipa into $out/export" >&2; exit 1; }

echo "== check $ipa"
"$here/check-ipa-entitlements.sh" "$ipa"

if [ "$upload" -eq 0 ]; then
  echo "Exported and checked: $ipa"
  echo "Not uploaded. Run again with --upload to send build $build to App Store Connect."
  exit 0
fi

echo "== upload build $build"
# altool finds the key by name (AuthKey_<id>.p8) in API_PRIVATE_KEYS_DIR.
[ "$(basename "$ASC_KEY_PATH")" = "AuthKey_$ASC_KEY_ID.p8" ] || {
  echo "archive.sh: the key file must be named AuthKey_$ASC_KEY_ID.p8 for the upload tool to find it" >&2; exit 2; }
API_PRIVATE_KEYS_DIR=$(dirname "$ASC_KEY_PATH") xcrun altool --upload-app --type ios --file "$ipa" \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
echo "Uploaded build $build. It shows in App Store Connect, TestFlight, once Apple has processed it."

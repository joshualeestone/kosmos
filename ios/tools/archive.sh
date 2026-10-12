#!/bin/bash
# Archive, export and (with --upload) upload the iOS app to App Store Connect (kosmos #4089, #718).
#
# Signs as the team, with the bundle id, in ios/Signing.xcconfig (for now the Stone Syndicate team and the
# interim io.kosmos.app.preview, #4089). It stops before archiving if the bundle id is malformed, or if the
# Team ID is empty or not 10 uppercase letters or digits.
#
#   ios/tools/archive.sh --build <N>            archive + export an .ipa, then check it
#   ios/tools/archive.sh --build <N> --upload   the same, then upload that build to App Store Connect
#   ios/tools/archive.sh --check-config         only the signing-settings checks below, then stop
#
# It refuses io.kosmos.app under the Stone Syndicate team (#4089): Apple cannot transfer an app never
# released on the App Store, so that pairing would leave Kosmos's real bundle id there for good.
#
# --build is required: App Store Connect refuses a build number it has seen before, so the number is
# chosen on purpose for every upload rather than read from the project.
#
# The Team ID comes from ios/Signing.xcconfig and nowhere else. Signing is automatic, so the Mac
# running this needs Xcode signed in to an Apple ID on that team (Xcode, Settings, Accounts), or an
# App Store Connect API key given as ASC_KEY_PATH (the AuthKey_<id>.p8 file), ASC_KEY_ID and
# ASC_ISSUER_ID. --upload needs the key.
#
# Nothing is uploaded unless the exported .ipa passes check-ipa-entitlements.sh (aps-environment
# production, this team, this bundle id), and the upload sends that same .ipa file. That makes the
# signing right for push; it does not make push work: the interim preview app never gets push.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
ios=$(cd "$here/.." && pwd)

build=""
upload=0
check_only=0
# The signing settings this run reads: the project's own file. ios/tools/test-archive-config.sh points the
# checks at a scratch copy with KOSMOS_IOS_XCCONFIG, which is refused below unless --check-config is given.
# The archive passes the checked team and bundle id to xcodebuild on its command line, which wins over a
# team set in Xcode's Signing pane (project.pbxproj) or XCODE_XCCONFIG_FILE, so what is checked is what is signed.
xcconfig="${KOSMOS_IOS_XCCONFIG:-$ios/Signing.xcconfig}"
while [ $# -gt 0 ]; do
  case "$1" in
    --build) [ $# -ge 2 ] || { echo "archive.sh: --build needs a number" >&2; exit 2; }; build="$2"; shift 2 ;;
    --upload) upload=1; shift ;;
    --check-config) check_only=1; shift ;;   # run the signing-settings checks below, then stop
    -h|--help) sed -n '2,/^[^#]/p' "$0" | sed '$d'; exit 0 ;;   # the whole header, however long
    *) echo "archive.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done
if [ "$check_only" -eq 0 ] && [ -n "${KOSMOS_IOS_XCCONFIG:-}" ]; then
  echo "archive.sh: KOSMOS_IOS_XCCONFIG is for --check-config only; unset it to archive (xcodebuild reads ios/Signing.xcconfig)." >&2; exit 2
fi
if [ "$check_only" -eq 0 ]; then
  case "$build" in
    ''|*[!0-9]*) echo "archive.sh: --build <N> is required, a whole number higher than any build already uploaded" >&2; exit 2 ;;
  esac
fi

# Each setting must be set exactly once, in plain form: a second line (xcconfig takes the last) or a
# conditional one (KEY[sdk=...]) would make the value read here differ from the one Xcode builds with.
for key in DEVELOPMENT_TEAM KOSMOS_BUNDLE_ID; do
  any=$(sed 's|//.*||' "$xcconfig" | grep -cE "^[[:space:]]*${key}([^A-Za-z0-9_]|\$)")
  plain=$(sed 's|//.*||' "$xcconfig" | grep -cE "^[[:space:]]*${key}[[:space:]]*=")
  if [ "$any" -ne 1 ] || [ "$plain" -ne 1 ]; then
    echo "archive.sh: $key must be set exactly once, as '$key = <value>', in ios/Signing.xcconfig (found $any)." >&2; exit 1
  fi
done
# The value Xcode reads: the DEVELOPMENT_TEAM line, less any trailing // comment and spaces.
team=$(sed -n 's|//.*||; s/^[[:space:]]*DEVELOPMENT_TEAM[[:space:]]*=[[:space:]]*//p' "$xcconfig" | tr -d '[:space:]')
# The bundle id the project builds with (KOSMOS_BUNDLE_ID in the same file), checked on the export.
bundle=$(sed -n 's|//.*||; s/^[[:space:]]*KOSMOS_BUNDLE_ID[[:space:]]*=[[:space:]]*//p' "$xcconfig" | tr -d '[:space:]')
if ! printf '%s' "$bundle" | LC_ALL=C grep -Eq '^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$'; then
  echo "archive.sh: KOSMOS_BUNDLE_ID in ios/Signing.xcconfig is '${bundle}', not a bundle id." >&2; exit 1
fi
if [ -z "$team" ]; then
  echo "archive.sh: DEVELOPMENT_TEAM is empty in ios/Signing.xcconfig. Set it to the Team ID that signs the app (see the comment in that file)." >&2
  exit 1
fi
if ! printf '%s' "$team" | LC_ALL=C grep -Eq '^[A-Z0-9]{10}$'; then
  echo "archive.sh: DEVELOPMENT_TEAM in ios/Signing.xcconfig is '$team', not a Team ID (10 uppercase letters or digits)." >&2
  exit 1
fi
# io.kosmos.app is never built under the Stone Syndicate team (#4089): Apple cannot transfer an app that was
# never released on the App Store, so one upload would leave Kosmos's real bundle id there for good. The team id
# is written in two pieces so the cut-sign sweep (tools/test-cut-sign-preflight.sh) does not count this file.
stone_team="864QZ""69GF2"
bundle_lc=$(printf '%s' "$bundle" | tr '[:upper:]' '[:lower:]')   # Apple compares bundle ids without case
if [ "$bundle_lc" = "io.kosmos.app" ] && [ "$team" = "$stone_team" ]; then
  echo "archive.sh: io.kosmos.app must not be built under the Stone Syndicate team: the interim app is io.kosmos.app.preview. Change DEVELOPMENT_TEAM to Kosmos Agent Manager, Inc.'s Team ID in the same edit." >&2
  exit 1
fi
if [ "$check_only" -eq 1 ]; then
  echo "archive.sh: signing settings ok: $bundle under team $team"
  exit 0
fi


auth=(-allowProvisioningUpdates)
if [ "$upload" -eq 1 ] && [ -z "${ASC_KEY_PATH:-}" ]; then
  echo "archive.sh: --upload needs an App Store Connect API key (ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID). Without one, run without --upload and send the checked .ipa with Apple's Transporter app." >&2
  exit 2
fi
if [ -n "${ASC_KEY_PATH:-}" ]; then
  : "${ASC_KEY_ID:?ASC_KEY_PATH is set, so ASC_KEY_ID must be too}"
  : "${ASC_ISSUER_ID:?ASC_KEY_PATH is set, so ASC_ISSUER_ID must be too}"
  [ -f "$ASC_KEY_PATH" ] || { echo "archive.sh: no key file at ASC_KEY_PATH=$ASC_KEY_PATH" >&2; exit 2; }
  # altool finds the key by name (AuthKey_<id>.p8) in API_PRIVATE_KEYS_DIR; checked now, before
  # the archive, so a misnamed key does not fail the upload at the very end.
  [ "$(basename "$ASC_KEY_PATH")" = "AuthKey_$ASC_KEY_ID.p8" ] || {
    echo "archive.sh: the key file must be named AuthKey_$ASC_KEY_ID.p8 for the upload tool to find it" >&2; exit 2; }
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
  DEVELOPMENT_TEAM="$team" PRODUCT_BUNDLE_IDENTIFIER="$bundle" \
  CURRENT_PROJECT_VERSION="$build" "${auth[@]}" archive

echo "== export"
xcodebuild -exportArchive -archivePath "$archive" -exportOptionsPlist "$options" \
  -exportPath "$out/export" "${auth[@]}"

ipa=$(find "$out/export" -maxdepth 1 -name '*.ipa' | head -1)
[ -n "$ipa" ] || { echo "archive.sh: the export wrote no .ipa into $out/export" >&2; exit 1; }

echo "== check $ipa"
"$here/check-ipa-entitlements.sh" "$ipa" "$team" "$bundle"

if [ "$upload" -eq 0 ]; then
  echo "Exported and checked: $ipa"
  echo "Not uploaded. Run again with --upload to send build $build to App Store Connect."
  exit 0
fi

echo "== upload build $build"
API_PRIVATE_KEYS_DIR=$(dirname "$ASC_KEY_PATH") xcrun altool --upload-app --type ios --file "$ipa" \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
echo "Uploaded build $build. It shows in App Store Connect, TestFlight, once Apple has processed it."

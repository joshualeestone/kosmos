#!/bin/bash
# Checks the push entitlement in an EXPORTED app before it goes to Apple (kosmos #4089, #718).
#
# Kosmos.entitlements says aps-environment = development, and the export for App Store Connect is
# expected to re-sign it as production. If it does not, every device token the store build hands
# the coordinator is a sandbox token, and pushes to TestFlight and App Store phones fail. So this
# reads the entitlements the exported app is actually signed with, not the file in the repo.
#
# Also refuses get-task-allow = true (a development-signed build, which App Store Connect rejects)
# and an app identifier that is not io.kosmos.app (the bundle id KOSMOS_APNS_BUNDLE_IDS allows).
# Given a Team ID, it also refuses a signature from any other team: tokens from an app signed under
# another team are ones the coordinator's APNs key cannot send to.
#
# Usage: ios/tools/check-ipa-entitlements.sh <Kosmos.ipa | Kosmos.app> [TEAM_ID]
# Ends with one VERDICT line; no verdict line means the check did not finish.
set -u
target="${1:?usage: check-ipa-entitlements.sh <Kosmos.ipa | Kosmos.app> [TEAM_ID]}"
team="${2:-}"
[ -e "$target" ] || { echo "check-ipa-entitlements: nothing at $target"; echo "VERDICT: FAIL"; exit 2; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
case "$target" in
  *.ipa)
    if ! unzip -q "$target" -d "$work"; then
      echo "check-ipa-entitlements: could not unzip $target"; echo "VERDICT: FAIL"; exit 2
    fi
    app=$(find "$work/Payload" -maxdepth 1 -name '*.app' -type d 2>/dev/null | head -1)
    ;;
  *) app="$target" ;;
esac
[ -n "$app" ] && [ -d "$app" ] || { echo "check-ipa-entitlements: no .app inside $target"; echo "VERDICT: FAIL"; exit 2; }

ents="$work/entitlements.plist"
if ! codesign -d --entitlements - --xml "$app" > "$ents" 2>/dev/null || [ ! -s "$ents" ]; then
  echo "check-ipa-entitlements: $app carries no readable entitlements (is it signed?)"
  echo "VERDICT: FAIL"; exit 1
fi

fail=0
aps=$(plutil -extract aps-environment raw -o - "$ents" 2>/dev/null)
if [ "$aps" = "production" ]; then
  echo "ok       aps-environment: production"
else
  echo "WRONG    aps-environment: ${aps:-<absent>} (must be production)"
  fail=1
fi
gta=$(plutil -extract get-task-allow raw -o - "$ents" 2>/dev/null)
if [ "$gta" = "true" ]; then
  echo "WRONG    get-task-allow: true (a development signature)"
  fail=1
else
  echo "ok       get-task-allow: ${gta:-<absent>}"
fi
appid=$(plutil -extract application-identifier raw -o - "$ents" 2>/dev/null)
want_appid="$team.io.kosmos.app"
case "$appid" in
  *.io.kosmos.app)
    if [ -n "$team" ] && [ "$appid" != "$want_appid" ]; then
      echo "WRONG    application-identifier: $appid (must be $want_appid)"; fail=1
    else
      echo "ok       application-identifier: $appid"
    fi ;;
  *) echo "WRONG    application-identifier: ${appid:-<absent>} (must end in .io.kosmos.app)"; fail=1 ;;
esac
if [ -n "$team" ]; then
  # PlistBuddy, not plutil: plutil reads the dots in this key as a path and never finds it.
  signed_team=$(/usr/libexec/PlistBuddy -c 'Print :com.apple.developer.team-identifier' "$ents" 2>/dev/null)
  if [ "$signed_team" = "$team" ]; then
    echo "ok       com.apple.developer.team-identifier: $signed_team"
  else
    echo "WRONG    com.apple.developer.team-identifier: ${signed_team:-<absent>} (must be $team, from ios/Signing.xcconfig)"; fail=1
  fi
fi

[ "$fail" -eq 0 ] && echo "VERDICT: PASS" || echo "VERDICT: FAIL"
exit "$fail"

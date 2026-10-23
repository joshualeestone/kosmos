#!/bin/bash
# Checks the push entitlement in an EXPORTED app before it goes to Apple (kosmos #4089, #718).
#
# Kosmos.entitlements says aps-environment = development, and the export for App Store Connect is
# expected to re-sign it as production. If it does not, every device token the store build hands
# the coordinator is a sandbox token, and pushes to TestFlight and App Store phones fail. So this
# reads the entitlements the exported app is actually signed with, not the file in the repo.
#
# Also refuses get-task-allow = true (a development-signed build, which App Store Connect rejects)
# and an app identifier for any bundle id but the expected one (the third argument, io.kosmos.app
# when not given: the bundle id KOSMOS_APNS_BUNDLE_IDS allows).
# Given a Team ID, it also refuses a signature from any other team: tokens from an app signed under
# another team are ones the coordinator's APNs key cannot send to.
# And it refuses an app built for the App Store screenshots (KOSMOS_STORE_SHOTS, #6262), which opens a
# given address instead of Kosmos+ (check-no-shots-flag.sh).
#
# And (kosmos#6487) it checks the notification extension inside the app is signed as <bundle>.notice by the same team,
# is not a development build, and shares the app's keychain group.
#
# Usage: ios/tools/check-ipa-entitlements.sh <Kosmos.ipa | Kosmos.app> [TEAM_ID] [BUNDLE_ID]
# Ends with one VERDICT line; no verdict line means the check did not finish.
set -u
target="${1:?usage: check-ipa-entitlements.sh <Kosmos.ipa | Kosmos.app> [TEAM_ID] [BUNDLE_ID]}"
team="${2:-}"
bundle="${3:-io.kosmos.app}"
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
want_appid="$team.$bundle"
case "$appid" in
  *."$bundle")
    if [ -n "$team" ] && [ "$appid" != "$want_appid" ]; then
      echo "WRONG    application-identifier: $appid (must be $want_appid)"; fail=1
    else
      echo "ok       application-identifier: $appid"
    fi ;;
  *) echo "WRONG    application-identifier: ${appid:-<absent>} (must end in .$bundle)"; fail=1 ;;
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

# kosmos#6487: the notification extension (KosmosNotice) rides inside the app and is signed on its own: the same team,
# its own identifier (<bundle>.notice), never a development signature, and the keychain group it shares with the app.
# Without it the phone shows every notice plainly, so a store build missing it is refused too.
appex="$app/PlugIns/KosmosNotice.appex"
xents="$work/notice-entitlements.plist"
if [ ! -d "$appex" ]; then
  echo "WRONG    no notification extension (PlugIns/KosmosNotice.appex)"; fail=1
elif ! codesign -d --entitlements - --xml "$appex" > "$xents" 2>/dev/null || [ ! -s "$xents" ]; then
  echo "WRONG    the notification extension carries no readable entitlements"; fail=1
else
  xid=$(plutil -extract application-identifier raw -o - "$xents" 2>/dev/null)
  case "$xid" in
    *."$bundle.notice")
      if [ -n "$team" ] && [ "$xid" != "$team.$bundle.notice" ]; then echo "WRONG    extension application-identifier: $xid (must be $team.$bundle.notice)"; fail=1
      else echo "ok       extension application-identifier: $xid"; fi ;;
    *) echo "WRONG    extension application-identifier: ${xid:-<absent>} (must end in .$bundle.notice)"; fail=1 ;;
  esac
  if [ "$(plutil -extract get-task-allow raw -o - "$xents" 2>/dev/null)" = "true" ]; then
    echo "WRONG    extension get-task-allow: true (a development signature)"; fail=1
  else echo "ok       extension get-task-allow: not true"; fi
  # The group both must hold for the extension to read the app's kept session (SessionKeychain.macSession).
  want_group="${appid%%.*}.$bundle.shared"
  if /usr/libexec/PlistBuddy -c 'Print :keychain-access-groups' "$xents" 2>/dev/null | grep -qxF "    $want_group" \
    && /usr/libexec/PlistBuddy -c 'Print :keychain-access-groups' "$ents" 2>/dev/null | grep -qxF "    $want_group"; then
    echo "ok       keychain group shared by the app and the extension: $want_group"
  else
    echo "WRONG    the app and the extension do not both hold the keychain group $want_group"; fail=1
  fi
  # A notice shown as a message from the agent (KosmosMessageStyle) needs the app to hold Communication Notifications;
  # without it the phone drops the message style, so a build asking for one without the other is refused.
  # A boolean true only, as NotificationService reads it (`as? Bool == true`): a string "true" turns the style off there.
  if [ "$(plutil -extract KosmosMessageStyle xml1 -o - "$appex/Info.plist" 2>/dev/null | grep -c '<true/>')" = 1 ]; then
    if [ "$(/usr/libexec/PlistBuddy -c 'Print :com.apple.developer.usernotifications.communication' "$ents" 2>/dev/null)" = "true" ]; then
      echo "ok       message-style notices, and the app holds Communication Notifications"
    else
      echo "WRONG    the extension asks for message-style notices but the app lacks com.apple.developer.usernotifications.communication"; fail=1
    fi
  else
    echo "ok       attachment-style notices (KosmosMessageStyle is not true)"
  fi
fi

shots="$("$(dirname "$0")/check-no-shots-flag.sh" "$app")"
case "$shots" in
  *"VERDICT: PASS") echo "ok       not the screenshot build" ;;
  *"was built with KOSMOS_STORE_SHOTS"*) echo "WRONG    built with KOSMOS_STORE_SHOTS (the App Store screenshot build)"; fail=1 ;;
  *) echo "WRONG    the screenshot-switch check could not read the app: $(printf '%s\n' "$shots" | head -1)"; fail=1 ;;
esac

[ "$fail" -eq 0 ] && echo "VERDICT: PASS" || echo "VERDICT: FAIL"
exit "$fail"

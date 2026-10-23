#!/bin/bash
# Shows check-ipa-entitlements.sh can fail as well as pass (kosmos #4089). Builds fake exported
# apps, ad-hoc signed with chosen entitlements, zips them as .ipa files, and asserts each verdict.
# macOS only (codesign). Ends with one VERDICT line. CI runs it in .github/workflows/ios.yml.
set -u
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# One fake ipa: $1 name, $2 aps-environment ("" = absent), $3 get-task-allow, $4 application-identifier,
# $5 team-identifier ("" = absent), $6 "shots" to make the executable carry the screenshot switch (#6262).
# kosmos#6487: every fixture carries the notification extension (PlugIns/KosmosNotice.appex, <appid>.notice) and the
# keychain group the two share, as a store build does. EXT (unset = that) breaks one thing about it:
# none (no extension), devsigned (get-task-allow true), otherid (another identifier), nogroup (no shared group),
# nocomm (message-style notices without the app's Communication Notifications); style is that pair done right;
# strstyle sets the flag as the string "true", which the extension does not read as on.
make_ipa() {
  local dir="$work/$1"
  mkdir -p "$dir/Payload/Kosmos.app"
  cp /usr/bin/true "$dir/Payload/Kosmos.app/Kosmos"
  if [ "${6:-}" = shots ]; then   # a real executable holding the string: appended bytes would not sign
    printf 'int main(void){static const char *s="KOSMOS_SHOTS_URL";return s[0]==0;}\n' > "$dir/m.c"
    cc -o "$dir/Payload/Kosmos.app/Kosmos" "$dir/m.c" || { echo "could not compile $1"; return 1; }
  fi
  /usr/libexec/PlistBuddy -c 'Add :CFBundleExecutable string Kosmos' -c "Add :CFBundleIdentifier string ${4#*.}" "$dir/Payload/Kosmos.app/Info.plist" >/dev/null   # the id the fixture signs (#4089)
  local ents="$dir/ents.plist"
  /usr/libexec/PlistBuddy -c 'Clear dict' "$ents" >/dev/null 2>&1 || true
  [ -n "$2" ] && /usr/libexec/PlistBuddy -c "Add :aps-environment string $2" "$ents" >/dev/null
  /usr/libexec/PlistBuddy -c "Add :get-task-allow bool $3" "$ents" >/dev/null
  /usr/libexec/PlistBuddy -c "Add :application-identifier string $4" "$ents" >/dev/null
  [ -n "${5:-}" ] && /usr/libexec/PlistBuddy -c "Add :com.apple.developer.team-identifier string $5" "$ents" >/dev/null
  [ "${EXT:-}" = style ] && /usr/libexec/PlistBuddy -c 'Add :com.apple.developer.usernotifications.communication bool true' "$ents" >/dev/null
  local group="$4.shared"
  /usr/libexec/PlistBuddy -c 'Add :keychain-access-groups array' -c "Add :keychain-access-groups:0 string $group" "$ents" >/dev/null
  if [ "${EXT:-}" != none ]; then
    local appex="$dir/Payload/Kosmos.app/PlugIns/KosmosNotice.appex" xents="$dir/xents.plist" xid="$4.notice"
    mkdir -p "$appex"
    cp /usr/bin/true "$appex/KosmosNotice"
    [ "${EXT:-}" = otherid ] && xid="$4.other"
    /usr/libexec/PlistBuddy -c 'Add :CFBundleExecutable string KosmosNotice' -c "Add :CFBundleIdentifier string ${xid#*.}" "$appex/Info.plist" >/dev/null
    case "${EXT:-}" in style|nocomm) /usr/libexec/PlistBuddy -c 'Add :KosmosMessageStyle bool true' "$appex/Info.plist" >/dev/null ;;
      strstyle) /usr/libexec/PlistBuddy -c 'Add :KosmosMessageStyle string true' "$appex/Info.plist" >/dev/null ;; esac
    /usr/libexec/PlistBuddy -c 'Clear dict' "$xents" >/dev/null 2>&1 || true
    /usr/libexec/PlistBuddy -c "Add :application-identifier string $xid" "$xents" >/dev/null
    /usr/libexec/PlistBuddy -c "Add :get-task-allow bool $([ "${EXT:-}" = devsigned ] && echo true || echo false)" "$xents" >/dev/null
    [ "${EXT:-}" = nogroup ] || /usr/libexec/PlistBuddy -c 'Add :keychain-access-groups array' -c "Add :keychain-access-groups:0 string $group" "$xents" >/dev/null
    codesign -f -s - --entitlements "$xents" "$appex" 2>/dev/null || { echo "could not sign $1's extension"; return 1; }
  fi
  codesign -f -s - --entitlements "$ents" "$dir/Payload/Kosmos.app" 2>/dev/null || { echo "could not sign $1"; return 1; }
  (cd "$dir" && zip -qr "$work/$1.ipa" Payload)
}

fail=0
# expect NAME WANT(0|1) APS GTA APPID SIGNED-TEAM CHECK-TEAM [CHECK-BUNDLE]
expect() {
  make_ipa "$1" "$3" "$4" "$5" "$6" || { echo "FAIL  $1: fixture not built"; fail=1; return; }
  out=$("$here/check-ipa-entitlements.sh" "$work/$1.ipa" "$7" "${8:-}")
  rc=$?
  last=$(printf '%s\n' "$out" | tail -1)
  if [ "$2" -eq 0 ]; then want_last="VERDICT: PASS"; else want_last="VERDICT: FAIL"; fi
  if [ "$rc" -eq "$2" ] && [ "$last" = "$want_last" ]; then
    echo "PASS  $1 (rc=$rc, $last)"
  else
    echo "FAIL  $1: wanted rc=$2, got rc=$rc, last line: $last"
    printf '%s\n' "$out" | sed 's/^/      /'
    fail=1
  fi
}

T=ABCDE12345
expect store-build          0 production  false $T.io.kosmos.app     $T         $T
printf '%s\n' "$out" | grep -qF 'ok       attachment-style notices' \
  || { echo "FAIL  store-build: the build did not say its notices are attachment-style"; fail=1; }
expect store-build-no-team  0 production  false $T.io.kosmos.app     $T         ""
expect development-aps      1 development false $T.io.kosmos.app     $T         $T
expect no-aps               1 ""          false $T.io.kosmos.app     $T         $T
expect debug-signed         1 production  true  $T.io.kosmos.app     $T         $T
expect wrong-bundle         1 production  false $T.io.kosmos.other   $T         $T
expect other-team-appid     1 production  false ZZZZZ99999.io.kosmos.app ZZZZZ99999 $T
expect other-team-only      1 production  false $T.io.kosmos.app     ZZZZZ99999 $T
expect no-team-identifier   1 production  false $T.io.kosmos.app     ""         $T
# #4089: the interim TestFlight app was to be io.kosmos.app.preview (dropped in #6262). The check stays
# general: an id passes only when it is the id expected, and the two ids never stand in for each other.
expect preview-build        0 production  false $T.io.kosmos.app.preview $T     $T io.kosmos.app.preview
expect preview-as-default   1 production  false $T.io.kosmos.app.preview $T     $T
expect real-as-preview      1 production  false $T.io.kosmos.app     $T         $T io.kosmos.app.preview
expect preview-other-team   1 production  false ZZZZZ99999.io.kosmos.app.preview ZZZZZ99999 $T io.kosmos.app.preview

# kosmos#6487: the notification extension inside the app, each refused for its own reason.
EXT=style expect ext-style 0 production false $T.io.kosmos.app $T $T
printf '%s\n' "$out" | grep -qF 'message-style notices, and the app holds Communication Notifications' \
  || { echo "FAIL  ext-style: the message-style check did not run"; fail=1; }
# A string "true" is not the boolean the extension reads, so the build is attachment-style, not refused.
EXT=strstyle expect ext-strstyle 0 production false $T.io.kosmos.app $T $T
printf '%s\n' "$out" | grep -qF 'ok       attachment-style notices' \
  || { echo "FAIL  ext-strstyle: a string \"true\" was read as message style"; fail=1; }
for case in "none:no notification extension" "devsigned:extension get-task-allow: true" "otherid:extension application-identifier: $T.io.kosmos.app.other" "nogroup:do not both hold the keychain group" "nocomm:lacks com.apple.developer.usernotifications.communication"; do
  mode=${case%%:*}; why=${case#*:}
  EXT=$mode make_ipa "ext-$mode" production false $T.io.kosmos.app $T >/dev/null
  out=$("$here/check-ipa-entitlements.sh" "$work/ext-$mode.ipa" "$T"); rc=$?
  if [ "$rc" -ne 0 ] && [ "$(printf '%s\n' "$out" | tail -1)" = "VERDICT: FAIL" ] && printf '%s\n' "$out" | grep -qF "$why"; then
    echo "PASS  ext-$mode (refused: $why)"
  else
    echo "FAIL  ext-$mode: wanted the refusal '$why', got rc=$rc"; printf '%s\n' "$out" | sed 's/^/      /'; fail=1
  fi
done

# #6262: a store-signed app that carries the screenshot switch is refused, and for that reason.
make_ipa shots-build production false $T.io.kosmos.app $T shots >/dev/null
out=$("$here/check-ipa-entitlements.sh" "$work/shots-build.ipa" "$T"); rc=$?
if [ "$rc" -ne 0 ] && [ "$(printf '%s\n' "$out" | tail -1)" = "VERDICT: FAIL" ] \
  && printf '%s\n' "$out" | grep -q 'WRONG    built with KOSMOS_STORE_SHOTS'; then
  echo "PASS  shots-build (refused as the screenshot build)"
else
  echo "FAIL  shots-build: wanted the screenshot-build refusal, got rc=$rc"; printf '%s\n' "$out" | sed 's/^/      /'; fail=1
fi

# An unsigned app is refused, and for that reason, not read as "no entitlements, nothing wrong".
make_ipa unsigned production false $T.io.kosmos.app $T >/dev/null
codesign --remove-signature "$work/unsigned/Payload/Kosmos.app" 2>/dev/null
out=$("$here/check-ipa-entitlements.sh" "$work/unsigned/Payload/Kosmos.app"); rc=$?
if [ "$rc" -ne 0 ] && [ "$(printf '%s\n' "$out" | tail -1)" = "VERDICT: FAIL" ] \
  && printf '%s\n' "$out" | grep -q 'carries no readable entitlements'; then
  echo "PASS  unsigned (rc=$rc, no readable entitlements)"
else
  echo "FAIL  unsigned: wanted the no-entitlements refusal, got rc=$rc"; printf '%s\n' "$out" | sed 's/^/      /'; fail=1
fi

[ "$fail" -eq 0 ] && echo "VERDICT: PASS" || echo "VERDICT: FAIL"
exit "$fail"

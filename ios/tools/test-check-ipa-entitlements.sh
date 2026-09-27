#!/bin/bash
# Shows check-ipa-entitlements.sh can fail as well as pass (kosmos #4089). Builds fake exported
# apps, ad-hoc signed with chosen entitlements, zips them as .ipa files, and asserts each verdict.
# macOS only (codesign). Ends with one VERDICT line. CI runs it in .github/workflows/ios.yml.
set -u
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# One fake ipa: $1 name, $2 aps-environment ("" = absent), $3 get-task-allow, $4 application-identifier,
# $5 team-identifier ("" = absent).
make_ipa() {
  local dir="$work/$1"
  mkdir -p "$dir/Payload/Kosmos.app"
  cp /usr/bin/true "$dir/Payload/Kosmos.app/Kosmos"
  /usr/libexec/PlistBuddy -c 'Add :CFBundleExecutable string Kosmos' -c 'Add :CFBundleIdentifier string io.kosmos.app' "$dir/Payload/Kosmos.app/Info.plist" >/dev/null
  local ents="$dir/ents.plist"
  /usr/libexec/PlistBuddy -c 'Clear dict' "$ents" >/dev/null 2>&1 || true
  [ -n "$2" ] && /usr/libexec/PlistBuddy -c "Add :aps-environment string $2" "$ents" >/dev/null
  /usr/libexec/PlistBuddy -c "Add :get-task-allow bool $3" "$ents" >/dev/null
  /usr/libexec/PlistBuddy -c "Add :application-identifier string $4" "$ents" >/dev/null
  [ -n "${5:-}" ] && /usr/libexec/PlistBuddy -c "Add :com.apple.developer.team-identifier string $5" "$ents" >/dev/null
  codesign -f -s - --entitlements "$ents" "$dir/Payload/Kosmos.app" 2>/dev/null || { echo "could not sign $1"; return 1; }
  (cd "$dir" && zip -qr "$work/$1.ipa" Payload)
}

fail=0
# expect NAME WANT(0|1) APS GTA APPID SIGNED-TEAM CHECK-TEAM
expect() {
  make_ipa "$1" "$3" "$4" "$5" "$6" || { echo "FAIL  $1: fixture not built"; fail=1; return; }
  out=$("$here/check-ipa-entitlements.sh" "$work/$1.ipa" "$7")
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
expect store-build-no-team  0 production  false $T.io.kosmos.app     $T         ""
expect development-aps      1 development false $T.io.kosmos.app     $T         $T
expect no-aps               1 ""          false $T.io.kosmos.app     $T         $T
expect debug-signed         1 production  true  $T.io.kosmos.app     $T         $T
expect wrong-bundle         1 production  false $T.io.kosmos.other   $T         $T
expect other-team-appid     1 production  false ZZZZZ99999.io.kosmos.app ZZZZZ99999 $T
expect other-team-only      1 production  false $T.io.kosmos.app     ZZZZZ99999 $T
expect no-team-identifier   1 production  false $T.io.kosmos.app     ""         $T

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

#!/bin/bash
# Shows check-ipa-entitlements.sh can fail as well as pass (kosmos #4089). Builds fake exported
# apps, ad-hoc signed with chosen entitlements, zips them as .ipa files, and asserts each verdict.
# macOS only (codesign). Ends with one VERDICT line. CI runs it in .github/workflows/ios.yml.
set -u
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# One fake ipa: $1 name, $2 aps-environment ("" = absent), $3 get-task-allow, $4 application-identifier.
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
  codesign -f -s - --entitlements "$ents" "$dir/Payload/Kosmos.app" 2>/dev/null || { echo "could not sign $1"; return 1; }
  (cd "$dir" && zip -qr "$work/$1.ipa" Payload)
}

fail=0
# expect NAME WANT(0|1) APS GTA APPID
expect() {
  make_ipa "$1" "$3" "$4" "$5" || { echo "FAIL  $1: fixture not built"; fail=1; return; }
  out=$("$here/check-ipa-entitlements.sh" "$work/$1.ipa")
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

expect store-build          0 production  false ABCDE12345.io.kosmos.app
expect development-aps      1 development false ABCDE12345.io.kosmos.app
expect no-aps               1 ""          false ABCDE12345.io.kosmos.app
expect debug-signed         1 production  true  ABCDE12345.io.kosmos.app
expect wrong-bundle         1 production  false ABCDE12345.io.kosmos.other

# An unsigned app is refused, not read as "no entitlements, nothing wrong".
mkdir -p "$work/unsigned/Payload/Kosmos.app" && cp /usr/bin/true "$work/unsigned/Payload/Kosmos.app/Kosmos"
codesign --remove-signature "$work/unsigned/Payload/Kosmos.app/Kosmos" 2>/dev/null
out=$("$here/check-ipa-entitlements.sh" "$work/unsigned/Payload/Kosmos.app"); rc=$?
if [ "$rc" -ne 0 ] && [ "$(printf '%s\n' "$out" | tail -1)" = "VERDICT: FAIL" ]; then
  echo "PASS  unsigned (rc=$rc)"
else
  echo "FAIL  unsigned: wanted a failure, got rc=$rc"; fail=1
fi

[ "$fail" -eq 0 ] && echo "VERDICT: PASS" || echo "VERDICT: FAIL"
exit "$fail"

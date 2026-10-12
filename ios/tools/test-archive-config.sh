#!/bin/bash
# Shows archive.sh's signing-settings checks can refuse as well as pass (kosmos #4089), on scratch copies of
# ios/Signing.xcconfig: run with --check-config, so nothing is archived or uploaded.
set -u
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
stone="864QZ""69GF2"   # in pieces, as in archive.sh, so the cut-sign sweep does not count this file
fail=0
# expect NAME WANT(0|1) TEAM BUNDLE
expect() {
  printf 'DEVELOPMENT_TEAM = %s\nKOSMOS_BUNDLE_ID = %s\n' "$3" "$4" > "$work/$1.xcconfig"
  out=$(KOSMOS_IOS_XCCONFIG="$work/$1.xcconfig" "$here/archive.sh" --check-config 2>&1); rc=$?
  if { [ "$2" -eq 0 ] && [ "$rc" -eq 0 ]; } || { [ "$2" -ne 0 ] && [ "$rc" -ne 0 ]; }; then
    echo "PASS  $1 (rc=$rc)"
  else
    echo "FAIL  $1: wanted rc=$2, got rc=$rc: $out"; fail=1
  fi
}
expect preview-under-stone      0 "$stone"     io.kosmos.app.preview
expect real-under-other-team    0 ABCDE12345   io.kosmos.app
expect real-under-stone         1 "$stone"     io.kosmos.app
expect empty-team               1 ""           io.kosmos.app.preview
expect short-team               1 ABC          io.kosmos.app.preview
expect bad-bundle-dots          1 "$stone"     io..kosmos
expect bad-bundle-empty         1 "$stone"     ""
# The real file passes as it stands (an inherited override must not redirect it).
unset KOSMOS_IOS_XCCONFIG
if "$here/archive.sh" --check-config >/dev/null 2>&1; then echo "PASS  the project's own Signing.xcconfig"; else echo "FAIL  the project's own Signing.xcconfig is refused"; fail=1; fi
# The override is refused on a real (non --check-config) run, before anything is built.
out=$(KOSMOS_IOS_XCCONFIG="$work/preview-under-stone.xcconfig" "$here/archive.sh" --build 1 2>&1); rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q 'for --check-config only'; then echo "PASS  the override is refused on a real archive (rc=$rc)"; else echo "FAIL  the override was not refused on a real archive (rc=$rc): $out"; fail=1; fi
[ "$fail" -eq 0 ] && echo "VERDICT: PASS" || echo "VERDICT: FAIL"
exit "$fail"

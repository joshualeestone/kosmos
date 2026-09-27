#!/bin/bash
# Print the entitlements an exported .ipa is signed with, and pass only when push is set to
# production (#3643). A store build signed for the development push server registers device
# tokens the coordinator's production sends cannot reach, and nothing fails until a real phone
# waits for a notification that never comes.
#
# usage: check-ipa-entitlements.sh <path/to/Kosmos.ipa>
# Ends with one VERDICT line; no verdict line means the check did not finish.
set -uo pipefail
IPA="${1:-}"
[ -f "$IPA" ] || { echo "check-ipa-entitlements: no .ipa at '${IPA}'"; echo "VERDICT: FAIL"; exit 1; }
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
if ! unzip -q "$IPA" -d "$WORK"; then echo "check-ipa-entitlements: could not unzip $IPA"; echo "VERDICT: FAIL"; exit 1; fi
APP=""
for a in "$WORK"/Payload/*.app; do [ -d "$a" ] && APP="$a" && break; done
[ -n "$APP" ] || { echo "check-ipa-entitlements: no Payload/*.app inside $IPA"; echo "VERDICT: FAIL"; exit 1; }
ENT="$WORK/entitlements.plist"
if ! codesign -d --entitlements "$ENT" --xml "$APP" 2>/dev/null || [ ! -s "$ENT" ]; then
  echo "check-ipa-entitlements: $(basename "$APP") carries no readable entitlements (is it signed?)"
  echo "VERDICT: FAIL"; exit 1
fi
echo "Entitlements of $(basename "$APP") in $(basename "$IPA"):"
plutil -p "$ENT"
APS="$(plutil -extract aps-environment raw -o - "$ENT" 2>/dev/null || true)"
TASK="$(plutil -extract get-task-allow raw -o - "$ENT" 2>/dev/null || true)"
FAIL=0
if [ "$APS" = "production" ]; then echo "PASS  aps-environment is production"
else echo "FAIL  aps-environment is '${APS:-missing}', not production"; FAIL=1; fi
# A development-signed build carries get-task-allow = true; a store build must not.
if [ "$TASK" = "true" ]; then echo "FAIL  get-task-allow is true (a development signature, not a store one)"; FAIL=1
else echo "PASS  get-task-allow is ${TASK:-absent}"; fi
if [ "$FAIL" -eq 0 ]; then echo "VERDICT: PASS"; exit 0; fi
echo "VERDICT: FAIL"; exit 1

#!/bin/bash
# #6262: an app headed for the store must not carry the App Store screenshot switch (KOSMOS_STORE_SHOTS), which
# opens whatever address KOSMOS_SHOTS_URL names instead of Kosmos+. Only ios/store/shoot-app.sh builds with it;
# this proves a built app does not, by the variable's name in the executable (present only when compiled in).
# The name must stay longer than 15 bytes: Swift stores shorter strings inline, where grep cannot see them. iOS CI
# builds a Release app WITH the switch and requires this check to fail on it, so a rename that blinds it goes red.
# Usage: ios/tools/check-no-shots-flag.sh <path/to/Kosmos.app>   Ends with one VERDICT: line.
set -u
app="${1:-}"
exe="$app/Kosmos"
if [ ! -f "$exe" ]; then echo "FAIL  no executable at $exe"; echo "VERDICT: FAIL"; exit 1; fi
if grep -a -q KOSMOS_SHOTS_URL "$exe"; then
  echo "FAIL  $app was built with KOSMOS_STORE_SHOTS (the screenshot build); it must never be uploaded"
  echo "VERDICT: FAIL"; exit 1
fi
echo "ok    $app does not carry the screenshot switch"
echo "VERDICT: PASS"

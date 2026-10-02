#!/bin/bash
# #5073: tools/run-tests.sh gives the suite a UTF-8 locale when its caller has none, and says so; it changes nothing
# when the caller chose a locale. Behaviour legs drive tools/lib/test-locale.sh in a clean `env -i` shell (so this
# test does not inherit its own caller's locale), and a source leg checks run-tests.sh calls it before the node suite.
set -u
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
LIB="$HERE/lib/test-locale.sh"
RT="$HERE/run-tests.sh"
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=1; }

[ -f "$LIB" ] || { echo "FAIL  $LIB not found"; exit 1; }

# Runs the pin in a shell whose only environment is PATH plus the given assignments, and prints
# "LANG=<value>|<stderr>" so each leg can check both what it exported and what it said.
probe() {
  # LANG is read by a CHILD (printenv), so a pin that sets LANG without exporting it reads as unset: the node
  # suite inherits only what is exported.
  env -i PATH=/usr/bin:/bin "$@" /bin/bash -c 'e=$(mktemp); . "$1"; kosmos_test_locale_pin 2>"$e"; printf "LANG=%s|%s" "$(/usr/bin/printenv LANG)" "$(cat "$e")"; rm -f "$e"' _ "$LIB"
}

out="$(probe)"
case "$out" in
  "LANG=en_US.UTF-8|run-tests: no locale was set"*) pass "no locale at all: LANG becomes en_US.UTF-8 and it says so" ;;
  *) fail "no locale at all: expected LANG=en_US.UTF-8 and a note, got: $out" ;;
esac

out="$(probe LANG=en_US.UTF-8)"
[ "$out" = "LANG=en_US.UTF-8|" ] && pass "a UTF-8 LANG: unchanged and silent" || fail "a UTF-8 LANG: expected unchanged and silent, got: $out"

out="$(probe LANG=fr_FR.utf8)"
[ "$out" = "LANG=fr_FR.utf8|" ] && pass "a lowercase utf8 spelling counts as UTF-8" || fail "lowercase utf8: expected unchanged and silent, got: $out"

out="$(probe LC_CTYPE=en_US.UTF-8)"
[ "$out" = "LANG=|" ] && pass "LC_CTYPE alone UTF-8: LANG is left unset, silent" || fail "LC_CTYPE alone: expected nothing exported, got: $out"

out="$(probe LC_ALL=C LANG=en_US.UTF-8)"
case "$out" in
  "LANG=en_US.UTF-8|run-tests: WARNING the locale in effect is 'C'"*) pass "LC_ALL=C over a UTF-8 LANG: nothing overridden, and it warns (LC_ALL wins in the C library)" ;;
  *) fail "LC_ALL=C: expected no change and a warning naming C, got: $out" ;;
esac

out="$(probe LANG=C)"
case "$out" in
  "LANG=C|run-tests: WARNING"*) pass "a caller's own non-UTF-8 LANG is kept and named" ;;
  *) fail "LANG=C: expected kept and a warning, got: $out" ;;
esac

# Source leg: run-tests.sh calls the pin, and before the node suite (the first test invocation).
cln="$(grep -nE '^[[:space:]]*kosmos_test_locale_pin[[:space:]]*$' "$RT" | head -1 | cut -d: -f1)"
nln="$(grep -nE 'node --test.*KOSMOS_TEST_FILES' "$RT" | head -1 | cut -d: -f1)"
if [ -n "$cln" ] && [ -n "$nln" ] && [ "$cln" -lt "$nln" ]; then
  pass "run-tests.sh pins the locale (line $cln) before the node suite (line $nln)"
else
  fail "run-tests.sh does not call kosmos_test_locale_pin before the node suite (pin=$cln node=$nln)"
fi

exit $fails

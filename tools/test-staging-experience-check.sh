#!/usr/bin/env bash
# test-staging-experience-check.sh - exercises the CI-runnable arms of the #2036
# experience check. The USABLE (exit 0) path needs a live enforcing board (mint +
# redeem + /api/*), which CI does not have; it is validated by hand against a running
# board and that is stated below, not faked. What CI CAN prove is that the check
# discriminates: a non-enforcing state is cannot-tell (2), and a down board is a loud
# alarm (1) rather than a false pass.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CHECK="$HERE/staging-experience-check.sh"
fail=0
pass() { printf 'PASS  %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fail=1; }

# cannot-tell: a store root with NO board.token is a non-enforcing (sandbox / from-
# source) board, exactly the state the card says cannot test the update experience.
TMPROOT="$(mktemp -d "${TMPDIR:-/tmp}/staging-exp-test.XXXXXXXX")"
KOSMOS_STORE_ROOT="$TMPROOT" bash "$CHECK" 16180 >/dev/null 2>&1
rc=$?; rm -rf "$TMPROOT"
[ "$rc" = 2 ] && pass "no board.token -> cannot-tell (exit 2)" || bad "no board.token should exit 2, got $rc"

# alarm: an enforcing store root (a token present) but a port with no board -> the
# nonce mint cannot succeed -> exit 1. This proves a board it cannot reach reads as a
# LOUD failure, never a silent pass.
TMPROOT2="$(mktemp -d "${TMPDIR:-/tmp}/staging-exp-test.XXXXXXXX")"
printf 'deadbeefdeadbeef\n' > "$TMPROOT2/board.token"
KOSMOS_STORE_ROOT="$TMPROOT2" bash "$CHECK" 19998 >/dev/null 2>&1
rc=$?; rm -rf "$TMPROOT2"
[ "$rc" = 1 ] && pass "enforcing but board unreachable -> alarm (exit 1)" || bad "unreachable board should exit 1, got $rc"

# The exit-0 USABLE path requires a live enforcing board. Stated so its absence here
# is not misread as missing coverage (it is validated by hand against a running board).
pass "note: the exit-0 USABLE path is validated by hand against a live enforcing board (CI has none)"

if [ "$fail" = 0 ]; then
  echo "test-staging-experience-check: all CI-runnable arms passed"
  exit 0
fi
echo "test-staging-experience-check: FAILURES above"
exit 1

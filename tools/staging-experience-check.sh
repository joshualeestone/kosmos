#!/usr/bin/env bash
# staging-experience-check.sh - kosmos#2036, the EXPERIENCE half of the staging gate.
#
# After a build is updated to (not merely installed fresh - see the card), can the
# PERSON USE it, on the surface they open? Today's outage class (#2023) was exactly
# this: a browser holding no board cookie 403s every /api/* after an update, so the
# board is dead for that user while every artifact check - served bytes, sha256, the
# fix read out of the binary - passes, because those checks already hold the token.
#
# 🛑 NOT "curl /api/* without a cookie and expect 200". A no-cookie 403 is enforcement
# working correctly (#1946), not the bug. This exercises the REAL browser-first-nav
# flow the way `setup.sh` + a browser do it (#1979/#2030): mint a single-use nonce with
# the board token (off argv), redeem `?boot=<nonce>` for the durable cookie, THEN use
# that cookie on a sensitive /api/* route and assert it is NOT refused. A red here is
# #2023 - a fresh session cannot reach the board it just updated to. It also confirms
# the #2030 self-heal fired (the redemption wrote `.reauth-seeded`).
#
# This is the SERVER-side experience: it catches the class that broke today without a
# browser. The browser-side "polymer clicking" layer (page renders, JS runs) sits on
# top and is a person or a headless browser check - named in the card, not replaced.
#
# INTENDED TARGET: a DEDICATED fresh staging account (the account IS the user). It is
# safe to run against a shared board too - the redemption seeds `.reauth-seeded` server-
# side (#2030), and this check RESTORES that state (removes a marker it created) so it
# does not consume a real user's one-time self-heal. See the SEEDED_BEFORE note below.
#
#   bash tools/staging-experience-check.sh [port]
#
# Exit 0 usable (a 2xx on the sensitive route) / 1 broken (403 = #2023, or any other
# non-2xx = board erroring/unreachable) / 2 cannot-tell (no enforcing board here).
set -uo pipefail

PORT="${1:-${KOSMOS_PORT:-16180}}"
URL="http://127.0.0.1:${PORT}"
say() { printf '%s\n' "$*"; }

# store.ROOT holds board.token and the #2030 marker. Resolve it the same way setup.sh
# does - via the bundled node reading engine/store - so it cannot drift. Overridable
# for the test (KOSMOS_STORE_ROOT), the board-serving-check.sh pattern.
ROOT="${KOSMOS_STORE_ROOT:-}"
if [ -z "$ROOT" ]; then
  NODE="${KOSMOS_HOME:-}/runtime/bin/node"
  [ -x "$NODE" ] || NODE="$(command -v node 2>/dev/null || true)"
  STORE="${KOSMOS_HOME:-}/app/engine/store"
  [ -f "$STORE.js" ] || STORE="$(cd "$(dirname "$0")/.." && pwd)/engine/store"
  if [ -n "$NODE" ] && [ -x "$NODE" ]; then
    ROOT="$("$NODE" -e 'process.stdout.write(require(process.argv[1]).ROOT)' "$STORE" 2>/dev/null || true)"
  fi
fi
if [ -z "$ROOT" ]; then
  say "cannot resolve store.ROOT (no bundled node / store module) - cannot tell"; exit 2
fi

TOKEN="$(cat "$ROOT/board.token" 2>/dev/null || true)"
if [ -z "$TOKEN" ]; then
  # No token means a non-enforcing board (sandbox, or a from-source dev checkout).
  # That is precisely the state #2036's comment says CANNOT test this: the fleet Mac
  # runs from source and never enforces. cannot-tell, not a pass.
  say "no board.token at $ROOT -> not an enforcing installed board."
  say "  (a from-source / sandbox board cannot test the update experience - #2036's blind spot)"
  exit 2
fi

# Interrupt-safe cleanup: HF holds the durable board token at mode 600, CJ the cookie.
# A signal between mktemp and the explicit rm would otherwise leak the token file.
HF=""; CJ=""
trap 'rm -f "$HF" "$CJ" 2>/dev/null || true' EXIT INT TERM

# #2030 side-effect guard. A real redemption (step 2) seeds `.reauth-seeded` SERVER-side,
# which stops setup.sh's next-update auto-open. On a DEDICATED fresh staging account -
# this check's intended target - that is correct (the account itself redeemed). But run
# against a SHARED board whose real user has NOT yet redeemed, seeding the marker would
# consume their one-time self-heal. So record whether the marker existed BEFORE and
# restore that state at the end: removing a marker THIS check created leaves the self-heal
# armed, which is the safe direction (at worst one extra harmless tab, never a lockout).
SEEDED_BEFORE=0
[ -f "$ROOT/.reauth-seeded" ] && SEEDED_BEFORE=1

# 1. Mint a single-use nonce, board token OFF argv via a mode-600 header file (#1979,
#    the same shape setup.sh's open uses so `ps` never exposes the durable token).
HF="$(mktemp "${TMPDIR:-/tmp}/staging-exp-auth.XXXXXXXX")" || { say "mktemp failed - cannot tell"; exit 2; }
chmod 600 "$HF" 2>/dev/null || true
printf 'x-kosmos-board-token: %s\n' "$TOKEN" > "$HF"
NONCE="$(curl -sS -m 15 -H @"$HF" -X POST "$URL/api/board-nonce" 2>/dev/null | sed -n 's/.*"nonce":"\([0-9a-f]*\)".*/\1/p' | head -1)"
rm -f "$HF"
if [ -z "$NONCE" ]; then
  say "FAIL: could not mint a browser-open nonce (board not answering on :$PORT, or the token was refused)."
  exit 1
fi

# 2. Redeem it the way the browser's first navigation does: GET /?boot=<nonce> must
#    302 and set the durable cookie. This is the exact step #2023 left broken.
CJ="$(mktemp "${TMPDIR:-/tmp}/staging-exp-cookie.XXXXXXXX")" || { say "mktemp failed - cannot tell"; exit 2; }
REDEEM_CODE="$(curl -sS -m 15 -o /dev/null -c "$CJ" -w '%{http_code}' "$URL/?boot=$NONCE" 2>/dev/null || true)"
if ! grep -q 'kosmos_board' "$CJ" 2>/dev/null; then
  rm -f "$CJ"
  say "FAIL (#2023): redeeming the browser-open nonce did NOT set the durable cookie (HTTP $REDEEM_CODE)."
  say "  A fresh browser cannot authenticate to the board it just updated to - the outage class."
  exit 1
fi

# 3. Use the redeemed cookie on a sensitive route. USABLE requires a 2xx - not merely
#    "not 403". A 403 is the #2023 lockout; anything else non-2xx (500 board erroring,
#    502, or 000 the board crashed/became unreachable between the redeem and here) is a
#    board that is broken or gone, and must NOT read as USABLE (the false-pass a
#    403-only guard leaves open).
API_CODE="$(curl -sS -m 15 -o /dev/null -b "$CJ" -w '%{http_code}' "$URL/api/accounts" 2>/dev/null || true)"
rm -f "$CJ"
case "$API_CODE" in
  2??) : ;;  # the redeemed session reached the sensitive route -> usable
  403)
    say "FAIL (#2023): the redeemed session still 403s /api/* - the board is unusable after update."
    exit 1 ;;
  *)
    say "FAIL: the redeemed session got HTTP ${API_CODE:-000} from /api/accounts - not 2xx and not the #2023 403,"
    say "  so the board is erroring or became unreachable after the redeem; cannot confirm the experience is usable."
    exit 1 ;;
esac

# 4. #2030 marker: restore the pre-check state (see the SEEDED_BEFORE note above). If
#    THIS check created the marker, remove it so a real user's next-update auto-open
#    still fires. If it was already there, leave it (not ours to touch). If a successful
#    redeem left it absent, the board likely predates #2030 - surface it.
if [ "$SEEDED_BEFORE" = 0 ] && [ -f "$ROOT/.reauth-seeded" ]; then
  rm -f "$ROOT/.reauth-seeded" 2>/dev/null || true   # restore: leave the self-heal armed
elif [ "$SEEDED_BEFORE" = 0 ]; then
  say "warn: session is usable but the redemption did NOT write .reauth-seeded (the #2030 marker) - the board may predate #2030; worth a look."
fi

say "USABLE: a fresh session minted a nonce, redeemed the durable cookie, and reached /api/accounts (HTTP $API_CODE)."
say "  The post-update board experience works - the #2023 class is not present."
exit 0

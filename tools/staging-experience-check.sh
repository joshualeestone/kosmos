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
#   bash tools/staging-experience-check.sh [port]
#
# Exit 0 usable / 1 broken (the #2023 class) / 2 cannot-tell (no enforcing board here).
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

# 3. Use the redeemed cookie on a sensitive route. It must NOT be refused. A 403 here
#    means the session the browser would have is still locked out (unusable board).
API_CODE="$(curl -sS -m 15 -o /dev/null -b "$CJ" -w '%{http_code}' "$URL/api/accounts" 2>/dev/null || true)"
rm -f "$CJ"
if [ "$API_CODE" = 403 ]; then
  say "FAIL (#2023): the redeemed session still 403s /api/* - the board is unusable after update."
  exit 1
fi

# 4. #2030: a real redemption writes the reauth-seeded marker. Its presence confirms
#    the self-heal fired; its absence after a successful redeem is worth surfacing
#    (non-fatal - the session above already proved usable).
if [ ! -f "$ROOT/.reauth-seeded" ]; then
  say "warn: session is usable but .reauth-seeded is absent (the #2030 redemption marker) - worth a look."
fi

say "USABLE: a fresh session minted a nonce, redeemed the durable cookie, and reached /api/accounts (HTTP $API_CODE)."
say "  The post-update board experience works - the #2023 class is not present."
exit 0

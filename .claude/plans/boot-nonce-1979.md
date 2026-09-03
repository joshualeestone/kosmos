# kosmos#1979 - close the browser-open argv residual with a single-use nonce

## The defect (follow-up from #1970)
#1970 (merged as #1981) moved every kosmos CLI curl OFF argv via `kosmos_curl` (`-H @file`). It left
ONE residual: the browser-open handoff. `install/kosmos` `cmd_open` did `open "$URL/?token=$_bt"` and
`install/setup.sh`'s open-once plist put `?token=$_bt` in `/bin/sh -c 'open "$0"...' <url>`. In both,
the DURABLE board token (the same forever-valid secret as the mode-600 `board.token`) rode the
`open`/`sh`/browser argv, which macOS `ps -ww -o args` shows to every account on the box. The
`?token=` -> httpOnly-cookie swap clears the address bar, not the argv channel, and "infrequent" is a
property of the intended flow, not a bound (`kosmos open` can be re-run or scripted).

## The closure
A server-minted single-use, short-TTL nonce the browser redeems for the same cookie. The durable token
authenticates the MINT off argv (header file), and only the nonce -- useless once redeemed and after
its TTL -- ever reaches argv.

## The change
- **`engine/boardauth.js`**: an in-memory nonce store (modeled on `githubdevice.js`'s expiring state).
  `mintNonce()` (256-bit hex, 2-min TTL, sweeps expired on mint), `redeemNonce()` (true only for a
  known unexpired nonce, and BURNS it either way -> single-use / no replay), a `bootNonce()` reader, and
  a `_setNonceClock` seam (the repo's suite advances time; a fixed wall clock is what killed a prior TTL
  cache, #1618). `bootstrap` gains a `?boot=<nonce>` arm BEFORE the `?token=` arm: a valid nonce redeems
  for the same `cookieHeader(token)` and strips `boot`. `pathWithoutToken` refactored into a generic
  `pathWithoutParam`. The `?token=` path is KEPT for back-compat (a bookmarked/manual URL).
- **`server.js`**: `POST /api/board-nonce` -> `{nonce}`. Loopback-only (not in REMOTE_AGENT_ROUTES) and,
  on an enforcing board, board-token-gated by the existing sensitive-route check -- so only a board-token
  holder can mint. On a non-enforcing board the nonce is inert (redeem runs only inside `if (boardAuthState.on)`).
- **`install/kosmos` `cmd_open`**: mint via `kosmos_curl` (token off argv) -> `open "?boot=<nonce>"`.
  Falls back to the PLAIN url (never `?token=`) if the mint fails -- closing the residual, not narrowing it.
- **`install/setup.sh`**: the same, inline (POSIX sh) -- the board is up by that step (it reads
  board.token) and the plist is RunAtLoad, so a 2-min nonce is redeemed within seconds. One change to
  `_board_url` covers both the pkg open-once plist and the direct-open fallback.

## Tests (controls that return the dangerous answer)
- `engine.boardauth-nonce-1979.test.js` (8): mint is fresh hex; redeem-once-then-never (single-use
  replay guard); expired does not redeem AND is burned; inside-TTL redeems; unknown/empty/non-string
  never redeem (no throw); bootstrap `?boot=` redeems + strips + single-use; a cookie-present or non-nav
  request does NOT spend the nonce.
- `server.board-nonce-1979.test.js` (6): mint WITH the board token -> 200 hex; mint WITHOUT -> 403 (the
  gate -- the whole point is the token is required, delivered off argv); redeem -> 302 + cookie, strips
  boot; single-use (a burned nonce never re-bootstraps); garbage nonce -> no bootstrap; `?token=` still
  works.
- `cli.open-1957.test.js` (+2): on an enforcing board the opener is handed `?boot=<nonce>` and NEVER the
  token (asserted absent by value), the mint is authenticated by a header (off argv), exactly one mint;
  and a FAILED mint falls back to the plain url (never `?token=`, never a stale nonce).
- Full node suite + test:shell green; no `web/` change so the #1720 browser-check gate is not triggered.

## Decision record
- **Call:** the nonce-redemption closure the card proposes, for both automatic callers (cmd_open, setup.sh).
- **Rejected:** (a) keeping only the address-bar swap (does not close argv); (b) a fire-time mint inside
  the plist reading the token (more complex, and the build-time mint + RunAtLoad + 2-min TTL is simpler
  and equally off-argv); (c) removing the `?token=` path (would break a bookmarked/manual URL and the
  persistent-cookie re-bootstrap; the security win is that the two AUTOMATIC callers stop using it).
- **Weakest premise:** that a build-time nonce (setup.sh) is always redeemed within its 2-min TTL. If the
  RunAtLoad open is delayed past 2 min the nonce expires and the first open lands on the (exempt) shell
  unauthenticated -- a safe degradation (the operator runs `kosmos open`), never a token on argv. New
  safety code is the least-trustworthy code; the challenge-loop attacked the single-use/TTL/replay arms.
- **RESIDUAL, stated so "closed" is not misread as "no cross-account risk":** the nonce STILL rides the
  `open`/`sh`/browser argv -- an `open <url>` handoff cannot avoid a redeemable value on argv -- so the
  #1946 hostile-second-account (`ps -ww -o args` in a loop) can, WITHIN the TTL, race to `curl
  .../?boot=<nonce>` and redeem it before the victim's browser, obtaining an equivalent board cookie.
  #1979 shrinks this from forever + unlimited to ~2 min + single-use, and makes a lost race DETECTABLE
  (single-use -> the victim's dashboard 403s rather than silently sharing a live secret). It does not
  eliminate the in-window race; that is inherent to the handoff and out of scope. The TTL is the knob
  trading window size against redeem reliability. Named in the boardauth.js docblock and the
  install/kosmos docblock so nobody reads "closed" as "zero cross-account exposure."

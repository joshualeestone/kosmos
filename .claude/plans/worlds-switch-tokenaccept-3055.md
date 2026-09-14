# worlds-switch-tokenaccept-3055 - the #3055 switch-back board-token fix (engine A)

## Problem (kosmos#3055)

Multi-Kosmos switch lockout, Josh hit it live on 0.6.64. The board token is
PER-WORLD: each world's store.ROOT holds its own mode-600 `board.token`. On a
switch the board self-restarts (#2346) into the new world and enforces the NEW
world's token, but the browser still holds the world it LEFT in its cookie. So
the switched-to board 403s the browser on every sensitive route:
- `GET /api/worlds` 403s -> the switcher can't read the list. (B, #3063, added an
  ungated names-only `GET /api/worlds/names` so the dropdown still RENDERS.)
- `POST /api/worlds/active` 403s -> pressing switch-back does nothing. **This is
  what A fixes**: the render half is not enough; the switch-back mutation is still
  board-token-gated and 403s on the stale cookie.

## Root cause (verified in server.js + engine/boardauth.js)

`boardauth.tokenOk({ token: boardAuthState.token, ... })` compares the presented
token against the ACTIVE world's token only (`boardAuthState.token`). The board's
purpose (#1946) is "only THIS ACCOUNT can reach this board" - and every world's
`board.token` is a mode-600 file in a mode-700 dir, readable ONLY by this account
(POSIX; #2040 documents the Windows caveat). So the active-world coupling is
incidental: ANY of the account's world tokens is equally strong proof of
same-account ownership. Accepting only the active one is what turns a switch into
a lockout.

## The fix

Accept the presented token if it matches ANY of the account's world `board.token`
values, not only the active world's.

- **engine/boardauth.js** (keep it PURE, world-agnostic):
  - `readTokenFrom(root)` - read `board.token` at an explicit store root (a
    specific world's data dir), or null. No legacy-leaf fallback (that shim is for
    the active store.ROOT during the #2439 migration; a caller enumerating world
    roots already lists every root that exists).
  - `tokenOkAny({ tokens, req, routingBase })` - does the request present a token
    matching ANY token in the list? Same PURE, constant-time `matches()` as
    `tokenOk`, read the presented token once, compare against each candidate.
    Empty/non-string candidates are skipped.
- **server.js**:
  - `boardTokenOk(req)` - the composed gate. FAST PATH: `boardauth.tokenOk` on the
    in-memory active token (the common request pays no filesystem cost). On a miss,
    enumerate the account's worlds (`worlds.listWorlds(worldBase())` ->
    `worlds.worldStoreRoot`), read each world's token
    (`boardauth.readTokenFrom`), and `boardauth.tokenOkAny`. FAIL-CLOSED: if the
    base/registry can't be resolved, only the active token is honoured (exactly
    today's behaviour).
  - Replace ONLY the main dispatch gate (the sensitive-route 403 at ~2634) with
    `boardTokenOk(req)`.

## Scope: why ONLY the main dispatch gate

There are six `tokenOk` callsites. Only the browser COOKIE goes stale across the
self-restart, and the browser only traverses the main dispatch gate. The other
five presenters read the LIVE booted-world token or use an agent token, so a stale
cookie never reaches them:
- **server.js:4522** `/api/team` operator path - reached by the operator UI, but
  it is NOT the lockout: after A the user switches back, the board restarts into
  the old world, the cookie matches again, and every operator surface works. It is
  exempt from the main gate (LOOPBACK_AGENT_ROUTES) and re-enforces in-handler.
- **server.js:9007 / 9105 / 9255 / 9674** report/reply `#1968` `denyPaneFallback`
  guards - the token presenter is the CLI (`kosmos report`, which reads the live
  `store.ROOT/board.token` off disk via `kosmos_curl -H @file`) or an agent token,
  never a browser cookie. Widening acceptance on these same-account SPOOF guards
  would enlarge the accepted-token set with no legitimate use case, so they stay
  strictly active-token. Documented as a deliberate non-change.

## Security invariant preserved (#1946)

A FOREIGN account still cannot present ANY valid token: every world's `board.token`
is mode-600 in a mode-700 dir, so no other uid can read any of them. My code only
READS existing token files; it changes no file permissions. The negative control
(a token that is NO world's on-disk token is refused) proves this at the logic
layer; the file-mode boundary itself is unchanged and is pinned by #1946/#2040.

## Tests (security-sensitive - strong controls, both arms)

- **engine.boardauth-worldtoken-3055.test.js** (pure):
  - `tokenOkAny` accepts a presented token matching any list member; refuses one
    matching none; refuses when nothing presented (the DANGEROUS answer); skips
    empty/null candidates.
  - `readTokenFrom` reads a token at an explicit root; null on absent/empty root.
- **server.board-auth-worldswitch-3055.test.js** (integration, real dispatch):
  boot fully-sandboxed, flip `boardAuthState.on=true`, write a worlds registry +
  a SECOND world's on-disk `board.token`, set `boardAuthState.token` to the ACTIVE
  world's token.
  - POSITIVE: presenting the OTHER world's token PROCEEDS past the gate (not 403).
  - NEGATIVE: a random/foreign token still 403s.
  - ACTIVE still works.
  - The active token alone (no registry, no other world) is unchanged (the
    existing #1946 suite stays green).
  - RED-CAPABILITY: reverting to active-only reds the POSITIVE arm.

## Validation note

The full suite self-contends (`node --test-concurrency=0` boots thousands of
boards at once and saturates the box); a red there is contention, not this code
(Splinter-blessed fallback). Validate via the targeted board-auth suites + running
any full-suite-failing file in isolation. Contention only ever false-REDS.

## Ships after B; #3055 stays open until A lands + ships. Release timing is
Splinter+Josh's call, not mine.

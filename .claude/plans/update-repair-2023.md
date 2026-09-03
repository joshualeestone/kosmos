# Plan: update-repair-2023

Addresses **kosmos#2023** (the ENGINE half; Renet Tilley owns the frontend not-signed-in
render). Design paired with Baron Draxum (he holds the auth surface + the setup.sh path).

## The outage

0.6.25 was the first release carrying #1946's board-token ENFORCEMENT (via #1972). Every
protected `/api/*` read now requires the httpOnly board cookie. Only a browser OPEN
(`?boot=<nonce>` -> `boardauth.bootstrap` -> cookie) sets it. `install/setup.sh` opens the
browser on a FRESH install but NOT on an UPDATE (line 47: "updates never do"). So every Mac
that AUTO-UPDATED to 0.6.25 and opens its board from a bookmark, pinned tab, or typed
`127.0.0.1:16180` gets a cookie-less page that 403s every read -- an empty, `?`-filled
board. Ben's and Casey's machines (the outside testers) and Josh's all hit it. Relaunching
the .app does not fix it: the app's own token support was added the SAME hour as the
enforcement (6e775359), so an older bundle cannot auth either.

## Two backend mechanisms (both Baron's design)

**(a) The one-time update repair-open (un-break-critical; app-independent).** Make an UPDATE
do what a fresh install does: mint a nonce, open the OWNER's browser at `?boot=<nonce>`. The
cookie is Max-Age 400 days and persistent, so it is ONE-TIME per browser+origin -- so this
is marker-gated (`store.ROOT/.reauth-seeded`, version-agnostic) to fire on the FIRST update
carrying it and never again, keeping the "no tab per update" property. Enforcing-only
(`-s board.token`, setup.sh's reading of `enforced()`); a sandbox board has no cookie to
seed. This works whether the .app is new, old, or never opened -- the only remedy that has
not failed on a real machine.

**(b) The token-exempt reconnect `POST /api/self-open`.** A page holding no cookie calls it;
the BOARD process mints a nonce and opens the owner's browser at `?boot=<nonce>`. The nonce
is NEVER returned (mint-and-deliver-out-of-band), so a foreign loopback caller can only pop
the owner's tab -- a nuisance, not a breach; #1946 stays closed for every other route.
Auth-critical constraints (Baron): exempt the TOKEN check ONLY (a distinct `exemptSelfOpen`
at the gate, NOT `REMOTE_AGENT_ROUTES`); the `crossSiteWrite`/Origin guard + loopback-only
STAY ON (a token-exempt cross-site POST would be CSRF); mint server-side; open the board's
OWN dashboard URL only (`req.socket.localPort`, never a caller-supplied target -> no
open-redirect); `execFile` with an argument array (no shell); debounced (one open per 5s)
against tab-storming.

## Files

- `install/setup.sh`: the enforcing-update repair-open (marker check + gate + seed), reusing
  the fresh-install mint+open block verbatim.
- `server.js`: the `exemptSelfOpen` gate carve-out + the `POST /api/self-open` handler + a
  module-scope debounce.

## Scope

Not built here (deferred, per Baron + Splinter): the REAL paid/account signal (engine/
coordinator, Baron's relay). The frontend not-signed-in render is Renet's. Adjacent open
question routed to a separate check: does the 0.6.25 update actually REPLACE the .app bundle
(setup.sh:327-370 / engine/update.js:41)? If not, the app lags the engine indefinitely --
its own defect. (a) is app-independent so it does not block on that.

## Test

- `server.self-open-2023.test.js` (5): self-open without the token is 204 and returns
  NOTHING (no nonce); it opens the board's own `?boot` URL, never a caller target; a CONTROL
  proves the exemption is scoped (another `/api/*` still 403s); the cross-site POST is
  refused (the same-origin guard stays on -- the anti-CSRF control); and a second call
  within the window is debounced. Uses a `KOSMOS_OPEN_CMD` recording stub, so no real
  browser opens.
- (a) is a shell install-path change: verified by `sh -n` + this card's own acceptance
  criterion, which is a MANUAL check "from a browser that has never held a cookie" on a real
  machine (a unit test cannot stand in for it), plus Baron's auth-review of the diff.

## Validation

- `node --test server.self-open-2023.test.js` -> 5/5 pass. `node --check server.js` clean.
  `sh -n install/setup.sh` + `bash -n` clean.
- No `web/` change (no #1720 gate). Node change -> the node suite runs on CI.
- Full suite via GitHub CI (the box is release-held locally).

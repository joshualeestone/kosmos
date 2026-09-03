# kosmos#2030 — Seed `.reauth-seeded` on nonce REDEMPTION, not dispatch

Split out of #2023 (the board-auth update-repair). Non-blocking residual surfaced by
#2023's challenge loop. Splinter ruled it mine to build, Baron reviews before merge,
NOT into 0.6.26.

## The residual

#2023's fix (`install/setup.sh`) seeds the one-time marker `store.ROOT/.reauth-seeded`
when the browser open is DISPATCHED (a launchctl-bootstrap hand-off, or a direct `open`
returning 0) AND a nonce was minted. Dispatch is not redemption: the marker is written
before the browser has actually fetched `?boot=<nonce>` and been handed the cookie. In
the unattended auto-update case, the open can succeed while the browser is cold / never
foregrounds, so the nonce expires (2-min TTL, #1979) unredeemed. The page then loads
cookie-less, 403s every `/api/*`, and `.reauth-seeded` is already written — so the
one-time repair never fires again. Recourse is the owner running `kosmos open`.

## The fix

Write `.reauth-seeded` when the nonce is actually REDEEMED (server-side, at the point
boardauth sets the durable cookie on a successful `?boot=` redemption), not when
`setup.sh` dispatches the open.

- **`engine/boardauth.js`**: add `REAUTH_SEEDED_FILE`, `reauthMarkerPath()` (same
  `store.ROOT` source of truth as `tokenPath()`), and `seedReauthMarker()` — idempotent,
  best-effort, non-gating, mkdir-p's `store.ROOT` so the marker still lands. `bootstrap()`
  stays PURE but flags a successful `?boot=` redemption with `viaBootNonce: true` so the
  caller (not the pure function) does the write. A `?token=` bootstrap sets the same
  cookie but is NOT flagged (only a real redemption seeds).
- **`server.js`**: at the bootstrap handler, `if (boot.viaBootNonce) boardauth.seedReauthMarker()`
  before the 302. Best-effort — the cookie is already in the redirect, so a failed marker
  write must not change it.
- **`install/setup.sh`**: remove the dispatch-time write and the `_seed_after_open`
  plumbing; KEEP the read-gate (`[ ! -f "$_repair_seed" ]`) that decides whether to open.
  An un-redeemed machine stays unseeded and RETRIES the auto-open next update until a
  browser navigates (self-healing); a machine that DID redeem is seeded exactly once by
  the redeemer and never re-opens. `_minted_nonce`/`_opened` left set-but-unused to keep
  this security-path diff minimal (prunable separately in review).

## Why it is safe

Redemption already requires a valid nonce (board-token-gated mint), so writing the marker
on redemption is not attacker-triggerable the way the dropped #2023 (b) self-open endpoint
was. Stays enforcing-only (redemption only runs under `boardAuthState.on`).

## Not in scope (Splinter's carry-in)

`boardauth.js:140` `chmodSync(tokenPath(), 0o600)` is a silent no-op on Windows, and the
`:104-109` "real boundary" comment is macOS-specific. Filed separately by Splinter; do NOT
widen this card to it.

## Tests

- `engine.boardauth-nonce-1979.test.js`: `bootstrap` flags `viaBootNonce` on `?boot=` but
  not on `?token=`.
- `server.board-nonce-1979.test.js`: a real `?boot=` redemption writes the marker; a
  `?token=` bootstrap and a garbage boot do NOT (each arm has a control that can fail).

## Review + release

Baron reviews before merge (board-auth surface owner). NOT into 0.6.26.

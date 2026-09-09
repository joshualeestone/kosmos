# Plan: boardtoken-leaf-2509 -- resolve board.token across the store-leaf rename (#2509)

## The outage (verified)

Self-report + liveness froze fleet-wide (every agent on this mac-mini) at 2026-09-03T13:23Z
and nothing has written since. The board is alive (wouldping still writes today). Root, verified:

1. Renet's bisect: PR #1976 (`9025a045`, merged 09-03T06:03) hardened `POST /api/report` so that on
   an ENFORCING board a report with no agent token AND no valid board token is refused before both
   writers (`selfreport.record`, the liveness beat). Activated by the 09-03T13:23 restart. wouldping
   survives because it is written from the status tick, not the auth-gated report route.
2. Deeper (this branch): the board token that a same-account `kosmos report` must present DOES exist
   and IS valid -- presenting `~/Library/Application Support/Kosmos/board.token` to the live enforcing
   board (127.0.0.1:16180) flips the refusal from "board belongs to the account..." to "no such
   endpoint" (past board-auth). The CLI simply cannot FIND it: this box runs the board from
   post-#2439 source (`store.ROOT = .../Kosmos`), while the installed CLI bundle (Sep-3-08:48) has
   #1976 but PRE-dates #2439 (`store APP = AgentWorkforce`). #2439 (09-07) `fs.rename`d the whole
   store leaf AgentWorkforce -> Kosmos, moving board.token out from under the stale CLI. So the CLI
   reads `AgentWorkforce/board.token` (emptied by the migration) -> presents no token -> refused.

Timeline note (honest): the 09-03 onset is #1976 requiring a token, NOT #2439 (which was 09-07).
Why the 09-03..09-07 window (both on AgentWorkforce, token findable there) also refused is a
separate reject-log question, not pinned here; the CURRENT continuous root is the post-09-07
leaf skew, and that is what this fixes.

## Why NOT the directed server-side from_pane restore

The board listens TCP-only (no peer-uid on the loopback connection) and boardauth's ONLY same-account
signal is the mode-600 board.token. `messages.resolveSender` runs `tmux display-message -t <from_pane>`
on the board's OWN tmux, so a second macOS account can POST `from_pane=%1` and be resolved to a real
agent -- exactly #1968's spoof. Re-allowing the bare from_pane fallback cannot be gated same-account,
so it would REOPEN #1968. Splinter agreed; we fix the token path instead.

## The fix (this branch) -- keeps #1968 fully intact

`engine/boardauth.js` resolves board.token across BOTH the current leaf (Kosmos) and the legacy
leaf (AgentWorkforce):
- `readToken()` reads the current leaf, falling back to the legacy leaf if the current is absent.
- `ensureToken()` MIRRORS the token to the legacy leaf (mode-600 file in a 0o700 dir), so a CLI
  resolving EITHER leaf reads the SAME token. The mirror is written ONLY when the legacy dir already
  exists (a box with a pre-#2439 CLI bundle, or mid-migration); it NEVER recreates the dir on a clean
  install, so it does not resurrect what #2439 removed on boxes that do not need the shim.

Security: both copies are owner-only (0o600 in a 0o700 dir), so a second account still cannot read
either -- the #1968 cross-account spoof stays denied. A token-less report on an enforcing board is
still refused. The mirror changes only WHERE a same-account caller can find its own token, never WHO
can read it.

🛑 TEMPORARY COMPAT SHIM (Splinter's caveat): the legacy-leaf mirror writes a live credential back
into the #2439-deprecated AgentWorkforce leaf. It restores the 5-day outage NOW without waiting on a
per-box bundle update. The DURABLE fix is to update the installed CLI bundle to the post-#2439 store
path (resolves Kosmos natively), after which this mirror can be removed. Filed as a follow-up card so
the shim does not become permanent debt against the migration.

## Test (engine.boardauth-leaf-2509.test.js) -- 5 arms

- MIRROR: with a legacy leaf dir present, `ensureToken()` writes board.token to BOTH leaves with the
  SAME value, mode 0o600 (the mode assertion is the red-capable #1968-preservation check: a
  world/group-readable mirror would reopen the cross-account read).
- NO-RESURRECT: with NO legacy dir, `ensureToken()` does NOT create one (never resurrect the
  deprecated leaf on a clean install).
- READ FALLBACK: `readToken()` returns the token from the legacy leaf when the current leaf lacks it.
- BACKFILL: a token found ONLY on the legacy leaf is written to the authoritative current leaf
  (mode 0o600), so it survives the legacy leaf's eventual removal.
- PRIMARY WINS: when both leaves have a token, `readToken()` prefers the current leaf and
  `ensureToken()` re-syncs the mirror (a stale legacy token is overwritten -- no divergence).
- Non-vacuous: the mirror and backfill arms fail if their respective code paths are removed (verified).

🛑 The #1968 refusal itself (a token-less / bare-`from_pane` report on an enforcing board is STILL
refused) is NOT re-proven here on purpose: this fix does not touch `resolveAgentSender`,
`denyPaneFallback`, or the report route, so that behavior is unchanged and is proven end-to-end by
the existing `server.report-reply-loopback-1968.test.js` (5/5, re-run green with this change). That
is the red-capable "spoof stays denied" arm for this fix.

## Acceptance

A same-account `kosmos report` on this box presents the board.token (found at either leaf) and records
again; a token-less report on an enforcing board is still refused; the mirror never creates the legacy
dir on a clean install; validation green. Credits Renet's read-only bisect. Closes #2509 (with the
durable bundle-update follow-up carded).

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
board. Ben's, Casey's, and Josh's machines all hit it. Relaunching the .app does not fix it
(its own token support shipped the SAME hour as the enforcement).

## The fix: the one-time update repair-open (a)

Make an UPDATE do what a fresh install does: mint a nonce, open the OWNER's browser at
`?boot=<nonce>`. The cookie is Max-Age 400 days and persistent, so this is ONE-TIME per
browser+origin -- marker-gated (`store.ROOT/.reauth-seeded`, version-agnostic) to fire on
the FIRST update carrying it and never again, keeping the "no tab per update" property.
Enforcing-only (`-s board.token`, setup.sh's reading of `enforced()`); a sandbox board has
no cookie to seed. This works whether the .app is new, old, or never opened -- the only
remedy that has not failed on a real machine. It is OWNER-initiated (the update runs as the
owner) and equivalent to the pre-existing fresh-install open, so it adds no new attacker
primitive.

Files: `install/setup.sh` -- the enforcing-update repair-open (marker check + gate + seed),
reusing the fresh-install mint+open block verbatim.

## Why the in-app reconnect button (b) was DROPPED, not shipped

The original design also added a token-EXEMPT `POST /api/self-open` (an in-app reconnect a
no-cookie page could call). **The challenge loop found it is a durable-token disclosure to a
hostile second local account, and it cannot be made safe.** Redeeming `GET /?boot=<nonce>`
returns `set-cookie: kosmos_board=<durable token>` to any loopback caller (boardauth.js
:348-351), and `open /?boot=<nonce>` puts the nonce on argv, visible to every macOS account
via `ps -ww` (#1979's own threat model, boardauth.js:263,274-289). #1979 accepted that
argv/ps race ONLY because minting is board-token-gated, so a hostile account cannot trigger
it and must passively wait for the owner's `kosmos open`. A token-exempt self-open removes
that gate: the attacker triggers a mint on demand (crossSiteWrite does not stop a non-browser
`curl` forging its own Origin; `remoteWriteGuard` passes on loopback), `ps`-grabs the nonce,
and wins the redeem race before the slow browser launch, recovering the durable token and
full `/api/*` including code execution.

This is not fixable by a smaller change: a reconnect must prove OWNER-ship, which requires
the board token, which a no-cookie page by definition lacks. **The safe reconnect already
exists -- the CLI `kosmos open`, run in the owner's terminal, which holds the token.** So the
frontend's not-signed-in fallback should name `kosmos open`, not an in-app button.

## Scope

Not built here (deferred): the real paid/account signal (engine/coordinator, Baron's relay).
The frontend not-signed-in render is Renet's. Adjacent app-bundle question settled and
reported to Splinter: the update DOES replace the .app bundle in the normal case (make_app at
setup.sh:2993 is not FRESH_INSTALL-gated), so it is not a blanket "never replaces" defect --
the specific app-can't-auth failure is machine-conditional, and (a) moots it.

## Test

(a) is a shell install-path change: verified by `sh -n` + `bash -n`, and by this card's own
acceptance criterion, which is a MANUAL check "from a browser that has never held a cookie"
on a real machine (a unit test cannot stand in for it), plus Baron's auth-review of the diff.
The reviewer confirmed the (a) logic is enforcing-only, one-time, errexit-safe under
`set -euo pipefail`, empty-safe, and POSIX-clean.

## Validation

- `sh -n install/setup.sh` + `bash -n install/setup.sh` clean.
- No `web/` change (no #1720 gate). No node engine change (b dropped), so the node suite is
  unaffected; the shell-lint of setup.sh runs in `test:shell`.
- Full suite via GitHub CI (the box is release-held locally).

# Plan: #1959 - extend the observed-liveness badge to the other listLive() consumers

Follow-up to #1921 (which made the Settings account badge render VERIFIED liveness from
`connection.badge`, the last observed real-call outcome, instead of the raw "a credential exists"
`connection.state === 'connected'`). #1921 scoped itself to `paintAccounts()`; the other surfaces
still read raw `.state`, so one merely-existing-or-rejected credential can read "connected" on them
while Settings honestly shows unverified/rejected. Greenlit by Splinter (night shift); #1921 owner
absent (no assignee, stale branch). Base confirmed on main: commit e8ac8f6e (#1966),
`engine/observed.js` with `verdict()`, `render-account-badge-1921.js` wired.

## The badge vocabulary (engine/observed.js verdict)
- `working` - a real request succeeded recently (verified live).
- `rejected` - a real request was rejected recently (credential exists but needs renewing; the #874 "rejected token sat green" case).
- `signed_in_unverified` - a login exists but no recent success seen; it verifies itself on the next call.
- `signed_out` - no login.
- `unchecked` - could not tell.

Raw `.state === 'connected'` == "a credential exists", which spans {working, signed_in_unverified, and even rejected}. That is the imprecision #1959 removes.

## Data source
Both frontend consumers read account rows from GET /api/accounts, which already overlays `.badge`
on Claude rows (server.js ~3855). So NO server change is needed: the rows carry `.badge`; the fix is
to have the consumers decide from `.badge` (with the legacy `.state` ternary as the back-compat
fallback for badge-less rows - OpenAI rows, or a new-page/old-server skew - exactly as
`paintAccounts()` does).

## Two shared frontend helpers (avoid the "two derivations of one fact" anti-pattern)
- `acctUsableLogin(a)` - a login exists that works OR will verify on next use: `badge === 'working' || badge === 'signed_in_unverified'`; fallback (no badge) `state === 'connected'`. Excludes `rejected` (needs renewing) and `signed_out`/`unchecked`.
- `acctUnknownLive(a)` - could not tell: `badge === 'unchecked'`; fallback `state === 'unknown'`.

(An earlier draft added a third `acctVerifiedWorking` = `badge === 'working'` only. Dropped after reading paintConnLive: counting working-only would say "Nothing is connected yet" whenever logins exist but none has been exercised, which is a false claim in the OTHER direction. The reported #1959/#874 defect is that a REJECTED credential reads connected, not that an unverified one does; `acctUsableLogin` removes rejected while keeping unverified honest.)

## Per-consumer changes and the semantics call (each reversible; documented per Josh's ruling)

1. **`paintConnLive()` summary (~20302)** - the board box "N accounts are connected and thinking for your agents."
   - Count `acctUsableLogin` (working OR will-verify), NOT raw `connected`. Rationale: the ONLY behavior change vs today is that a `rejected` account no longer counts (today it does, via raw `.state === 'connected'` - the exact #874 "rejected token sat green" defect on this surface). Unverified logins still count, so the box never falsely says "nothing connected" when logins exist.
   - Keep the honest-unknown path via `acctUnknownLive` (`badge === 'unchecked'` / `state === 'unknown'`) -> "could not check", never "nothing connected".
   - **Weakest premise:** a machine whose only accounts are all `rejected` now reads "Nothing is connected yet" rather than counting them. That is coarse (a rejected account has a login needing renewal), but it is strictly better than today's false "thinking for your agents", and the Settings > Accounts tab shows the rejected detail. Reversible.

2. **Move/disconnect eligibility (~24794)**
   - `signedInTarget` = is there another movable account to move onto: `acctUsableLogin` (a login that works or will verify is a valid target), NOT just working. Rationale: you can move an agent onto an existing login even before its first verified call; requiring `working` would refuse a valid target.
   - `signedOut` (the agent's CURRENT account is unusable, so the move UI must appear) = `!acctUsableLogin(acctLive)`. Rationale: a `rejected` current account (credential exists, `.state === 'connected'`, but a real call was rejected) is effectively signed out for use - #874's exact case - so it should now trigger the move prompt. `signed_in_unverified` is NOT signed out (a login exists).
   - **Weakest premise:** flipping `signedOut` to badge-based means a rejected current account newly triggers the move UI. That is the intended improvement (a rejected credential is not usable), but it is a behavior change; reversible.

## Scope of THIS PR (a verifiable slice), and what is deferred and why

Pete's re-scope (on the card, needs-browser) established that the FULL #1959 is cross-layer: the
observed->consumer join (accountForAgent, keyed by agent name) exists ONLY in the server
/api/accounts route today, so only consumers fed by /api/accounts can read `.badge` without new
server->engine plumbing.

**THIS PR delivers the THREE consumers that ARE fed by /api/accounts (so the badge is already on the
row) - a clean, browser-verifiable slice, web/index.html ONLY (no server.js, so no collision with
the active whoami PR #2218):**
- `paintConnLive()` - the board "connected & thinking" summary. Now counts `acctUsableLogin`
  (rejected excluded - the #874 defect on this surface).
- `paintAccountPicker()` - the move/disconnect eligibility. A `rejected` current account is now
  signed out (the move UI appears); a usable sibling is offered as the target.
- `fillCreateAccounts()` - the CREATE-agent account picker (folded in from a challenge-loop
  finding: it is a third /api/accounts-fed consumer, and the card's named "account picker"). Uses a
  third helper `acctOfferableTarget` (exclude the CONFIRMED-unusable - rejected/signed_out - but keep
  the include-and-label philosophy for uncertain/unchecked). Before this a `rejected` account
  (state `connected`) was offered as a create target and the new agent could not run; its own comment
  named the trap ("the badge cannot see a REJECTED token"). The create picker's `labelOf` also now
  reads the badge vocabulary (`acctUnknownLive`) for the "could not check just now" annotation.

**DEFERRED to a browser-capable session (documented on the card, stays open under Addresses #1959):**
- **`subscription.js computeMachine` (the #2130 machine-level "any signed in" banner).** Genuinely
  cross-layer: the observed store is keyed by AGENT NAME and the agent->account-dir join lives only
  in the server /api/accounts route; computeMachine operates on config DIRS with no access to
  observed data. Extending the verdict there needs observed-verdict-per-dir plumbed from the server
  into the engine - a real design task, and it changes a prominent browser-rendered banner (a 401
  would flip it connected->not), so it wants browser verification, not a 2am headless slice.
- **the `/api/agent/:name/account-status` route (#1885) in server.js.** Overlaps the active whoami
  PR #2218 (same server.js region); not touched to avoid a collision.
- **`frPaintOpenai` (first-run).** Reads an OpenAI account's state; the server overlays `.badge` onto
  CLAUDE rows only, so OpenAI rows never carry a badge - the badge overlay does not apply. Left as-is
  (not a real badge consumer).

## Guard
A browser-check (`render-observed-consumers-1959.js`, hermetic file://) with three arms: the shared
helper matrix (acctUsableLogin/acctUnknownLive across every badge + the badge-less fallback); the
paintConnLive summary via a fetch stub (counts usable, EXCLUDES rejected, honest on unchecked); and
the paintAccountPicker eligibility via a seeded ACCOUNTS global (a rejected current account is signed
out and offers the working target; a working current account is the control). Verified 16/16
(chromium+webkit) on the fix, and proven RED on the pre-fix page by OBSERVED BEHAVIOR: it counts
"3 accounts connected" (rejected included) and a rejected current account gets no move prompt.

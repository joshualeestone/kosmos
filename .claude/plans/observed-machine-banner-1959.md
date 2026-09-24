# observed-machine-banner-1959 -- computeMachine honours the observed per-dir verdict (#1959)

## What this is
The last live residual of #1959. The card extended the observed-liveness overlay to the
/api/accounts-fed consumers (#2220, #2223, merged). One consumer stayed on the raw
credential-exists signal: `subscription.computeMachine`, which feeds the #2130 machine-level
"can this computer reach a Claude subscription?" banner. A token that exists on disk but was
rejected on a live probe (an expired 401) still made that banner say "connected".

## Why it was deferred, and why the premise is now stale
The 2026-09-05 deferral said computeMachine could not read observed data because the observed
store was keyed by AGENT NAME and the agent->dir join lived only in the server /api/accounts route,
so extending it needed server->engine plumbing + a browser pass. That is no longer true: #3136
(merged the same day, after the deferral) added a DIR-KEYED observed store -- `observed.sawDir` /
`observed.readDir` -- populated by the "Check now" route (server.js) with OK on a live CONNECTED and
REJECTED on a live NONE. So computeMachine (engine) reads the per-dir verdict directly via
`observed.readDir(ANTHROPIC, dir)`: engine->engine, fully headless, no server plumbing.

## What I changed (engine/subscription.js only)
- `observedReachable(raw, dir)`: overlays `observed.verdict()` onto a raw `check()` result for one
  dir. A FRESH observed rejection returns not-reachable with an honest signed-out verdict; a fresh
  OK or `signed_in_unverified` (or a missing observed module) keeps the raw credential-exists
  answer. Freshness and direction are entirely verdict()'s.
- `computeMachine`: applies the overlay to the default (base) and each scoped dir. A fresh-rejected
  account no longer counts as reachable; when nothing is reachable it returns the base verdict,
  already corrected to the signed-out wording if the default was raw-connected but freshly rejected.
- `machineStatKey`: folds each dir's observation (outcome + FRESHNESS, not the raw timestamp) into
  the 5s memo key, so a Check-now rejection -- which changes no config file -- invalidates the memo,
  and a fresh->stale transition flips it back. Freshness in the key means it invalidates exactly when
  the verdict would change, adding no spurious recompute.
- `observed.isFresh`: extracted as the SINGLE owner of the fresh/stale rule. `verdict()` and the memo
  key both call it rather than each hand-rolling `age >= 0 && age <= limit`, so the key cannot drift
  out of sync with the verdict it tracks (the two-copies-of-one-fact hazard).

## What I rejected / did NOT do
- The CONTINUOUS agent-name-keyed feed (status.js) reaching computeMachine. That still needs the
  agent->dir join from the server layer and changes a prominent banner on a continuous 401, which
  is the genuinely browser-gated / cross-layer piece. It stays deferred, correctly. This slice
  covers it for free the day a continuous dir-keyed feed lands.
- Inventing a new STATE. The rejected case maps to the existing STATE.NONE (the machine cannot
  reach a subscription right now) with a rejection-specific `because`; NONE, not UNKNOWN, because we
  DID check (a fresh live probe found it signed out), and NONE is what drives the correct
  "sign in again" action.
- No web/ change: the banner render already reads checkMachine's output; only the engine verdict
  changed.

## Non-regression
Absence of any observation -- the common case, an empty dir store -- returns the raw `check()`
unchanged, so this is a strict no-op until Check-now has actually seen something. It only ever
subtracts a false positive (a stale connected a fresh probe found signed out); it never invents a
connection. Existing subscription/machine/observed/accounts suites: 75/75 green. New file
`engine/subscription.machine-observed-1959.test.js`: 7/7 (fix, non-regression, freshness both
directions, non-default, memo invalidation, memo fresh->stale).

## Weakest premise
The dir store is fed only by the user-initiated "Check now" today, so the overlay fires only after a
Check-now returns signed-out. That is the exact within-app inconsistency #1959 named for this
consumer, it is correct and non-regressing, and it is the honest scope of what #3136 unblocked. What
would change the value calculus: a continuous dir-keyed feed, at which point this same overlay
applies with no further change.

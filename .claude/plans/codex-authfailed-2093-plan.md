# kosmos#2093 — surface a dead codex credential as auth_failed on turn 1

## The gap (measured, not assumed)
`status.js classify()` has a Claude auth read (`authFailed(tail)`, ~2418) but the **codex
branch** (~2340-2364) has none: it is needs_you / working / idle / else-UNKNOWN. So a running
codex agent whose credential died — the #1906 fail-open residual, where
`create.accountConnectable` deliberately lets an *unreachable-at-create* check through and the
key turns out actually dead, 401ing raw on turn 1 (#1903's symptom) — reads
UNKNOWN ("nothing on its screen says what it is doing"), never the actionable auth_failed.

The Claude arm is already covered for this case by the existing scrape + #1930 authprobe + #1921
observed machinery. The codex arm is the real, uncovered gap.

## Why not a scraper marker
A scraper cannot separate a genuine dead-credential 401 from codex's **transient reconnect-loop
401** (status.js's own CODEX_WORKING fixture reads WORKING, correctly). The only discriminating
signal is the actual auth CONDITION: `openaiaccounts.checkLive` (GET /v1/models — 200 works, 401
dead; only an absent auth file or OpenAI's own `invalid_api_key` map to NONE). So the fix lives
in the state/liveness layer, mirroring the proven `authprobe.js` pattern in the **produce**
direction.

## Deliberate scope: codex only (not a shortcut)
The PRODUCE-from-checkLive path is correct for codex (checkLive is a reliable *positive* dead
signal) and **inappropriate for Claude via checkLive** — `claude auth status` returns
`loggedIn:true` even for a rejected token (#874), which is exactly why `observed.js` exists. For
Claude, the existing scrape+authprobe+observed machinery already handles the dead-cred case.

**Also pane-scoped (residual gap, no regression):** the produce fires only through the paned
`reconcileReport` call that `snapshot()` makes with `codexLiveAuth` resolved. `panelessCard()`
calls `reconcileReport()` with three args, so `codexLiveAuth` is `undefined` there and a
paneless (remote, no-window) codex agent whose credential is dead still reads UNKNOWN. That is
the same state it read before this change (no regression), and it is consistent with the
pane-based scope above, but the next person on remote agents should know the produce path does
not reach a paneless agent yet.

## Changes
1. **`engine/codexauthprobe.js`** (new) — per-codex-home cached/TTL/async verdict over
   `openaiaccounts.checkLive`. Reuses authprobe's verdict strings (one copy, no drift), own
   cache. Safety contract INVERTED vs authprobe: it produces a red, so `EXPIRED` (the trigger)
   comes only from a positive `NONE`; unreachable/unchecked/**stale-EXPIRED**/connected all
   return non-EXPIRED. A null dir resolves to `openaiaccounts.defaultDir()` (NOT `checkLive(null)`,
   which would read CWD/auth.json → false NONE).
2. **`engine/status.js`** —
   - `codexLiveAuthFor(name, readJobFn, verdictFn)`: resolves a codex agent's own home from its
     job; refuses a non-codex job (an OpenAI check must never judge a Claude agent).
   - snapshot(): resolves `codexLiveAuth` only for a codex pane, UNKNOWN scrape, named-ours.
   - `reconcileReport(...)` gains a `codexLiveAuth` param and a top-level branch (after the
     disruption branch, above the no-report early return): `UNKNOWN scrape + EXPIRED → AUTH_FAILED`
     with a re-auth remedy. The `scraped.state === UNKNOWN` guard means it can never override a
     screen that said something.
3. Tests: `engine/codexauthprobe.test.js` (verdict mapping, stale-EXPIRED downgrade, null→default,
   thrown checker) and `engine/status.codex-authfailed-2093.test.js` (produce + control, safety
   arms, WORKING-guard, `codexLiveAuthFor` runner guard). Perturbation-verified: neutering the
   produce trigger reds 2 tests.

## Weakest premise (named, per night-shift rule)
The end-to-end confirmation that a REAL dead codex credential drives `openaiaccounts.checkLive`
to NONE at turn 1 needs a **live codex agent** (Josh's machine / morning) — it rests on
openaiaccounts.checkLive's #1329 contract, which is itself tested, but I have not run a live dead
codex through the board. The unit-level behavior (given EXPIRED → auth_failed; given anything else
→ UNKNOWN stands) is proven. What would change my mind: a live codex whose turn-1 401 does NOT
drive checkLive to NONE (e.g. a chatgpt-mode account that is not live-checkable) — that account
would keep reading UNKNOWN, which is the correct fail-open, not a regression.

## Reversible
Additive: a new module + one gated reconcile branch + one optional param. Degrades to prior
behavior (UNKNOWN stands) if the probe returns anything but a fresh positive EXPIRED.

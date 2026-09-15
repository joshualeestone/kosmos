# Plan: #2036 observability slice - warn at boot on the #2969 silent staging->prod revert

Branch: `staging-revert-warn-2036`  ·  Card: kosmos#2036 (claimed:renettilley)  ·  Author: renettilley (night shift 2026-09-15)

## Authorization + scope boundary
Splinter (PM) AUTHORIZED this specific slice for the overnight 0.6.67 cut, with an explicit boundary:
BEHAVIOR-PRESERVING ONLY - a diagnostic warn on a channel mismatch. It must NOT change which bytes any
machine installs and must NOT change the channel resolution itself. That is what keeps it OUT of Josh's
gate: Josh gated the byte-CHANGING fix (#2969/#2934 - persist the channel across login) on
real-fresh-machine verification, and no fleet box is on staging tonight. A pure warn is not that fix.

## The problem (from #2969, CLOSED + needs-operator)
A box installed from the staging channel silently reverts to prod at the next login: the board's launchd
job carries no update channel, so `updateChannel()` (engine/update.js) falls back to prod, the poller
fetches the prod pointer, and the box quietly stops being ahead of prod - with no error. That silence is
exactly the failure mode Josh named as #2036's whole reason to exist (a staging population that silently
shrinks toward zero defeats the point of verifying a build before it reaches prod).

## The change (additive-only; git diff = 35 insertions, 0 deletions)
1. `server.js`: new PURE predicate `stagingRevertWarning(recorded, resolved)` = `recorded === 'staging' &&
   resolved === 'prod'`. Kept pure so it is testable and cannot throw on the listen path.
2. `server.js` boot log: right after the existing `Kosmos update check: channel=... pointer=...` line, if
   `stagingRevertWarning(recordedSourceChannel(), updates.updateChannel())`, write a loud WARNING to stderr
   naming the silent revert (#2969) and the remedy (set KOSMOS_UPDATE_CHANNEL=staging). Both reads are
   non-throwing (recordedSourceChannel try/catches to 'prod'; updates.updateChannel is pure).
3. `server.js`: export `stagingRevertWarning` (the warn fires inside the listen callback, which a
   require-only test never reaches, so the predicate is the testable seam).
4. New `server.staging-revert-warn-2036.test.js`: the four-way truth table + an exhaustive control asserting
   ONLY `staging->prod` fires.

## Key design decision + weakest premise
- Compares the RAW install stamp `recordedSourceChannel()`, NOT `sourceChannelNow()` - the latter applies
  #2934's prod-publishes-running re-derivation, which reports 'prod' for a legitimately-promoted staging
  build and would MASK a genuine revert.
- Does NOT fire on `(prod, staging)` - an intentional override toward staging is not the #2969 silence.
- WEAKEST PREMISE: a login-time stderr warning surfaces the revert to whoever reads the board log
  (operator/monitoring), but does NOT fix it - the fix is the parked byte-change. The value is turning a
  silent failure into a diagnosable one; if that surface proves too quiet to matter, the real fix (gated)
  is what closes the card. Left #2036 needs-decision; only this observability slice ships here.

## Verification
- `node -c server.js` OK; `node --test server.staging-revert-warn-2036.test.js` 5/5 pass.
- Diff confirmed additive-only (behavior-preserving).
- challenge-loop to convergence, then normal green-gated PR (merge on CI green per the beta ruling; this is
  not the gated byte-change).

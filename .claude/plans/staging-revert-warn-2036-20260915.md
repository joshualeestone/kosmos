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

## The change (additive-only; behavior-preserving)
1. `server.js`: new PURE predicate `stagingRevertWarning(recorded, resolved)` = `recorded === 'staging' &&
   resolved === 'prod'`. Pure so it is testable and cannot throw on the listen path.
2. `server.js`: composition `stagingRevertWarningNow()` wiring `recordedSourceChannel()` (the RAW install
   stamp) with `updates.updateChannel()`. The accessor choice is load-bearing (see Key design decision) and
   is what the WIRING tests pin.
3. `server.js`: `emitStagingRevertWarning(write = stderr)` -- the boot emit, extracted with an injected sink
   so the if-block AND the exact warning TEXT are testable. On a revert it writes a loud WARNING naming the
   silent revert (#2969) and a PLATFORM-NEUTRAL durable remedy: the channel must be persisted in the board's
   auto-start job (the mechanism + exact variable are per-platform -- points to `tools/release.sh` + #2969
   rather than naming a var inline, so it cannot drift and is correct on Windows too, where there is no
   launchd). The listen callback calls `emitStagingRevertWarning()` right after the existing
   `Kosmos update check: channel=...` line. Both accessor reads are non-throwing.
4. `server.js`: export `stagingRevertWarning`, `stagingRevertWarningNow`, `emitStagingRevertWarning`,
   `sourceChannelNow` (the last so the divergence test can show the #2934 badge would read 'prod' where the
   warn correctly fires).
5. New `server.staging-revert-warn-2036.test.js`: the pure truth table + exhaustive control, the child-process
   WIRING tests (the promoted-build divergence case that catches an accessor swap), and the EMIT tests
   (the emit fires + the exact message text, and stays platform-neutral).

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
- `node -c server.js` OK; `node --test server.staging-revert-warn-2036.test.js` 11/11 pass (5-case pure
  truth table + 3 child-process WIRING tests pinning the raw-stamp-vs-badge accessor choice via the
  promoted-build divergence case + 3 EMIT tests pinning the fire-decision and exact message text).
- Behavior-preserving: no channel-resolution or installed-byte path changes; the only runtime effect is a
  conditional stderr write at boot. (Not literally additive-only after the emit was extracted into
  `emitStagingRevertWarning()`, but no existing behavior changed.)
- challenge-loop to convergence, then normal green-gated PR (merge on CI green per the beta ruling; this is
  not the gated byte-change).

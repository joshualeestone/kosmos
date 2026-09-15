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
   so the if-block AND the exact warning TEXT are testable. On a revert it writes a loud WARNING that is an
   honest DIAGNOSTIC, not a prescription: it names the silent revert (#2969), states that a durable fix is
   tracked in #2969 and not yet shipped (there is no supported durable per-platform persistence recipe today
   -- that recipe IS the parked byte-change), notes that an interactive-shell set does not survive login, and
   points to #2969/#2036 for status. Deliberately platform-neutral (no launchd/EnvironmentVariables wording;
   this callback runs on Windows too) and cites no remedy doc, because none currently documents the durable
   fix -- an earlier draft pointed at `tools/release.sh`, whose only relevant line is the ephemeral form this
   warning warns against. The listen callback calls `emitStagingRevertWarning()` right after the existing
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
- `node -c server.js` OK; `node --test server.staging-revert-warn-2036.test.js` 14/14 pass: 5-case pure
  truth table + 3 child-process WIRING tests (raw-stamp-vs-badge accessor choice via the promoted-build
  divergence case) + 3 EMIT tests (fire-decision + exact message text) + 1 DEFAULT-SINK test (no-arg
  default routes to stderr not stdout) + 2 BOOT tests that boot the real app.start(0) in a child sandbox
  and assert the warning is / is not on stderr -- closing the last seam (that the listen callback actually
  calls the emit) end-to-end through the real boot path, so no untested-wiring tradeoff remains.
- Behavior-preserving: no channel-resolution or installed-byte path changes; the only runtime effect is a
  conditional stderr write at boot. (Not literally additive-only after the emit was extracted into
  `emitStagingRevertWarning()`, but no existing behavior changed.)
- challenge-loop to convergence, then normal green-gated PR (merge on CI green per the beta ruling; this is
  not the gated byte-change).

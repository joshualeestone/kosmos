# firstrun-flake-3030 - click-first-run first-run.json race + dirty-retry (#3030)

## Problem
On a release cut's step 3b, `docs/browser-checks/click-first-run.js` RED a cut (release-exit=1) on
2026-09-13 with `ENOENT ... first-run.json`. The card names TWO distinct bugs:

1. **first-run.json write/read RACE (the primary flake).** After the Giddy Up ending the check reads
   the completion flag immediately. The flag is written by `/api/first-run/complete`
   (engine/firstrun.js, the single writer, an atomic write-then-rename of `{completedAt}`); under cut
   load that write lags the read → ENOENT. Evidence it is a load flake, not a regression: 0.6.62
   passed this exact check ~2h before; the batch touched no first-run code; it then passed 5 later
   cut attempts.
2. **The flaky-timeout retry reuses a DIRTY sandbox.** `run_one` (tools/browser-checks.sh) retries a
   failed check by re-running the SAME command with the SAME `$sbc`, so attempt 2 ran against
   attempt 1's contaminated board and cascaded into unrelated assertion failures.

## What this branch ships (bug 1 - the root fix)
`docs/browser-checks/click-first-run.js`:
- Add `waitForFlag(flagPath, {requireCompletedAt, timeoutMs})` - a BOUNDED poll (100ms interval,
  5s cap) that returns the parsed flag once it exists (and, when required, once it carries
  `completedAt`), or null after the timeout.
- Replace the immediate read at the Giddy Up ending (`existsSync` + `JSON.parse(...).completedAt`)
  with `waitForFlag(FLAG, {requireCompletedAt:true})`. A genuinely-never-written flag STILL fails
  the assertion (returns null) - the race is removed, not masked.
- Apply the same bounded poll to the Escape "mark seen" read (same lag class; the flag has one
  atomic writer, so it is always valid JSON when present).

Why this is the right root fix: the flag has exactly one writer (engine/firstrun.js:59), an atomic
rename, so the file is either absent (ENOENT) or complete-and-valid - the failure is pure timing, and
a bounded poll is the deterministic answer. It also makes the check not flake, so it no longer
trips `run_one`'s retry - which is what triggered bug 2's cascade for this check.

## Verification
- `node --check` clean.
- Focused logic test (scratch): the poll catches a 400ms-lagged write and returns right after it;
  returns null for a never-written flag after the bounded timeout (assertion still fails); the
  existence-only Escape path returns the flag when present. All pass.

## Deferred to a scoped follow-up (bug 2 - the dirty retry)
NOT in this branch, deliberately. The correct fix is "a fresh sandbox per retry attempt", but a fresh
sandbox is bound to a freshly-booted board (the board reads/writes `$sbc/data`), so it requires a
mid-run kill-and-reboot of the click-first-run board. Measured constraints that make this a
cut-critical, verification-hungry change unsafe to ship during Josh's live 0.6.63→prod cut:
- All 16 harness ports (P1-P16) are already allocated - no spare port, so a retry must kill the
  first board and re-bind P12 (a port-release timing window).
- No existing check kills+reboots a board mid-run; `SERVER_PIDS` is append-only, killed only at the
  global cleanup trap. A botched teardown could leak a board, collide on P12, or corrupt the
  SERVER_PIDS accounting the cleanup relies on.
- It wants a real run of the full harness under load to verify - exactly what one should not do to
  cut-critical infra mid-cut.

Bug 1 is the root cause of the cut-redding; with it fixed the check is deterministic and does not
retry, so bug 2's cascade does not fire for THIS flake. Bug 2 remains a real robustness gap (any
mutating check that fails for another reason would retry dirty) and is left as documented residual on
#3030 with this design.

## Weakest premise
That the Escape "mark seen" write goes through the same single atomic writer as the completion write.
Verified: engine/firstrun.js is the only writer of first-run.json and always emits `{completedAt}`
atomically, so polling for a parseable flag there is correct. If a future change adds a second writer
that emits a different/partial shape, the Escape poll's `requireCompletedAt:false` (parseable-only)
still holds as long as that writer is atomic.

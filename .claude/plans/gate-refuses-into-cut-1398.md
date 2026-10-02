# Guard the unguarded direction: a browser GATE refuses to start into a running cut (kosmos#1398)

## Problem
(Corrected in review 1:) `release.sh` asks at its start only whether another CUT or an install harness is live
(`kosmos_refuse_if_cut_live`, `kosmos_refuse_if_harness_live`); it never asks about a running gate. A gate refuses
only when another BROWSER run is live, and a cut has one only during step 3b. But a GATE
(`tools/browser-checks.sh`) started while a cut was already running had nothing to
stop it, and killing that gate killed the cut with it. Card: three cuts, ~90 min.

Only a social rule ("no gates during a cut") held the line, and the obvious check
(`pgrep -f release.sh`) self-matches the asker's own command line, so a careful
person breaks it.

## Fix
Mirror the machine-claim consult that `run-tests.sh` already does into
`tools/browser-checks.sh`:

```sh
if command -v kosmos_refuse_if_machine_claimed >/dev/null 2>&1; then
  kosmos_refuse_if_machine_claimed "this page layer" || exit 1
fi
```

placed right after the existing `kosmos_refuse_if_browser_run_live` guard, before
the freeze/board-boot region.

## Why the machine-claim guard, not kosmos_refuse_if_cut_live
`kosmos_refuse_if_cut_live` keys on the cut's RUN-MARKER, which the gate process
does not carry, so a cut running its OWN 3b (which invokes browser-checks.sh) would
see the cut marker as foreign and refuse ITSELF -- breaking every cut. The
machine-claim guard is self-exclusion-safe: `release.sh` calls `kosmos_claim_machine`
which EXPORTS `KOSMOS_MACHINE_CLAIM_COOKIE`, and the cut's own 3b inherits it, so
`kosmos_refuse_if_machine_claimed` returns 0 (self) for the cut's own gate. Only a
live, unexpired, FOREIGN claim refuses. This is exactly how `run-tests.sh` (the other
gate) avoids self-refusing the cut's own `yarn test`. Fail-open on a broken/absent
claim file; escape hatch `KOSMOS_IGNORE_MACHINE_CLAIM=1`, the same one used everywhere
else the claim guard runs.

## Verification (both arms perturbed, per the card)
- ARM 1 (foreign claim -> REFUSE): forged a live foreign machine-claim in an isolated
  marker dir; browser-checks.sh exits non-zero with "reserved for a release" BEFORE
  booting a board. Red-capable: without the wiring the gate never refuses.
- ARM 2 (no claim -> PROCEED): with no claim, the gate does not refuse and proceeds
  past the guard.
- ARM 2b (escape hatch): foreign claim + KOSMOS_IGNORE_MACHINE_CLAIM=1 -> proceeds.
- Self-exclusion (the cut's own 3b is not refused) is guaranteed by the exported
  cookie and covered at the function level by test-machine-claim-1962.sh.
- New test tools/test-browser-gate-cut-claim-1398.sh (wired into package.json
  test:shell) encodes ARM 1 behaviorally, ARM 2 behaviorally (bounded), and a static
  assertion that the gate uses the cookie-safe function and not the run-marker one.

## Deliberately NOT in scope
- Retiring the social "no gates during a cut" rule: the card says do it deliberately
  once the mechanism exists; that is a coordination/doc change for the owner to make
  after this lands, not a code change here.
- The `test-promote-channel-win` local false-red and this box's chrome-headless-shell
  issue (#3542) are unrelated.

## Weakest premise
That the machine claim is the right mechanism vs a run-marker guard. Rejected the
run-marker guard explicitly because it self-refuses the cut's own 3b (reasoned +
asserted by the static arm of the test). The claim mechanism is proven by
run-tests.sh already using it in production cuts.


## Rebased onto main 868888de0 and reworked after blind review 1 (2026-10-02 00:44): 2 blockers, 5 warnings, 4 nits
- BLOCKER (test): arm 2 started the REAL gate in the background and killed the subshell, not the gate; a real
  page layer ran orphaned on Agent1s 00:38 to 00:46 (found by the reviewer, killed and cleaned by me, Splinter
  told). The test now NEVER boots a gate: every arm is synchronous with Playwright unfindable and
  KOSMOS_SKIP_BROWSER_CHECKS=1 (the test-runner-reexec-1818.sh seam), a sandbox HOME and marker dir, and the
  overrides unset.
- BLOCKER (test): arm 2 asserted an ABSENCE; it now asserts the positive "BROWSER CHECKS SKIPPED" marker printed
  only after the guard; arm 1 asserts exit 75 and that the skip line is absent.
- W: claim overwrite race (a queued-heavy renewer overwriting the cut's claim mid-cut would have made the cut's own
  3b refuse): release.sh passes KOSMOS_IGNORE_MACHINE_CLAIM=1 on both page-layer launches; the cut owns the box.
- W: the matching-cookie and override arms are now tested end to end through the gate; a static arm checks every
  release.sh page-layer launch carries the override.
- W: test-pw-version-assert.sh ignores the claim (it drives a fake runtime), as it already ignored the cut guard.
- W: WAIT, not refuse (consistent with run-tests.sh since #4498): kosmos_wait_until_clear; refusal (at the bound or
  KOSMOS_NO_WAIT=1) exits 75 "did not run", not 1 "a check failed". Any queued-heavy one-off claim makes a hand-run
  gate wait too, deliberately.
- W: the claim can lapse during a step over 30 minutes; the comment says so rather than promising the whole cut
  (a background renewer in release.sh is a possible follow-up).
- Nits: comments corrected (what release.sh asks at its start; "never refuses its own page layer" replaced by the
  real mechanism); the position check anchors on the CALL; the frozen-runner child consults again on purpose
  (stated in the comment).
Tests: test-browser-gate-cut-claim-1398.sh 8/8; 4 sabotages red (no guard, refusal exits 1, cut launch without the
override, override not honoured); test-machine-claim-1962.sh 22/22, test-pw-version-assert.sh, test-cut-parallel-
region.sh green. No gate process or frozen copy left behind after any run (checked each time).
LANDS AFTER 0.7.17 IS SERVED (the 05:15 cut runs browser-checks.sh and release.sh).

---
pre_challenge: true
method: challenge-loop
branch: tunnelgate-4270
diff_hash: 04de2f06c1956037cde079e5660740df93a6da3df91ba506e7ae2301d4966875
validation: passed
subdir_audit: passed (no subdir CLAUDE.md in the diff)
timestamp: 2026-09-28T05:56:45Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (opus and sonnet alternating; 1 to 3 also reviewed the relay half, kosmos-relay #188)
**Converged:** Yes (iteration 8 found 1 NIT, which was fixed)
**Findings on this branch:** 2 BLOCKERs, 10 MAJORs, about 20 MINORs, 5 NITs
**All fixed, or stated in the header's NOT COVERED list** | **Asked:** 0

Validation (validation_log_run_or_skip, stack=typescript) PASSED on this head, and again after a second rebase
onto main e9771873f (#4306: run-tests.sh now fails a suite that leaks temp dirs; the only conflict was the
test:shell line in package.json, resolved as main's line plus this branch's three commands):
type-check, lint, and the full `yarn test` (test-tunnel-handshake-gate 52 passed, 0 failed;
test-staging-channel-2036 ALL PASS; test-staging-wire-2036 36 passed, 0 failed).
**Real run against PRODUCTION on Mortals** (the promote machine, with the identity enrolled there):
candidate 0.7.05, control 0.6.99, PASS (exit 0).

### Per-Iteration Breakdown

#### Iteration 1 - opus - 2 MAJOR, 1 vacuous check, fixed
An outage refused an unforceable promote (outage classed as FAIL); renewed certificates were thrown away
(expiry after 90 days); the leak check could not fail (`exec sleep` hid the name).

#### Iteration 2 - sonnet - 1 MINOR, fixed
A connector started by hand on the enrolled state went unseen.

#### Iteration 3 - opus - 1 BLOCKER, 4 MAJOR, 3 MINOR, 1 NIT: REDESIGN
Four ways an environment problem became FAIL: a 502 during a deploy; backoff timing; identity refusals; a
dropped visit. Each classifier patch would leak again, so fault is now decided by a CONTROL connector (the
served build) plus a retry, not by reading log sentences. Also: renewals kept only from a pass, no connector
is FAIL, a mkdir lock, a 2xx meta probe.

#### Iteration 4 - sonnet - 1 MAJOR, 2 MINOR, 1 NIT, fixed
A flag with no value looped forever; the `--state-dir=` form; a path-like served artifact; the order of
extraction versus preflight.

#### Iteration 5 - opus - 2 MAJOR, 3 MINOR, 1 NIT, fixed
A build with no connector was reported as a (forceable) CANNOT TELL when this machine had no identity, so the
build is now judged FIRST. The control proved the environment only while it ran, so a second control now runs
after a second failure. Also: no-connector decided from the listing; the retry PASS is labelled; a pid-less
lock; flag order. Found by a mutant that stayed green: two test rows passed their overrides BEFORE the
harness's defaults, so they had tested the defaults. Fixed; both ordering mutants now red.

#### Iteration 6 - sonnet - 2 MAJOR, fixed
The second control's renewal was dropped on a FAIL; a takeover lock left by a killed gate held forever. Found
while testing: a child killed before its exec runs the parent's EXIT trap, which deleted the test's own temp
dir. The connector now launches as `( trap - EXIT; exec ... ) &`.

#### Iteration 7 - opus - 1 MAJOR (a false PASS), 5 MINOR, 2 NIT, fixed
A build that breaks renewal passed on the retry, because the first control's renewal was kept before the
retry. It is now held until the verdict, and a row reproduces the false PASS under the mutant. Also: the stale
check is keyed on identity; a non-regular connector is FAIL; setup failure is CANNOT TELL; RUST_LOG pinned;
the exact tarball asserted. Rollout: the identity was enrolled on Mortals before merge.

#### Iteration 8 - sonnet - 1 NIT, fixed
The `--timeout` wording (the visit has its own 20 s). No BLOCKER or MAJOR, and the NOT COVERED list was judged
honest.

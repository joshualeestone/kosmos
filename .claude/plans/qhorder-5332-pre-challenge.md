---
pre_challenge: true
method: challenge-loop
branch: qhorder-5332
diff_hash: 8e5b4beffe3b8f148bcf02248945f1d43464e66a0a8f1f06ebdd37af07bf6448
subdir_audit: passed
timestamp: 2026-10-06T16:27:29Z
iterations: 5
converged: true
validation: passed (Mortals, hash 8e5b4beffe3b, 11:25 CDT 2026-10-06)
---

## Challenge loop: 5 blind rounds, reviewers alternating Sonnet, Opus, Sonnet, Opus, Sonnet

Each round was a fresh reviewer on origin/main...HEAD. Fixes per round are taken from the commit that
addressed it; per-round severity counts were not kept.

#### Iteration 1 (Sonnet), fixed in fb0c49dcd
- [BLOCKER] The order check under the take lock ran for a run holding no marker (a first-pass clear, or a lib
  older than #5332), which read every waiter as ahead and lost every take. It now runs only while this run holds a marker.
- [CONVENTION] Two comments corrected (the QH_JOINED history; why the main lane needs no backoff).
- [WARNING] KOSMOS_WAIT_KEEP_MARK joins the lib's KOSMOS_WAIT_CONTROL_VARS, so the lib owns its control var.
- [NIT] The export's comment says what reads it. Plan file added.

#### Iteration 2 (Opus), fixed in ec7638f5d
- [WARNING] run-tests.sh unsets KOSMOS_WAIT_KEEP_MARK before its own wait (a leaked one kept the suite marker all run).
- [WARNING] The re-mark's comment says what it does and what it cannot (a later joiner can pass in the gap).
- [NIT] The lost-take line and its arm reworded. _qh_need lists the marker functions; the exec path unsets the QH_TEST_ seams.
- Plan: the order check under the lock is reachable (stated), and deployment needs the installed wrapper and lib.

#### Iteration 3 (Sonnet), fixed in 97692bb94
- [WARNING] The re-mark runs only when this run's marker is gone.
- [WARNING] Its comment now states what was measured (red in one of two runs, a race), not "red".
- [WARNING] The #5064 arm no longer matches the re-mark message, which proved nothing.
- Plan: run-tests.sh's unset is stated as unarmed.

#### Iteration 4 (Opus), fixed in 409e6e7e0
- [WARNING] The keep-only arm asserts its re-mark deletion landed; the main #5064 arm asserts the re-mark never fired.
- [CONVENTION] _qh_need lists two more lib functions; kosmos_wait_until_clear's header documents the KEEP_MARK contract.

#### Iteration 5 (Sonnet), fixed in f6ca44059
- [NIT] only: wording accuracy and a re-wrap. No BLOCKER, WARNING or CONVENTION, so the loop converged here.

### Final Ledger
- Tests after every round: test-cut-guard.sh 0 failures; test-queued-heavy-4977.sh 87 OK, run twice.
- Perturbations: removing the kept marker, the unmark-after-take and the lib's keep each turn an arm red. Removing the
  order check under the lock is NOT caught (decided in the plan: an arm would need a join inside one poll's gap).
- Merged with origin/main at a1ca3858a after round 5. None of the 69 commits since the merge base touch the five files,
  so the reviewed diff is unchanged; this hash equals the hash Mortals validated.

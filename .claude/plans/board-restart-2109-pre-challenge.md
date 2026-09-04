---
pre_challenge: true
method: challenge-loop
branch: board-restart-2109
diff_hash: 417b9a4707c01d8022449c72a3c74c9e26672afb6d0b3269d3a8797bd22434d6
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T04:23:28Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 surfaced zero new BLOCKER/WARNING/CONVENTION)
**Total findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Fixed:** 2 WARNINGs + 3 NITs | **Deferred:** 1 NIT (documented residual) | **Asked:** 0

#2109: `tools/release.sh` step 10 restarts the developer's LOCAL board and false-failed
BOTH cuts tonight (0.6.27, 0.6.28) when the board came back at ~121s under fleet load,
just past the 120s deadline -- failing a cut whose bytes had already served and verified
at steps 8-9. The fix classifies a deadline miss by CAUSE (the board runs from this repo,
so a restart returns the code on disk): still SERVING A DIFFERENT version = stale (#360)
-> exit 1; NOT ANSWERING = down/restarting -> WARNING, exit 0. The safety-critical half
is not weakening the #360 catch, which the loop hardened over two rounds.

### Per-Iteration Breakdown

#### Iteration 1 - 1 WARNING, 2 NITs
- [WARNING] the stale-vs-silent classification rested on a single short-timeout poll; under
  load that poll can time out against a board that is UP but slow, INCLUDING a stale one,
  misclassifying #360 as silent (warn) and shipping stale code silently --> FIXED: a PATIENT
  (10s) final poll before deciding "not answering"; board_version takes an optional timeout.
  Red-capable slow-stale arm added (4s-delay stub).
- [NIT] board_version folds not-answering / timeout / non-JSON / versionless-JSON into empty
  --> noted (versionless status JSON is not produced in practice).
- [NIT] the silent warning did not mention crash-looping new code --> FIXED (message names it).

#### Iteration 2 - 1 WARNING, 1 NIT
- [WARNING] the #360 catch then hinged on a SINGLE patient sample; a transient failure on
  that one poll would bias toward the unsafe (warn/exit 0) direction for a stale board -->
  FIXED: THREE patient retries (a stale board answers at least one; only a board failing all
  three is treated as down; a truly-down board is refused instantly, so the retries cost time
  only against a listening-but-pathologically-slow board). 10s documented as the deliberate
  ceiling. Red-capable transient-failure-stale arm (stub 503s the first 2 requests, WAIT_SECS=0
  pins one in-loop poll, so a later patient retry catches the stale version).
- [NIT] two stale doc blocks still said "failure -> exit 1" without the #2109 split --> FIXED.

#### Iteration 3 - CONVERGED
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
- [NIT] documented residual: a stale board so slow it fails ALL THREE 10s patient polls falls
  through to warn --> DEFERRED. The reviewer stated it is "not a defect to fix": narrow (a
  stale board is a normally-running node process with a fast status endpoint; the
  pathologically-slow case is the RESTARTING board, not the stale one), and the code already
  owns 10s as a deliberate per-poll ceiling. Widening it only delays a doomed cut.
Four STRENGTHs confirmed: the safety argument holds in the REAL path (after launchctl stop the
old process is dead, so the board is DOWN or UP-on-new-code; UP-serving-OLD only if launchd never
restarted = #360), set -e/pipefail careful, the slow-but-healthy regression genuinely closed, and
21 red-capable test arms.

### Outstanding questions (ASKED)
None.

### Deferred
- The pathologically-slow-stale residual (iter 3) -- documented deliberate 10s ceiling; the
  reviewer confirmed it is not a defect to fix.

### Strengths (across iterations)
- Classifies a deadline miss by CAUSE rather than widening the deadline again (which only moves
  the cliff): stale (serving a different version) reds, silent (not answering) warns.
- The #360 stale catch is preserved and independently re-proven each round (stale arm exit 1,
  divergence arm asserts stale and silent do not collapse).
- set -euo pipefail handled deliberately: `wait_for_want || rc=$?`, `board_version ... || true`,
  `exit` at top-level call sites, `[ -n ] && break` errexit-safe. bash 3.2 (macOS /bin/bash).
- Every fix carries a red-capable test arm, each proven to red under the specific regression it
  targets (dropping the patient poll; dropping the 3-retry loop; collapsing stale/silent).

### Validation
`bash tools/test-restart-local-board.sh` -- 21 assertions, ALL PASS on /bin/bash 3.2.57 (~35s,
includes a slow-flip arm and a slow-stale arm). Already wired into package.json test:shell.
Branch rebased onto origin/main (clean) before this proof. No release.sh change (step 10 keeps
calling with 120s; the warn-vs-fail decision is now internal to restart-local-board.sh).

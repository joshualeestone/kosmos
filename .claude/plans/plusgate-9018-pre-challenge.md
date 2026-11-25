---
pre_challenge: true
method: challenge-loop
branch: plusgate-9018
diff_hash: 2ffb68a7d14db321a973545a74154c6df08741d1119b12a16451adf5ba3fd377
validation: passed (Mortals)
subdir_audit: passed
timestamp: 2026-11-25T08:51:07Z
iterations: 9
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9
**Converged:** No. Stopped under a standing rule from outside the loop, after iteration 9. The rule is Splinter's
(2026-10-22, restated in fleetbuilders m510 2026-10-26 16:07): "A review loop stops at 8 rounds unless a BLOCKER is
still open. Past 8, WARNINGs go to a follow-up card, not another round." Round 8 raised no BLOCKER. Iteration 9 ran
because a BLOCKER-class defect was found on a real run after round 8 (below), and it reviewed that fix. Its findings
were fixed and mutant-proved. The remaining WARNINGs and NITs are on follow-up card kosmos#9026.
**Total findings:** 1 BLOCKER-class (found live), 21 WARNINGs, 3 CONVENTIONs (the plan file present), 20+ NITs
**Fixed:** every BLOCKER and WARNING raised in rounds 1 to 7 and in round 9 | **Deferred:** 3 (below) | **Carried to #9026:** round 8 WARNINGs, round 9 NITs | **Asked:** 0

Validation: full suite on Mortals via mortals-validate.sh, entry `"status":"clean"`, hash 2ffb68a7d14d (equal to this
proof's diff_hash), 31,052 tests, 0 failed, at head 787899d9f1, 02:21 to 02:49 CST. An earlier local run at
139eb30e85 failed only on the #8195 pipefail ratchet. That was fixed in 787899d9f1, and this run is the one that
counts. The subdir CLAUDE.md audit passed.

Live proof, beyond the suite: the driver ran end to end on the real 0.8.21 staging build several times on 11-24, and
the gate said PASS (the first ever) at 18:13.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus. **New:** 0 BLOCKERs, 3 WARNINGs, 6 NITs. **Self-generated:** 0
- [WARNING] plus-signin-auto.sh - the tunnel connector outlives the board, so the teardown did not reach it --> FIXED (the sweep stops every process under the work folder)
- [WARNING] plus-signin-auto.sh - progress file left after an unfinished run read as an attempt in flight --> FIXED
- [WARNING] the gate's pass line did not say the board was sandboxed --> FIXED (board_kind printed)

#### Iteration 2
**Reviewer model:** sonnet. **New:** 0 BLOCKERs, 3 WARNINGs, 3 NITs. **Self-generated:** 1
- [WARNING] the board got the real HOME --> FIXED (HOME in the work folder)
- [WARNING] STARTED was set before start --> FIXED
- [NIT, real bug] a flag with no value looped forever --> FIXED
- [WARNING] the sweep could reach the script's own children --> DEFERRED: cleanup runs only at exit, after every foreground child; the work folder is a fresh mktemp

#### Iteration 3
**Reviewer model:** opus. **New:** 0 BLOCKERs, 4 WARNINGs, 5 NITs. **Self-generated:** 2
- [WARNING] a hand-run sandboxed record proved no bytes --> FIXED (KOSMOS_PLUS_VERIFIED_SHA256)
- [WARNING] the progress file was removed without checking whose it was --> FIXED
- [WARNING] a signal between start writing progress and STARTED=1 --> FIXED
- [WARNING] the secrets-map path was untested --> FIXED, with a test

#### Iteration 4
**Reviewer model:** sonnet. **New:** 0 BLOCKERs, 1 WARNING, 2 NITs. **Self-generated:** 0
- [WARNING] the TOTP secret was exported to every child --> FIXED (given only to finish)
- [WARNING] the env var is forgeable --> DEFERRED: whoever can set it can write the record by hand; the limit is in the plan

#### Iteration 5
**Reviewer model:** opus. **New:** 0 BLOCKERs, 2 WARNINGs, 4 NITs. **Self-generated:** 1
- [WARNING] on a Mac's real TMPDIR (a symlinked /var with a trailing slash) the sweep matched nothing --> FIXED (pwd -P; the tests now use such a TMPDIR)
- [WARNING] two runs for one build took over each other's progress --> FIXED (refuse while one is in flight)

#### Iteration 6
**Reviewer model:** sonnet. **New:** 0 BLOCKERs, 2 WARNINGs, 3 NITs. **Self-generated:** 0
- [WARNING] the work folder leaked on a die before the trap was set --> FIXED
- [WARNING] an empty secret target gave the wrong message --> FIXED

#### Iteration 7
**Reviewer model:** opus. **New:** 0 BLOCKERs, 2 WARNINGs, 4 NITs. **Self-generated:** 0
- [WARNING] the board's TMPDIR was outside the work folder --> FIXED
- [WARNING] nothing checked that the port was answered by the board this run booted --> FIXED (the listener's pid)

#### Iteration 8
**Reviewer model:** sonnet. **New:** 0 BLOCKERs, 3 WARNINGs, 2 NITs. **Self-generated:** 1
- The listener check needs a single listener, a seed starting with '-', and the forgeable env var --> two NITs fixed; the rest carried to kosmos#9026 under the 8-round rule

#### Found on a real run after round 8 (BLOCKER-class)
- A register refused by the certificate authority's rate limit (HTTP 429 on /v1/mac/cert) became a FAIL record, which refuses the promote with no override --> FIXED: setup (exit 2), only once the forget has passed

#### Iteration 9 (reviewing that fix)
**Reviewer model:** opus. **New:** 0 BLOCKERs, 3 WARNINGs, 3 NITs. **Self-generated:** 1
- [WARNING] the rate-limited path left the progress file, which hid the earlier pass --> FIXED, the gate is now run in the test
- [WARNING] the build's own text decides the classification --> stated in the plan
- [WARNING] the board is open to local processes while it runs --> stated in the plan
- NITs --> carried to kosmos#9026

### Final Ledger (BLOCKER and WARNING)

| # | Iter | Category | Origin | Description | Status |
|---|------|----------|--------|-------------|--------|
| 1 | 1 | WARNING | BRANCH | the connector outlives the board | FIXED |
| 2 | 1 | WARNING | BRANCH | progress file left after an unfinished run | FIXED |
| 3 | 2 | WARNING | BRANCH | the board got the real HOME | FIXED |
| 4 | 3 | WARNING | BRANCH | a sandboxed record tied to no checked bytes | FIXED |
| 5 | 4 | WARNING | BRANCH | the secret exported to every child | FIXED |
| 6 | 5 | WARNING | BRANCH | the sweep matched nothing on a Mac's real TMPDIR | FIXED |
| 7 | 7 | WARNING | BRANCH | port answered by another process | FIXED |
| 8 | live | BLOCKER | BRANCH | a CA rate limit recorded as an unforceable FAIL | FIXED |
| 9 | 9 | WARNING | SELF | rate-limited path left the progress file | FIXED |

### Deferred (with reasoning)
- The sweep reaching the script's own children (iteration 2): it runs only at exit, after every foreground child.
- The forgeable KOSMOS_PLUS_VERIFIED_SHA256 (iterations 4, 8): anyone who can set it can write the record by hand.
- Linux losing the stall-refusal note: belongs to the What's New branch, not this one.

### Strengths
- The seed guard runs before any network, board or mail call, with a mixed-case control that passes it.
- The board is fully sandboxed: env -i, every data root, HOME, TMPDIR and tmux in the work folder, auto-update and the agent browser off.
- Every guard was mutated out once, and its test arm went red.

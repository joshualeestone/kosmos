---
pre_challenge: true
method: challenge-loop
branch: connverbs-4678
diff_hash: be89ed5501c2a8c08d776be755b843b446484288944998d871bd8294548a462d
validation: targeted (tools/test-connector-verbs.sh 27/27, alone and under nice -n 20 on a loaded box; bash -n). It is run by npm run test:shell. No gated full-suite run: a single test script, and Liu Kang set light runs only (m3840). GitHub CI authoritative.
subdir_audit: passed
timestamp: 2026-09-30T02:49:24Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (round 5: nothing above NIT)
**Total findings:** 22 (1 BLOCKER, 6 WARNINGs, 1 CONVENTION, 14 NITs)
**Fixed:** 20 | **Kept, with reason:** 2 (round 5 NITs, below) | **Asked:** 0

NOT REPRODUCED HERE: 10 runs of main's test were green (load 7-8, and under nice -n 20). This fixes a stall reported on #4678
that could not be triggered here, and it is tested with stand-ins that hang while a test-made marker exists.

PM conditions (Liu Kang, m3843): ONE rerun at most, only on the timeout sentence, printed and counted. Two timeouts still
fail. A stand-in that really hangs every time goes red: shown for the good connector (3 FAIL), crash and exit 2 (3 FAIL),
exit 142 and the bare probe (2 FAIL).

#### Iteration 1 (opus) at 22f0d23bf: 1 BLOCKER, 2 WARNING, 1 CONVENTION, 3 NIT, all fixed at 2fb97756e
- [BLOCKER] the new rerun arms depended on scheduling themselves (a marker the stand-in wrote, a 1 s bound on the rerun). Fixed: the test makes the marker, the stand-in hangs while it exists, it is cleared before the one rerun.
- [WARNING] nothing checked a rerun happened, or only once. Fixed: exact-one-rerun assertions.
- [WARNING] the child-hang arm reran on any missing pid. Fixed: only on the timeout sentence.
- [CONVENTION] comments called the always-slow control "slow-first-run". Fixed.
- [NIT] took<60 passed a bound armed far too long. Fixed: sleep 300 and took<30.
- [NIT] leftover-child kill could double count and was not ps-checked. Fixed.
- [NIT] the timeout match was not tied to the check's wording. Fixed.

#### Iteration 2 (sonnet) at 2fb97756e: 0 BLOCKER, 1 WARNING, 2 NIT, fixed at eb0a67fd2
- [WARNING] the plain child-hang arm kept a 2 s bound. Fixed: 5 s (HANG covers 2 s).
- [NIT] "catches a bound armed ten times too long" overclaimed. Fixed.
- [NIT] the card's report was worded as a measurement here. Fixed.

#### Iteration 3 (fable) at eb0a67fd2: 0 BLOCKER, 1 WARNING, 3 NIT, fixed at 2c90f2c82
- [WARNING] two reason arms passed on a DOUBLE timeout. Fixed: each names its own reason and rejects the timeout sentence.
- [NIT] the match could be started by a connector's stderr. Fixed: the check's own framing.
- [NIT] the RETRY line asserted a cause it cannot know. Fixed.
- [NIT] the summary hard-coded 3 deliberate reruns. Fixed: ON_PURPOSE.

#### Iteration 4 (opus) at 2c90f2c82: 0 BLOCKER, 2 WARNING, 2 NIT, fixed at e1fd21f9d
- [WARNING] the exit-142 and bare set -e probe arms had no rerun. Fixed: same one rerun on the probe's whole timeout answer.
- [WARNING] kill -0 ran moments after the group kill. Fixed: polls up to 5 s.
- [NIT] no INT/TERM trap. Fixed.
- [NIT] RETRY did not name the gate file. Fixed.

#### Iteration 5 (sonnet) at e1fd21f9d: 0 BLOCKER, 0 WARNING, 0 CONVENTION, 2 NIT -> converged; both kept
- [NIT] an interrupt mid-arm can leave a sleep 300 for 5 minutes (the library's perl has no INT handler). Kept: not this card.
- [NIT] the errexit "|| branch" arm cannot tell a right refusal from a wrong one. Kept: predates this change, not load-sensitive.

Controls shown red, each restored and cmp-checked: good connector hanging every time; no rerun; rerun that never clears the
marker; two reruns; library bound 25x too long (hang arm 50 s); crash and exit 2 hanging on both tries; exit 142 and bare probe hanging.

---
pre_challenge: true
method: challenge-loop
branch: connverbs-4678
diff_hash: 7fe57242518b46db11a241378f769b4fb789b20210aed866ab7d0fb34c99ef8c
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

- R1 (opus) 1B 2W 1C 3N: rerun arms depended on scheduling -> test-made marker cleared before the rerun; exact-one-rerun asserts; child arm reruns only on timeout; sleep 300 + took<30; ps-checked kill; anchored match; comments.
- R2 (sonnet) 0B 1W 2N: plain child-hang arm 5 s bound; two comments no longer overclaim.
- R3 (fable) 0B 1W 3N: two reason arms passed on a DOUBLE timeout -> each names its own reason; match on the check's framing; RETRY wording; ON_PURPOSE count.
- R4 (opus) 0B 2W 2N: probe-direct arms (exit 142, bare set -e) get the same one rerun; kill -0 polls 5 s; INT/TERM trap; RETRY names the gate file.
- R5 (sonnet) 0B 0W 2N, kept: (1) an interrupt mid-arm can leave a sleep 300 for 5 minutes (the library's perl has no INT handler; not this card); (2) the errexit "|| branch" arm cannot tell a right refusal from a wrong one (predates this change, not load-sensitive).

Controls shown red, each restored and cmp-checked: good connector hanging every time; no rerun; rerun that never clears the
marker; two reruns; library bound 25x too long (hang arm 50 s); crash and exit 2 hanging on both tries; exit 142 and bare probe hanging.

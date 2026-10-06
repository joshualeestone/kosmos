---
pre_challenge: true
method: challenge-loop
branch: feedbacksend-5294
diff_hash: ae05f667c0991fd4af449eb0d9fcb279b16f1a5ceec655e6885e5b1e0a51e48a
validation: passed
subdir_audit: passed
timestamp: 2026-10-06T03:38:26Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (opus, sonnet, opus, sonnet; all blind)
**Converged:** Yes (iteration 4: no BLOCKER, WARNING or CONVENTION)
**Total findings:** 0 BLOCKER, 15 WARNING (15 fixed), 0 CONVENTION, NITs
**Fixed:** 15 | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation:
- A first full run at 8b9585ce8 failed 2 of 15389, both mine, fixed at b32c7a6ed: an unclassified #1732
  fs-root-literal (sandboxed()'s fixed POSIX temp roots, now classified posix-root-fallback) and a #3628 exit code
  defaulted to a number in the new Windows test (it now rejects with the signal).
- Full validation on Mortals at b32c7a6ed: 15389 tests, 0 fail, 0 cancelled, ENTRY status clean (a real run).

### Per-Iteration Breakdown

#### Iteration 1 (opus, blind, at 6732ffd94)
- [WARNING] the failed and later sentences promised retry timing the board cannot keep --> FIXED
- [WARNING] 'later' claimed a delivery that had failed --> FIXED
- [WARNING] 'sent' over-claimed what the scrub removes --> FIXED
- [WARNING] CLI tests run without node --test could POST to the real collector --> FIXED
- [WARNING] (the fifth, same family) --> FIXED at 754cb8eb5
- [NIT] gate-order comment, unreadable setting read as off, redirect under test --> FIXED; a send race --> accepted

#### Iteration 2 (sonnet, blind, at 754cb8eb5)
- [WARNING] other CLI harnesses could still POST --> FIXED: engine-level sandboxed() (runner OR a temp data root)
- [WARNING] a POST storm once the floor was removed --> FIXED: a 60 s retry floor ('soon')
- [WARNING] an abort or timeout said 'has not reached them' --> FIXED: 'could not confirm'
- [WARNING] (the fourth) --> FIXED at 62dfabba6

#### Iteration 3 (opus, blind, at 62dfabba6)
- [WARNING] os.tmpdir() follows the caller's TMPDIR --> FIXED: fixed temp roots
- [WARNING] a non-3 exit read as saved --> FIXED: a SAVED sentinel
- [WARNING] the blocked arm aimed at the real collector --> FIXED: .invalid
- [WARNING] no pin that a real root is NOT sandboxed --> FIXED: a child-process test
- [WARNING] 'soon' claimed a failure while in flight --> FIXED: 'not confirmed yet'
- [WARNING] a stale LOCAL ONLY comment --> FIXED at 8b9585ce8

#### Iteration 4 (sonnet, blind, at 8b9585ce8)
- No BLOCKER, WARNING or CONVENTION.
- [NIT] a legacy pre-hash marker gives one duplicate send --> accepted
- [NIT] a symlink out of a temp folder is not sandboxed --> accepted (harnesses use a dead loopback)

## Merging onto newer main without a re-run (Splinter's 19:29 ruling)
1. Merge-tree of b32c7a6ed onto current main (220 commits ahead): 0 conflicts.
2. Overlap: main changed four files this PR touches (install/kosmos, tools/windows/kosmos-cli.js,
   cli.feedback-2037.test.js, engine/windows-coupling-audit-1732.test.js). None of main's lines in them names feedback,
   feedbacksend, sandboxed, writeMessage or SAVED: main added inventory rows for other files (server.js,
   engine/filepreview.js) and a temp-cleanup require (#5334) at the top of the CLI test.
3. The run was real: status clean, 15389 tests, 0 fail.
4. Backstop: the 0.7.25 cut's own full suite. If it goes red here, I revert first.

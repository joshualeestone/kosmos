---
pre_challenge: true
method: challenge-loop
branch: sitekick-6266
diff_hash: bed8934a2258da3a427f7cd82098b1bea9b287ad205d3079314005c1e4d1e17f
validation: tools.site-deploy-kick-6266.test.js 18/18 (fake gh checks exact argv and runs the script's own --jq through real jq); bash -n on both scripts; the repo-wide guards (all-node-tests-considered, comment-deferral, windows-tests-1777, fixture-discipline, web.machine-absence-claims, shell-shard, every-test-runs, install.reachable) pass, run alone from the repo root after rebasing onto main. Measured against the real gh on Agent1s: the wall clock cuts off a hung call (GH_HOST=10.255.255.1, limit 3 s) in 5 s. CI on the PR is the merge gate.
subdir_audit: passed
timestamp: 2026-10-16T00:02:33Z
iterations: 21
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 21
**Converged:** Yes (iteration 21: no BLOCKER, WARNING or CONVENTION; cosmetic nits only)
**Total actionable findings:** 5 BLOCKERs, about 45 WARNINGs, 4 CONVENTIONs (plus NITs)
**Fixed:** all but the stated limits | **Deferred (decided):** see below | **Asked:** 0

Reviewer models alternated opus and sonnet. Each guard was mutated out at least once and its test went red.

#### Iteration 1
**Reviewer model:** opus
- [WARNING] dispatch minutes after a failed run spent the job's retry --> FIXED (14-minute gap)
- [WARNING] the fake gh ignored --jq --> FIXED (exact argv, real jq)
- [WARNING] a stuck queued run silenced it --> FIXED (stuck runs said, not waited on)
- [WARNING] nothing proved it runs under launchd --> FIXED (heartbeat, --check)

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] gh's own error thrown away --> FIXED; [WARNING] zombie run silenced the backstop --> FIXED; [WARNING] the gap trusted gh's order --> FIXED; [WARNING] desktop-session requirement unstated --> FIXED

#### Iteration 3
**Reviewer model:** opus
- [WARNING] gap from creation, not end --> FIXED; [WARNING] stuck counted queue time --> FIXED; [WARNING] garbled-time case parsed on GNU date --> FIXED; [WARNING] cp && chmod && mv under set -e --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] startedAt is stamped at creation (MEASURED on 16 runs) --> FIXED (one limit from creation); [WARNING] "never an extra tick" overclaimed --> FIXED; [WARNING] cost during a cut --> DEFERRED (stated)

#### Iteration 5
**Reviewer model:** opus
- [WARNING] plan overclaimed what the heartbeat proves --> FIXED; [WARNING] failed open with no state folder --> FIXED (fails closed)

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] gap from every run's update left a minute of slack --> FIXED (only a failed run's end counts); [WARNING] no visible failure signal --> FIXED (last-result)

#### Iteration 7
**Reviewer model:** opus
- [BLOCKER] gh returns "" (not null) for an unfinished conclusion, shifting every field --> FIXED (tab-separated, "-")
- [BLOCKER] test data hid it with null --> FIXED (matches gh; the old parse turns 3 tests red)
- [WARNING] subshell reason lost from last-result --> FIXED; [WARNING] stuck reason overwritten --> FIXED; [WARNING] 20-run window --> FIXED (commented)

#### Iteration 8
**Reviewer model:** sonnet
- [WARNING] schedule overlap, lost login, live behind main --> DEFERRED (stated in the header)

#### Iteration 9
**Reviewer model:** opus
- [WARNING] the header promised more than the gap does --> FIXED (narrowed)

#### Iteration 10
**Reviewer model:** sonnet
- [WARNING] GNU date -d fallback tried on macOS --> FIXED; [WARNING] 15 to 30 minutes, not 15 --> FIXED; [WARNING] stuck line without its age --> FIXED

#### Iteration 11
**Reviewer model:** opus
- [WARNING] no gh call had a time limit --> FIXED (perl wall clock)

#### Iteration 12
**Reviewer model:** sonnet
- [BLOCKER] Go ignores SIGALRM, so alarm+exec never stopped gh (MEASURED) --> FIXED (fork and kill)
- [WARNING] the hung test only passed because the fake was bash --> FIXED (fake ignores ALRM)

#### Iteration 13
**Reviewer model:** opus
- [WARNING] gh in its own group escaped launchd and Ctrl-C --> FIXED (signals passed on; later revised)

#### Iteration 14
**Reviewer model:** sonnet
- [WARNING] no-gh test depended on PATH --> FIXED; [CONVENTION] "review N" tags in comments --> FIXED

#### Iteration 15
**Reviewer model:** opus
- [WARNING] launchd's forced cleanup could orphan gh in its own group --> FIXED (gh stays in the tick's group; SIGKILL test); [WARNING] source-commit test could not fail --> FIXED

#### Iteration 16
**Reviewer model:** sonnet
- [WARNING] the TERM hand-off was untested --> FIXED (TERM to the wrapper alone)

#### Iteration 17
**Reviewer model:** opus
- [WARNING] a re-run keeps its createdAt and was called stuck at once --> FIXED (the later of created and started)

#### Iteration 18
**Reviewer model:** sonnet
- [WARNING] re-run rule untested for a finished run --> FIXED; [WARNING] rc 143 unexplained --> FIXED

#### Iteration 19
**Reviewer model:** opus
- [CONVENTION] stale fixture comment --> FIXED

#### Iteration 20
**Reviewer model:** sonnet
- [WARNING] an unexplained 92 s test hang --> DEFERRED (not reproduced in 33 runs; the wall clock ended it as designed; kept on #6266 until the Mortals install is seen working)
- [WARNING] failed-mktemp path untested --> FIXED; [WARNING] garbled startedAt untested --> FIXED

#### Iteration 21
**Reviewer model:** opus
- No BLOCKER, WARNING or CONVENTION: CONVERGED.

### Deferred, with reasons (stated in the script header and the plan)
- GitHub's own schedule and push runs still fire, so two runs can land minutes apart (rare, as the schedule is).
- A lost gh login fails every tick, seen in kick.log, last-result and launchctl's last exit code; push and schedule runs keep working.
- Live gone back to an older commit while main is unchanged is left to the job's schedule run.
- A run waiting near 3 hours behind CI is called stuck; a run cancelled at the 45-minute timeout counts from creation (unconfirmed).
- The source record's -dirty mark covers only the script; plist values are not XML-escaped (plain paths on Mortals).

### Rebase before merge
- Main moved 4 commits after CI and one also edited package.json's test:shell line, so the rebase conflicted
  there. Resolved by taking main's line and inserting this branch's two `bash -n` entries (checked: the line differs
  from main by exactly that insertion). The code under review is unchanged; the diff hash is recomputed for it.
  Re-run after the rebase: the 18 tests and the package.json readers (shell-shard, every-test-runs, install.reachable,
  install.local-board) plus the guards, all pass.

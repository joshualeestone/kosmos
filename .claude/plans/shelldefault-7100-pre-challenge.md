---
pre_challenge: true
method: challenge-loop
branch: shelldefault-7100
diff_hash: 62612c75b73d1516f349eb0fea1cb78e02082e06fc8b4b9c2158ffc20bd86aa0
validation: passed (local full suite on Agent1s, final head 7ab6c0eceb, KOSMOS_SHELL_PARALLEL unset so the new default ran; node 23,934 tests 0 failed; shell part as 4 shards in 648 s, 290 of 290; 2026-10-25 13:20 CDT)
subdir_audit: passed
timestamp: 2026-10-25T18:21:44Z
iterations: 12
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 12
**Converged:** Yes, at iteration 12. The loop first converged at iteration 6. The closing validation on Mortals was then stopped for the 0.7.67 cut, and stopping it showed that shards outlive a KILL to their runner. That synthetic BLOCKER reopened the loop at iteration 7.
**Total findings:** 22 actionable (1 BLOCKER, 20 WARNINGs, 1 CONVENTION), plus duplicates of earlier findings and NITs
**Fixed:** 17 | **Deferred:** 5 | **Asked (awaiting user):** 0

Reviewer models alternated opus and sonnet: opus for iterations 1, 3, 5, 7, 9 and 11, sonnet for 2, 4, 6, 8, 10 and 12.
The baseline for 6.0 was the full suite on 83a3c146 on Mortals with the default in force (experiment e): rc 0,
node 23,934 tests and 0 failed, shell part as 4 shards in 738 s.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/test-shell-parallel-7100.sh:238 - nothing checked the default end to end; the exact-line tripwire would red on an equivalent rewrite and stay green if the value were overwritten --> FIXED (f2b1fd77: arm 9 runs the real run-tests.sh with a stub node; the old :-1 default reds it)
- [WARNING] tools/run-tests.sh:169 - the "never inherit it" comment implied nested runs were insulated from the default --> FIXED (f2b1fd77)
- [NIT] tools/lib/shell-parallel.sh - the default's block split another function's header --> FIXED (moved)
- [NIT] tools/run-tests.sh:149 - "2 to 8" against "1 to 8" elsewhere --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/run-tests.sh:150 - the library now loads unconditionally, so a fixture copying run-tests.sh without it exits 1 --> DEFERRED: test-locale.sh already hard-requires its library the same way on every run; the only copies (test-cut-guard RT, RT2 and RT3) copy lib/*.sh
- [WARNING] tools/run-tests.sh:150 - empty used to mean 1 and now meant 4 --> FIXED (6e1c61b4: only an unset switch takes the default)
- [WARNING] tools/release.sh:797 - the export tripwire could not see a dead branch or a later unset --> FIXED (6e1c61b4)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (a code line, fixed normally)
- [WARNING] tools/test-shell-parallel-7100.sh:249 - arm 9 required rc 0, which tied it to the end-of-run gates --> FIXED (a8701430: judged on the shard calls alone)
- [NIT] plan premise broader than the tree; arm 10 blind to env -i; header omitted cases --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/lib/shell-parallel.sh:103 - CI=true was not checked --> FIXED (313c4f0f)
- [WARNING] tools/run-tests.sh:174 - nested runs got the default, and the evidence was only a search --> DEFERRED: the plan's named premise, measured by experiment e (full suite, default in force, green)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 3 of the above (2 code lines, fixed normally; 1 plan line)
- [WARNING] tools/test-shell-parallel-7100.sh:250 - arm 9's nested runs start from the real tree, not a kt sandbox --> DEFERRED: about a second each with a stub node, so the worst case is another agent's queue asking again; stated by the arm
- [WARNING] tools/lib/shell-parallel.sh:103 - CI=yes or CI=TRUE would still get 4 --> FIXED (a9245de8: any non-empty CI except false or 0, in any case)
- [CONVENTION] .claude/plans/shelldefault-7100.md:16 - the plan's Change section did not match the code --> FIXED (a9245de8)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 2 (nested runs, a duplicate of iteration 4; CI detection gaps, a duplicate of iterations 4 and 5)
**Converged (first time).** The closing validation went to Mortals.

#### 6j, first attempt (synthetic)
- [BLOCKER] tools/lib/shell-parallel.sh:24 - final-validation: Baron's 0.7.67 cut claimed Mortals mid-run, and stopping the run with stop-mortals-validate.sh left shards 2 to 4 running beside the cut. Each shard led its own group, and a KILL to the runner runs no trap. With the default at 4, every tool that stops a run by its group would hit this --> FIXED (4168ddda: each shard runs under a perl supervisor that watches its runner; arm 4f)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above (code lines, fixed normally)
- [WARNING] tools/lib/shell-parallel.sh:21 - the supervisor read its runner with getppid after it had started --> FIXED (e88b34f9: the shell passes its own pid in; arm 4h)
- [WARNING] tools/lib/shell-parallel.sh:19 - a TERM to a supervisor's own pid orphaned its command --> FIXED (e88b34f9: the TERM is passed on to the group; arm 4g)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 3 of the above (code lines, fixed normally)
**Duplicates of prior findings:** 1 (nested runs)
- [WARNING] tools/test-shell-parallel-7100.sh:128 - arm 4h could pass vacuously --> FIXED (a96c3996; the first fix was also vacuous, which a mutant caught)
- [WARNING] tools/lib/shell-parallel.sh - an unreachable exit after the group KILL --> FIXED (a96c3996)
- [WARNING] tools/lib/shell-parallel.sh - a passed TERM had no KILL escalation --> FIXED (a96c3996: arm 4i)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (a code line, fixed normally)
- [WARNING] tools/lib/shell-parallel.sh:19 - after a passed TERM, the supervisor exited with its command and left descendants that ignore TERM alive --> FIXED (78d3cf0f: it waits for its whole group, then KILLs it; arm 4j)
- [NIT] whole-second time; handlers installed after the fork; job-status noise in the test output --> FIXED

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/run-tests.sh:174 - nested runs take the default (raised again, with a structural fix) --> FIXED (76f69c2b: export 1 to what the run starts; arm 7 pins the line, and arm 9 checks that every shard sees 1)
- [WARNING] tools/lib/shell-parallel.sh:123 - the measurements came only from a quiet machine --> DEFERRED: a false premise; the 603 s Agent1s run shared the machine with another suite

#### Iteration 11
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above (a prose claim)
- [WARNING] .claude/plans/shelldefault-7100.md:64 - claimed that later commits did not change what an unset run does, so no full suite covered the code being shipped; also, the supervisor reset the command's INT and TERM handling --> FIXED (7ab6c0ec: the claim was DELETED; the inherited handling is restored, measured; arm 4k)

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 2 (a full suite on the final head, a duplicate of iteration 11; the inherited 1, a duplicate of iteration 10)
- [WARNING] tools/lib/shell-parallel.sh:126 - the supervisor's timing windows fail silently --> DEFERRED: the reviewer found nothing wrong today; arms 4f to 4k cover the paths; on an interruption the runner prints the tail of each shard log
**Converged** - no new actionable findings.

### Mutants run (each red on its own arm)
always 4; ignoring GITHUB_ACTIONS; ignoring CI; CI matched case-sensitively; CI=false not treated as off; the old
`:-1` default; empty taking the default; unset instead of exporting 1; exporting 4; release.sh without the export, with
the export before the guard, inside a dead branch, and with a later unset; the old plain launcher; a supervisor that
never checks its parent; the runner read by getppid; no TERM pass-through; no KILL after a passed TERM; leaving with
the command while a child that ignored the TERM runs on; the previous supervisor; INT reset to default.

### Strengths (across all iterations)
- Only an unset switch takes the default, and an empty value stays 1, so existing wrappers keep their behaviour.
- release.sh's export comes after its guard, so the guard still judges the caller's own value.
- Arm 9 is behavioural: the real run-tests.sh with a stub node, judged on the shard calls made and the value each shard sees.
- The supervisor closes the KILL-orphan hole that the default would have made common, and arms 4f to 4k can fail on it.

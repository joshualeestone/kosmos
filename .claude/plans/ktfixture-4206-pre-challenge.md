---
pre_challenge: true
method: challenge-loop
branch: ktfixture-4206
diff_hash: 965e20490f7f3469e1b829b2e9ef57ac617de93ffe286ba29d7b67225212207b
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T22:57:25Z
iterations: 14
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 14
**Converged:** Yes (iteration 14: both findings deduplicate against the plan's ledger)
**Total findings:** exact per-severity counts are recorded for iterations 12 to 14 only (below).
Iterations 1 to 11 ran in an earlier session whose per-severity tallies did not survive the account
move; their findings and resolutions are recorded in the plan's "Review N" sections and summarized
here from that record, not from memory.
**Fixed:** every finding in iterations 1 to 13 not listed as "Not changed" | **Deferred:** 5 (listed
below, each with its reason) | **Asked (awaiting user):** 0

**Final gate:** validation PASSED on 417977d62 (val_exit=0, audit_exit=0, hash 965e20490f7f, clean
worktree). Suites at HEAD: test-cut-guard.sh 0 failures, test-browser-run-guard.sh all clear,
test-runner-reexec-1818.sh 0 failures, tools.heavy-gate-3805.test.js 39 pass / 1 opt-in skip.

### Per-Iteration Breakdown

#### Iterations 1 to 6
**Reviewer model:** unknown (not recorded across the account move)
**Self-generated:** unknown
- [WARNING] cut-guard.sh filter: an lsof failure under set -e could end the loop and drop a real cut --> FIXED (6cdac9e1d; measured not live via the && context, the assignments now end in `|| x=""`)
- [WARNING] test-cut-guard.sh: the frozen-tree arm rooted under a kt folder on Linux --> FIXED (6347ae35c, rooted under /tmp by name)
- [WARNING] test-cut-guard.sh: fixed 0.3s sleeps could let a control pass for the wrong reason --> FIXED (6347ae35c, wait up to 3s for the cwd)
- [WARNING] test-browser-run-guard.sh: kt arm had no live-pid negative control --> FIXED (6347ae35c)
- [WARNING] the browser guard lacked the frozen-tree real-run control --> FIXED (58a0f203f)
- [WARNING] probe pid 86263 could be live and flake the controls --> FIXED (3ed59483b)
- [CONVENTION] the TMPDIR resolution gap on macOS (lsof /private/var) was unnamed --> FIXED (3ed59483b, named in the function comment)
- [WARNING] test-browser-run-guard.sh's opt-in real-path decoy would sit in a kt folder on Linux --> FIXED (1046ba014)

#### Iteration 7
**Reviewer model:** unknown
- [WARNING] #1050's probe-two pid 9191 could be live --> FIXED (3c6b6616e)
- [WARNING] sandbox arms went red without lsof instead of skipping --> FIXED (3c6b6616e, loud SKIP)
- [NIT] frozen-arm comment claimed the double slash reached the matcher --> FIXED (3c6b6616e)

#### Iteration 8
**Reviewer model:** unknown
- [WARNING] six refusal-names-pid assertions were substring matches --> FIXED (d0133d0c8, has_pid)

#### Iteration 9
**Reviewer model:** unknown
- [WARNING] nothing pinned that only the script word is read (whole-line matching passed) --> FIXED (27ffe148c)
- [WARNING] probe-two's other cut could be a live stranger --> FIXED (27ffe148c)
- [NIT] three comments overclaimed --> FIXED (27ffe148c)
- [WARNING] a real release.sh started with TMPDIR inside a kt sandbox would be ignored --> DEFERRED: no production path does that, and it is heavy-gate's existing rule

#### Iteration 10
**Reviewer model:** unknown
- [WARNING] browser guard lacked the cut guard's three script arms --> FIXED (12ce53ce0)
- [NIT] kt<digits> boundary cases not repeated here --> DEFERRED: tested once in tools.heavy-gate-3805.test.js in the same suite; two copies of one fact

#### Iteration 11
**Reviewer model:** opus
- [WARNING] the probe pid 99999 is unassignable only on macOS --> FIXED (6cf22cdbe, a pid proven dead at runtime in all three files)
- [CONVENTION] comments said heavy-gate shares the whole rule --> FIXED (6cf22cdbe, the PATH rule)
- [NIT] fallbacks, the T/tmp folder match, the unfiltered marker check, and a failed mktemp were unstated or unsafe --> FIXED (6cf22cdbe)
- [NIT] live sleeps can outlive an aborted run by 30s --> DEFERRED: harmless, and a trap kill needs every pid defined first

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 1 of the above (the comment was written in iteration 11)
- [CONVENTION] cut-guard.sh browser filter: comment claimed fixtures stay out of the marker check by sandboxing HOME; run-tests.sh does not --> FIXED (a82e92f47, states the obligation)
- [NIT] cut-guard.sh: three near-identical script regexes --> DEFERRED: they agree today and the extractor is pinned by the iteration 9 and 10 arms; a refactor beyond this card

#### Iteration 13
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT (plus 2 deduplicating)
**Self-generated:** 0
**Duplicates of prior findings (confirmed resolved):** 2 (regex duplication, iteration 12; lsof-absent fallback, iteration 7)
- [NIT] test-cut-guard.sh:330: the #1796 marker arm's pid assertion was the last substring match --> FIXED (f8fc8be8b, has_pid)

#### Iteration 14
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 new (2 WARNINGs, both deduplicating)
**Self-generated:** 0
**Duplicates of prior findings (confirmed resolved):** 2
- [WARNING] test-cut-guard.sh:179: a failed frozen-root mktemp exits the suite --> DUPLICATE of iteration 11's decision: it fails loud, non-zero and without the "0 failures" tally
- [WARNING] process-fixture.sh: the kt<digits> matcher now gates release and browser runs --> DUPLICATE of iteration 11's accepted T/tmp residual, stated at process-fixture.sh:60; the review's example path (~/tmp/kt-2026-hotfix) does not match (measured), ~/tmp/kt42 does, as documented
**Converged** - no new actionable findings.

### Final Ledger (iterations 12 to 14, exact)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 12 | CONVENTION | tools/lib/cut-guard.sh:336 | SELF | HOME-sandboxing claim | FIXED | a82e92f47 |
| 2 | 12 | NIT | tools/lib/cut-guard.sh | BRANCH | three near-identical regexes | DEFERRED | refactor beyond card |
| 3 | 13 | NIT | tools/test-cut-guard.sh:330 | BRANCH | last substring pid match | FIXED | f8fc8be8b |
| 4 | 14 | WARNING | tools/test-cut-guard.sh:179 | BRANCH | mktemp failure exits suite | DUPLICATE | iteration 11 |
| 5 | 14 | WARNING | tools/lib/process-fixture.sh:66 | BRANCH | matcher now gates release | DUPLICATE | iteration 11 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] cut-guard.sh: three near-identical script regexes (iteration 12), deferred as above.
- [NIT] live sleeps can outlive an aborted run by 30s (iteration 11), deferred as above.

### Strengths (across all iterations)
- Every protection is pinned by a mutation that reds a named arm (cwd check, script check, widened TMPDIR branch, whole-line script matching), reproduced independently by reviewers 12, 13 and 14.
- The shared rule has one home (process-fixture.sh), used by heavy-gate and both guards.

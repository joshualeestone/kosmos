---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0710
diff_hash: 31190f20b94c1fb09b8d60bfb8cb50a6b9da7047972c421ddf016ca9ce3ed9ff
validation: failed (the one full run at 99e3d95cc was red ONLY on #4498 queue tests in tools/test-cut-guard.sh, because Splinter's deadlock unstick required exporting KOSMOS_TESTS_IGNORE_SUITE=1, which those tests read; that file alone without the flag = 0 failures; node half 11931 tests 0 fail; every change since is web/whats-new.json copy + the plan, checked by whats-new-check and engine/whatsnew.test.js 6/6)
subdir_audit: passed
timestamp: 2026-09-29T18:08:36Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes, at iteration 4 (sonnet): zero NEW findings after dedup.
**Total findings:** 0 BLOCKERs, 8 WARNINGs, 1 CONVENTION, about 10 NITs across the four passes.
**Fixed:** all WARNINGs judged real and the CONVENTION | **Deferred:** as listed | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** fable
- [WARNING] web/whats-new.json - busy tile said agents "no longer restart it" (the guard only deters) --> FIXED 99e3d95cc ("tells agents to wait")
- [WARNING] web/whats-new.json - Community tile overclaimed (the block reaches an agent at birth or restart) --> FIXED 99e3d95cc ("From their next restart")
- [WARNING] web/whats-new.json - the busy tile depends on the then-open #4539 --> FIXED (hold written into the plan; #4539 merged f6f3d3a88)
- [NIT] scroll-bar tile triggers and order; plan reasons for #4470, #4531 --> FIXED 99e3d95cc

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 (the hold repeated; minor NITs deferred) --> converged on four tiles

#### Iteration 3 (after the pre-freeze re-read added a fifth tile)
**Reviewer model:** opus
- [WARNING] web/whats-new.json - the Muse tile (#4569) promised what PR #4572 says is NOT yet observed --> FIXED 0b6ce3d6d (removed; recorded in the plan)
- [WARNING] web/whats-new.json - the busy tile named no surface (it is the kosmos command, not the window) --> FIXED 0b6ce3d6d
- [WARNING] .claude/plans/whatsnew-0710.md - #4552 missing from tiles and left-out list --> FIXED 0b6ce3d6d (it is tile 5)
- [CONVENTION] plan status stale --> FIXED 0b6ce3d6d
- [NIT] Community tile scope --> FIXED ("agents in the Community"); [NIT] icon choice, line length --> DEFERRED (valid, within limits)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 NEW WARNINGs (2 duplicates: the deterrent wording, already accounted for; "never" is scoped by "on your own board", which is the PR's finding), 0 CONVENTIONs, 0 NEW NITs
**Converged** - no new actionable findings.

### Re-key after convergence
- The version string moved 0.7.10 -> 0.7.11 (Windows staging took 0.7.10). Content unchanged; whats-new-check 0.7.11 passes.

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking)
- [NIT] #4525 (held community posts) versus the Community tile: a judgement call, recorded in the plan (iteration 4)
- [NIT] the JSON is pretty-printed (iteration 4)

### Strengths
- Every tile is checked against a MERGED PR; a promise not yet observed (Muse) was taken out rather than softened (iteration 3)
- The plan names its weakest premise and the pre-freeze re-read that closed it found a real fifth tile (iterations 3, 4)

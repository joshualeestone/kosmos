---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0784
diff_hash: 3ed0f2e9649bd0aec37c0731911ca55ed4a0a3c54407b2c8914c7bc99fd0bf09
validation: failed (one unrelated timing test under load; it passes alone 3 of 3; release owner proceeded, see below)
subdir_audit: passed
timestamp: 2026-11-02T20:48:34Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 1 WARNING, plus NITs (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs)
**Fixed:** 1 | **Deferred:** 0 | **Asked (awaiting user):** 0

**Final validation (6j), stated as it happened:** the full local suite ran 26424 tests: 26016 pass, 1 fail, 407 skipped.
The one failure is server.headers-twice-7686.test.js ("a download the client cancels while the file is opened ends
quietly"), a server download test. This branch changes only release/whats-new-pool.json, web/whats-new.json and its
plan, none of which that test reads. Run alone three times on this branch at load 11-12: 12/12, 12/12, 12/12. The
release owner (Baron Draxum) proceeded without a second 45-minute run because the PR's CI runs the suite and the
0.7.84 cut runs it again on the frozen tree; nothing ships on this result alone. Subdir audit clean.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the plan's own sentence, written in b6f2d1dbd2)
- [WARNING] .claude/plans/whatsnew-0784-*.md: "nothing in them is edited by hand" stopped being true when Renet's entry was added --> FIXED (714802f944): the claim deleted, the hand-added entry recorded as a bullet
- [NIT] the room note's wording ("answered by id") --> FIXED (714802f944, then 7fee847ef4 to fit the 140-character line limit; the first wording was 153 and build refused it)
- [NIT] `<project>` vs the CLI's `<project-id>` --> FIXED (714802f944)
- [NIT] icon chat vs list for notesOnly items --> kept: notesOnly never reaches the window
- [NIT] other changes since 0.7.83 have no pool entries --> recorded in the plan: each feature's owner adds its own

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Converged**: no new actionable findings.
- [NIT] `since` 0.7.84 runs ahead of any release until the cut (correct for this cut)
- [NIT] the tie-break wording in the plan (no effect on the chosen five)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | .claude/plans/whatsnew-0784-*.md | SELF | a plan claim made false by a later commit | FIXED | 714802f944 |
| 2 | 6j | BLOCKER | server.headers-twice-7686.test.js | BRANCH | one failure in the full run | DEFERRED | unrelated to this diff; passes alone 3/3; CI and the cut rerun it |

### NITs (non-blocking, across all iterations)
- [NIT] icon choice for notesOnly items (iteration 1)
- [NIT] `since` ahead of a release until the cut (iteration 2)
- [NIT] tie-break wording (iteration 2)

### Strengths (across all iterations)
- The 0.7.83 record checked against the live site: prod serves 0.7.83 cut from d3e54c6f3, whose What's New is 0.7.77's, so no window showed (iteration 1)
- The built file is byte-for-byte the tool's own choice from the committed pool; notesOnly items stay out of the window (iterations 1, 2)
- All What's New tests pass: 68/68 (iterations 1, 2)

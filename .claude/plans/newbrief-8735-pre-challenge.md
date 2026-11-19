---
pre_challenge: true
method: challenge-loop
branch: newbrief-8735
diff_hash: a014ea0bfe9b826e8809df83946a664a9f6c33826c10307c283fa3023f46e901
validation: passed
subdir_audit: passed
timestamp: 2026-11-19T19:17:10Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the fleet's 8-round review cap (Splinter's standing rule: a loop stops at 8 rounds unless a BLOCKER is open, and later WARNINGs go to a follow-up card). No BLOCKER was open after round 2. Rounds 7 and 8's unworked WARNINGs are kosmos#8743; its item 1 must land before this branch is served, and is already built on `movednotice-8743`.
**Total findings:** 3 BLOCKERs, 21 WARNINGs, 4 CONVENTIONs, many NITs
**Fixed:** all 3 BLOCKERs and 16 WARNINGs | **Deferred (with reasons):** 2 | **Filed to kosmos#8743:** 4 WARNINGs | **Asked:** 0

Full validation after the loop, on HEAD 0c2f9effd5: PASSED (hash 9d9babd2c5b8), 29,889 node tests, 0 failed, all four shell shards status 0; subdir audit passed.
The PR then conflicted with main in engine/communityhome.js (one exports line: this branch added POST_STEP, main added
shownText and publicFlag). Resolved by merging main (6f5c9680b7), keeping both. Full validation re-run on Mortals on that
head: PASSED (hash f603c5cadef4, "status":"clean"), 29,909 node tests, 0 failed, all four shell shards status 0.
Main moved again and conflicted in tools/windows-tests.js (both sides added a Windows exclusion entry; kept all three).
Merged main again (60c2331691); the affected suites pass locally (96 tests). This head's full validation is the PR's CI,
which runs the whole suite on the merge with current main.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 5 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0 of the above
- [BLOCKER] engine/communityblock.js: the quoting rule (host safety, #4373 part B) left the always-loaded block --> FIXED (2b26ca1f26): kept in the block with one heredoc form, pinned
- [WARNING] engine/communityguide.js: the Kosmos-security disclosure rule only in the guide --> FIXED (2b26ca1f26): SECURITY_RULE in the block, pinned
- [WARNING] engine/replynudge.js, communityhome.js: prompts said "as the community rules show" with no form left in the block --> FIXED (2b26ca1f26): the heredoc form is back in the block
- [WARNING] engine/instructionreread.js: the change notice would mark the moved routine "no longer applies" --> FIXED (2b26ca1f26), reworded in rounds 5 and 7; the changes-file side is kosmos#8743 item 1
- [WARNING] engine/create.brief-size-8735.test.js: could pass vacuously without a community section --> FIXED (2b26ca1f26): asserts the section is present
- [WARNING] engine/communityguide.js: the daily-asks line dropped one-of-each-kind and never-only-to-meet-the-count --> FIXED (2b26ca1f26)
- [CONVENTION] communityblock.test.js: safety items asserted only on block+guide --> FIXED (2b26ca1f26): pinned in the split test

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above
- [BLOCKER] engine/windows-tests-1777.test.js: the new size test branches on win32 and was neither selected nor excluded --> FIXED (982fe3c3e7): excluded with its reason in tools/windows-tests.js
- [WARNING] engine/communityguide.js: the post-title rule (host safety) only in the guide --> FIXED (982fe3c3e7): TITLE_RULE in the block, pinned
- [WARNING] engine/communityguide.js: the endorse honesty rules only in the guide --> DEFERRED: their privacy half is in the block (IDENTIFYING, PRIVATE_RULE); the rest is conduct on a command reached through the guide (recorded in the plan)
- [CONVENTION] .claude/plans/newbrief-8735.md: stale figures --> FIXED (982fe3c3e7)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/communityturn.js, autohandoff.js: the prompts that start a post never name the guide --> FIXED (c414f67324)
- [WARNING] (no file): no test drives `community --how` through either CLI --> FIXED (c414f67324): engine/communityguide.test.js, selected for Windows
- [WARNING] engine/create.brief-size-8735.test.js: sandbox path length moved the figure with TMPDIR --> FIXED (c414f67324): counted as one word, measured equal under two TMPDIRs

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** 1 of the above
- [WARNING] engine/communityblock.js: the header described the old block --> FIXED (b91806b768)
- [WARNING] engine/communityturn.js: the introduction prompt did not name the guide --> FIXED (b91806b768)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above (the notice sentence from iteration 1)
- [WARNING] engine/communitytaskdone.js: a rebuilt copy of POST_CLAUSE had drifted --> FIXED (bf7fedfdea): uses communityturn.POST_CLAUSE
- [WARNING] engine/instructionreread.js: an unconditional "still applies" could become false --> FIXED (bf7fedfdea): reworded (prose claim from this loop, per 6e)
- [WARNING] engine/communityguide.js: "each time" re-read 8k every round --> FIXED (bf7fedfdea): once a session

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/communityhome.js: the post step did not name the guide --> FIXED (dca72fb517): POST_STEP, and a test holding every post prompt to it
- [WARNING] engine/create.brief-size-8735.test.js: 30 characters of headroom --> DEFERRED: a ratchet by design (stated in the test and plan)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 1 BLOCKER-shaped issue rated WARNING, 2 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** 1 of the above
- [WARNING] engine/instructionreread.js: notice vs changes file --> FIXED in part (0c2f9effd5); the changes-file half is kosmos#8743 item 1
- [WARNING] engine/create.brief-size-8735.test.js: Mac-only red with Linux CI green --> FIXED (0c2f9effd5): each brief counted as its Mac form
- [CONVENTION] engine/communityguide.test.js: inline win32 skip --> FIXED (0c2f9effd5): skipOnWin32

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- all four WARNINGs --> filed as kosmos#8743 (notice vs changes file; path normalisation understates real paths; reply/comment/vote prompts; platform normalisation hides one-platform growth). Items 1 and 3 are already built on movednotice-8743.

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- The introduction lines keep their two-space indent (tied to the board-start refresh's detection of that exact text).
- The bash CLI prints two usage lines for an extra argument (the existing wrapper, as connections --how).
- Several comment-accuracy NITs, fixed as they were found.

### Strengths (across all iterations)
- The safety rules stay always loaded and are pinned line by line; the routine moved word for word, proven on darwin and win32.
- `kosmos community --how` matches `connections --how` on both CLIs, byte-identical output, tested on both.
- Constants defined once in a module that requires nothing, re-exported; no require cycle.
- The size guard makes a real agent of every role and cannot measure a brief without the community section.

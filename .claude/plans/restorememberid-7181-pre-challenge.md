---
pre_challenge: true
method: challenge-loop
branch: restorememberid-7181
diff_hash: 2ab8ea4976f3e7acb441745d0351ddb9f543cc06e45f979adcc635d6cc166409
validation: passed
subdir_audit: passed
timestamp: 2026-10-27T02:37:29Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (default, sonnet, default, sonnet)
**Converged:** Yes (round 4: no new findings)
**Total findings:** 0 BLOCKERs, 4 WARNINGs, 12 NITs
**Fixed:** all 4 WARNINGs and 9 NITs | **Deferred:** 3 NITs, each with its reason in .claude/plans/restorememberid-7181.md | **Asked (awaiting user):** 0

Evidence: engine/restoreworld-5536.test.js 57 of 57 (with the reachability and comment-deferral guards, 67 of 67).
Mutation arms, each red: the member tag removed (round 1, 3 arms); the refusal of an unusable member id removed; the
tag cut back to 6 hex (round 2). Rebased onto main after #7240 (4b) merged; the two #7181 commits applied cleanly.
Full validation (tools/run-tests.sh) passed locally at the hash above (head 70f20b8be0, 21:33 CDT).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** default
**New findings:** 2 WARNINGs, 4 NITs
- [WARNING] the no-id refusal said "under this name" --> FIXED ("under names that read the same to Kosmos")
- [WARNING] an optional memberId is a silent regression if 4c forgets it --> FIXED (the 4c contract comment and #5536 carry the obligation; no call site exists yet)
- [NIT] the comment overpromised what the tag hides --> FIXED
- [NIT] the module header lacked the new name shape --> FIXED
- [NIT] a WIP commit --> FIXED (folded)
- [NIT] tag even Latin names --> DEFERRED (deliberate, uniform, reversible)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 4 NITs
- [WARNING] a 24-bit tag collides at about 580 members whose names reduce alike --> FIXED (48 bits)
- [WARNING] an unusable memberId fell back to the shared names --> FIXED (refused)
- [NIT] hashing is byte for byte --> FIXED (documented)
- [NIT] the pool is per (name, tag) --> FIXED (documented)
- [NIT] a guessable id can be confirmed from the tag --> DEFERRED (already conceded in the comment)
- [NIT] no collision test --> DEFERRED (not testable at 48 bits; the unusable-id test covers the other gap)

#### Iteration 3
**Reviewer model:** default
**New findings:** 4 NITs
- [NIT] "The call" said six hex and the old refusal --> FIXED
- [NIT] the contract did not say member is the shown name --> FIXED
- [NIT] the tag-space wording, and the org assumption --> FIXED
- [NIT] a narrow switcher can cut the tag --> FIXED (named for 4c)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0. Converged.

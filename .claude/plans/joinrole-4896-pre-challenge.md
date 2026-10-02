---
pre_challenge: true
method: challenge-loop
branch: joinrole-4896
diff_hash: bb58fa792ffd89687bc314977bd86c4c6b07805bf59ca0073648c5325281a390
validation: passed (Mortals)
subdir_audit: passed
timestamp: 2026-10-02T02:35:28-05:00
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes
**Total findings:** 3 BLOCKERs, 17 SHOULD-FIXes, NITs as recorded per round
**Fixed:** every BLOCKER and SHOULD-FIX, except one SHOULD-FIX routed to its own card (#4976) | **Asked (awaiting user):** 0

The full record of each round is in `.claude/plans/joinrole-4896.md`.

#### Iteration 1 (opus)
- [BLOCKER] connect asks every question about the NEW name and none about whether another name already records the folder, so two names share one CLAUDE.md (one identity, one role). Reproduced in a sandbox --> FIXED (discover.js: one folder is one agent)
#### Iteration 2
- [SHOULD-FIX] a removed agent's profile outlived the removal and kept holding its folder --> FIXED
#### Iteration 3
- [BLOCKER] round 2's "gone" test was remove.hidesCard, also true for a card cleared while its session ran --> FIXED
- [SHOULD-FIX] x4, measured by the reviewer in a sandbox --> FIXED
#### Iteration 4
- [SHOULD-FIX] x3, measured --> FIXED
#### Iteration 5
- [SHOULD-FIX] an agent Kosmos created records no folder, so its default home was not held --> FIXED (createdHomeOf)
#### Iteration 6
- [BLOCKER] x2 in createdHomeOf: the home compared by spelling (APFS folds case); a slug folder under a different name --> FIXED
- [SHOULD-FIX] any folder in the workers root counted as a home --> FIXED
#### Iteration 7
- [SHOULD-FIX] x2: "an agent of that name exists" read as "this is its home"; profileFileName throws on a name safeKey empties --> FIXED
#### Iteration 8
- [SHOULD-FIX] x2: a null key matched a null key; a comment said "its folder" for "its recorded folder" --> FIXED
#### Iteration 9 (end to end through the real server routes)
- [SHOULD-FIX] the restore refusal named the holder by the restored agent's own display name --> FIXED (agent name)
- [SHOULD-FIX] the page drops every restore refusal's reason --> ROUTED to #4976 (a web change with its own browser-check gate)
#### Iteration 10
**Converged.** 0 BLOCKER, 0 SHOULD-FIX. NIT taken: HELD_MEMO keyed by store.PROFILES.

### Validation (head 7ee3fe7ff)
- Mortals full suite: passed, hash bb58fa792ffd recorded (02:34 CDT 2026-10-02).
- Round 9: all 154 test files that require discover/remove/create, each alone: 2916 pass, 0 fail. Round 10 focused: 138/138.
- Engine-only change: no web/ file, so no browser check applies.

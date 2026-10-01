---
pre_challenge: true
method: challenge-loop
branch: whatsnew-next
diff_hash: 9bd4cb088f28035bd5667405e2703a57bd47897fbf170b95994d1e3a83900797
validation: passed (focused: the file's own checker and the tests that read it; the full suite runs in the PR's CI)
subdir_audit: passed
timestamp: 2026-10-01T11:14:45Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3's only WARNING repeats the plan's named weakest premise, voice unheard in a served build)
**Total findings (actionable):** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs; NITs below
**Fixed:** 3 | **Deferred:** 0 | **Asked (awaiting user):** 0

**Validation, stated exactly:** the diff is web/whats-new.json and the plan. What reads that file was run on HEAD:
`node tools/whats-new-check.js 0.7.16` rc 0 (CONTROL: 0.7.15 gives rc 3), tools.whats-new-check-3955.test.js 6/6,
server.test.js's whats-new tests 2/2 (name filter, count asserted). The full suite was NOT run locally; CI runs it.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [WARNING] web/whats-new.json: "Room posts arrive faster" is felt only in big rooms (6.1 s to 0.8 s for 20 members) and is unverified on Windows' delivery path --> FIXED (edbf8eba0: replaced by #4722, a new project asks what done looks like)
- [WARNING] web/whats-new.json: "the mic in any message box" overclaims; it is in chats, rooms and the Guide --> FIXED (edbf8eba0)
- [NIT] team size 2 to 6: the live catalogue's teams are 3 to 6 --> FIXED (no size named)
- [NIT] a paused project is resumed, not taken off hold --> FIXED

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1
- [WARNING] web/whats-new.json: "On a Mac" covered the speaker too, which is drawn wherever speechSynthesis exists (Windows included) --> FIXED (c4c499863: the qualifier covers only the mic, as "in the Mac app")
- [NIT] the coordinator warning appears after the second joins ("Two coordinators on this project.") --> FIXED

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0
**Duplicates of prior findings:** 1 (voice unheard in a served build: the plan's weakest premise, with its drop-the-line fallback)
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/whats-new.json | BRANCH | room posts line weak and unverified on Windows | FIXED | edbf8eba0 |
| 2 | 1 | WARNING | web/whats-new.json | BRANCH | "any message box" overclaims | FIXED | edbf8eba0 |
| 3 | 2 | WARNING | web/whats-new.json | SELF | Mac qualifier covered the speaker | FIXED | c4c499863 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- The swarm icon on the team line, now that New Agent also offers a Swarm (iteration 2)
- The org-chart upload (#4559) not named (iteration 2)
- "This computer" is shown before a Kosmos+ sign-in names it (iteration 2)
- The speaker sits in a hover bar, less obvious on a phone (iteration 3)
- One Kosmos per computer is a removal, the weakest of the five (iteration 3)

### Strengths (across all iterations)
- Every line backed by a merged commit in eaab65dad..origin/main with no revert, and its UI words match the page (iterations 2, 3)
- Lines hold on Windows (shared routes and page) or name the Mac app; the plan records why there is no Windows file (iterations 1 to 3)
- Josh's #4820 ruling honoured by leaving Community out (iterations 1, 3)

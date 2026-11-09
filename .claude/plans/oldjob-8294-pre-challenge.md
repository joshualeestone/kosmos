---
pre_challenge: true
method: challenge-loop
branch: oldjob-8294
diff_hash: 6356e3f9ddc7f26728df21dc00c41b00f313aafe16b9f8f5df09889d6b3cf5c3
validation: passed (Mortals)
subdir_audit: passed
timestamp: 2026-11-09T18:32:30Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at iteration 8 under the fleet's usage rule (Splinter, fleetbuilders m510, 2026-10-26: a review loop stops at 8 rounds unless a BLOCKER is open). No user asked for this stop. The two BLOCKERs raised were both fixed; iteration 8 raised none.
**Total findings:** 2 BLOCKERs, 31 WARNINGs, 3 CONVENTIONs, 23 NITs

**Validation, stated exactly.** The full suite ran once, at the end, on Mortals: entry status clean, hash 6356e3f9ddc7, 28270 tests, 0 fail, 0 cancelled, base 69ffece4d4. Each iteration ran the new test file and the neighbouring connect tests instead. The 6j helper skipped on that clean entry, rc 0.

**The design changed at iteration 7.** Iterations 1 to 7 each found new shell-script shapes the hand-written matching got wrong, in both directions. The fix was to move the decision: connect warns once and pressing Add again goes ahead, and detection reuses engine/register.js's existing LaunchAgents reader. Iterations 1 to 6 reviewed code that no longer exists; only iteration 8 reviewed the final shape.

**Slip:** iteration 4's commit went in with one failing test (a check I had added was dead, because the running check already reads `<name>-discord`). No reviewer ran on it; the dead check was removed and the commit amended before iteration 5.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 5 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0 of the above
- [BLOCKER] engine/discover.js - a job working in the folder refused with no check that it starts an agent --> FIXED
- [WARNING] a pipe as an argument hung the click --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] terminal recipe in the sentence --> FIXED
- [WARNING] an unreadable or binary plist counts as no job --> DEFERRED: stated, today's behaviour

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] nothing tied the program to the folder --> FIXED, then superseded at iteration 7

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] the sentence could not be cleared by following it --> FIXED
- [WARNING] a folder with no instructions skips the check --> DEFERRED: that path installs no job and starts nothing

#### Iteration 5
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 5 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 3 of the above
- [BLOCKER] engine/connect-oldjob-8294.test.js - the win32-branch guard would red the full suite --> FIXED, later moot (the fifo tests went with the old parser)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 3 of the above
- [WARNING] x5, including a third copy of engine/register.js's reader --> FIXED by the redesign

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] Mac-only scope unstated --> FIXED in the plan
- [WARNING] the plutil budget unstated --> FIXED in the plan

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/discover.js | BRANCH | Refused a job that starts no agent | FIXED | redesign |
| 2 | 5 | BLOCKER | engine/connect-oldjob-8294.test.js | SELF | Windows-test guard would red | FIXED | moot after redesign |
| 3 | 7 | WARNING | engine/discover.js | SELF | Third copy of the plist reader | FIXED | engine/register.js foreignStarter |
| 4 | 8 | WARNING | .claude/plans/oldjob-8294.md | BRANCH | Mac-only scope unstated | FIXED | plan |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] engine/connect-oldjob-8294.test.js - the page half is pinned by source text only (iteration 8); see #8305's item 2
- [NIT] engine/register.js - `pkill claude` in a script naming the folder is a false match, one more press (iteration 8)
- [NIT] web/index.html - the override flag stays set on the row after the warning (iteration 8)

### Strengths (across all iterations)
- The warning writes nothing, and a test asserts no install and no profile (iterations 1 to 8)
- The final shape reuses the survey's guarded reader, so it keeps the macOS privacy protections (iteration 8)

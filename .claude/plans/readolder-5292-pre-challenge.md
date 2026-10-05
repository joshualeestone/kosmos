---
pre_challenge: true
method: challenge-loop
branch: readolder-5292
diff_hash: c07d2d5d150e8c2ee6b04b26027be602b4dbaab11d3aa6e66b9b26ca8a233eb1
validation: not run locally (the machine's suite queue was 11 deep and the previous run gave up at its 2700 s bound; CI runs the full node and shell suites on the PR head, and the merge waits on it)
subdir_audit: passed
timestamp: 2026-10-05T15:25:17Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 raised only NITs)
**Total findings (actionable):** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, plus NITs
**Fixed:** 3 | **Deferred:** 0 | **Asked (awaiting user):** 0

What was run: the seven test files that touch community read (173 tests, all pass), plus `bash -n install/kosmos`. Reviewer 2 independently found and ran 16 files, 305 tests, all pass. The full local suite was NOT run (see `validation` above). CI's full suites on the PR head are the gate.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [BLOCKER] server.community-read-4373.test.js:65 and server.agent-token-gate-4491.test.js:227: both still asserted that a feed read ends with the frame close, which the footer changes --> FIXED (d80cd2893): both now pin the frame and then the footer
- [WARNING] engine/communityread.js: a well-shaped place the service answers 400 for was reported as an outage --> FIXED (d80cd2893): now said as the reader's mistake, with a control
- [WARNING] engine/communityread.js: comments said "the channel as given" (it is normalised) and that older works with or without the channel --> FIXED (d80cd2893)
- NITs fixed in the same commit: the usage's outer brackets, and an empty --older refused on both CLIs.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | server.community-read-4373.test.js, server.agent-token-gate-4491.test.js | BRANCH | frame-end assertions not updated | FIXED | d80cd2893 |
| 2 | 1 | WARNING | engine/communityread.js | BRANCH | service 400 on --older read as an outage | FIXED | d80cd2893 |
| 3 | 1 | WARNING | engine/communityread.js | BRANCH | comments overclaimed the channel handling | FIXED | d80cd2893 |

### Outstanding questions
None.

### NITs (iteration 2)
- The channel heading changed from "Newest in <ch>:" to "Newest posts in <ch>:"; nothing parses it.
- Any 400 on an --older read is treated as the reader's mistake; the fresh read it points to surfaces a real outage.
- The plan lists the tests in general terms.

### Strengths
- Kosmos's footer is outside the frame, pinned both ways.
- The cursor is shape-checked in both directions; an unsafe next_cursor is never printed as a command.
- The Mac CLI, the Windows CLI and the route refuse the same combinations.

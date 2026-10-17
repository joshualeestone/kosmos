---
pre_challenge: true
method: challenge-loop
branch: agenone-6405
diff_hash: c5185616385246e95e6571e2a9d45561e5d52eaaa3deb3556430ee0245c55952
validation: pending (the new browser-check arms start a board, so they run in PR CI's browser-checks job, the merge gate; the local queue is backed up)
subdir_audit: passed
timestamp: 2026-10-17T17:17:30Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 17 (1 BLOCKER, 3 WARNINGs, 1 CONVENTION, 12 NITs)
**Fixed:** 6 | **Deferred:** 0 | **Asked (awaiting user):** 0

Card #6405 (Josh's 0.7.55 pairing test: tmnt's fresh join request read "23 hours ago" on the laptop).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above (ITER_COMMITS was empty)
- [WARNING] web/index.html:50410 — a was_a_computer row still showed an age and faded --> FIXED (commit 86513489: askComputerRow covers it)
- [WARNING] web/index.html:50396 — turning away a day-old computer row lost the "change that email's password" sentence --> FIXED (commit 86513489: a computer's row always gets the fresh wording)
- [NIT] the notice's dismissal key uses first_seen too --> follow-up #6417 (same root cause, older code)
- [NIT] a needless 50 ms wait in the arm; the check header; an older comment --> FIXED (86513489) / noted

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 1 WARNING, 1 CONVENTION, 3 NITs
**Self-generated:** 1 of the above (the oldAsk branch left reachable-looking by iteration 1)
- [BLOCKER] web.allow-card.test.js:90 — the test quotes the old stale expression and failed (I had not run it) --> FIXED (commit 97ababc4: pins the new expression, askComputerRow and the conditional age span; 12/12)
- [WARNING] render-connect-sheet-4637.js — the denied arm had no CONTROL --> FIXED (commit 97ababc4: a day-old phone keeps the old wording)
- [CONVENTION] the plan's steps did not name the node test --> FIXED (97ababc4)
- [NIT] the old-request wording's computer branch could no longer be reached --> FIXED (97ababc4)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [NIT] plan step 1 still named the old expression --> FIXED (plan only)
- [NIT] two older comments say every card shows its age; the #6405 line under them qualifies it
- [NIT] noteKey (#6417); the nowrap count now pins the computer's missing age indirectly
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html:50410 | BRANCH | was_a_computer rows aged and faded | FIXED | 86513489 |
| 2 | 1 | WARNING | web/index.html:50396 | BRANCH | denied wording lost the password sentence | FIXED | 86513489 |
| 3 | 2 | BLOCKER | web.allow-card.test.js:90 | BRANCH | node test quoted the old expression | FIXED | 97ababc4 |
| 4 | 2 | WARNING | render-connect-sheet-4637.js | BRANCH | denied arm without a CONTROL | FIXED | 97ababc4 |
| 5 | 2 | CONVENTION | plan | SELF | steps missed the node test | FIXED | 97ababc4 |

### Validation
- Node: web.allow-card 12/12, web.plus-stale 9/9, web.allagents-4812 37/37, browser-checks-selectors 4/4, tools.browser-checks-wired 11/11, web.api-routes-3957 29/29 (run from the worktree).
- Both browser-check gates (#1720, #2518): 0.
- The new render-connect-sheet-4637.js arms (day-old computer, was-a-computer and phone rows; the denied wording and its CONTROL) start a board, so PR CI's browser-checks job runs them; the merge waits on it.
- Screenshot: ~/work/design-shots/kosmos-6405/computer-request-no-age--desktop--{light,dark}.png (a computer first seen 23 hours ago: no age, not faded).

### NITs (non-blocking, across all iterations)
- see the per-iteration lists above

### Strengths (across all iterations)
- one helper (askComputerRow) decides the age, the fade and the denied wording (iterations 1-3)
- the arm restores ASK.devices and ASK.done and runs with no awaits between paint and read (iteration 3)
- phones and browsers are untouched; the CONTROLs prove it (iterations 2, 3)

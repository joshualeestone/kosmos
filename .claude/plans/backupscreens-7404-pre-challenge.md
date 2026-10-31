---
pre_challenge: true
method: challenge-loop
branch: backupscreens-7404
diff_hash: c83e381f2e9312df2cee86eaf99683dc7bbf6893075e0218ea42009d4847942c
validation: failed (user deferred: 4 real-binary timeouts under machine load, all 17 tests in those two files pass alone; see below)
subdir_audit: passed
timestamp: 2026-10-31T14:58:54Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped after iteration 8 by Splinter's standing usage rule (fleetbuilders, restated 2026-10-26 16:07): "A review loop stops at 8 rounds unless a BLOCKER is still open. Past 8, WARNINGs go to a follow-up card, not another round." No BLOCKER was open after iteration 8; its four WARNINGs are kosmos#7681.
**Total findings (BLOCKER/WARNING/CONVENTION):** 2 BLOCKERs, 26 WARNINGs, 1 CONVENTION, plus NITs (29 ledger rows)
**Fixed:** 22 | **Deferred:** 3 | **Asked (awaiting user):** 0 | **Moved to follow-up card #7681:** 4

Initial validation: the full suite was not run at 6.0. Per Splinter's 09-29 queue ruling (one full suite per Mac, run once at convergence), the baseline was the nearby suite: 439 files (every web.* test plus the org, step-up and personal backup tests), 3608/3608 pass at e4985cceab.

Final validation (6j), full suite at 5173388e33, queued on this Mac behind two other runs: 26066 tests, 25655 pass, 4 fail, 0 cancelled. All four failures are tests that drive the REAL Grok and Codex binaries, each timing out at 90 s: engine/grokkeep-5812 (1) and engine/orgchartcodex.capture (3). This branch touches neither. Run alone afterwards on an idle machine, the two files pass 17/17 with 0 skipped. Recorded as failed-and-deferred rather than passed; PR CI runs the suite again on its own machine.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [BLOCKER] web/index.html:12255 - the #pb dark-field rule lost its closing line when split from #plus-state2, leaving one { open; ~470 lines of CSS (the Kosmos+ sign-in fields among them) matched nothing --> FIXED (1150b41d14), plus web.style-braces-7404, red with the defect put back
- [WARNING] web/index.html pbPaint - the Turn off confirm was undone by the 5-second repaint --> FIXED (1150b41d14)
- [WARNING] server.js - /saved deleted what may be the only copy of the code with no step-up --> FIXED (1150b41d14)
- [WARNING] server.personalbackup-7404.test.js - no test of the field pass-through --> FIXED (1150b41d14), red with member dropped
- [WARNING] engine/personalbackupoffer.js - price from a board env var, not the coordinator --> DEFERRED: the plan's named weakest premise; switch off by default; the price is Josh's; carried to #7681
- [NIT] 404 before 403; `code` doubles as secret and refusal; PB.code on hide (fixed); plan status (fixed)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html pbPrint - print window kept the code and an opener --> FIXED (2bcd7542e2): hidden frame removed after printing
- [WARNING] server.js - `code` is both the recovery code and a refusal code --> FIXED (2bcd7542e2): recoveryCode, red with the rename disabled
- [WARNING] server.js - HEAD handling / isViaScreen accepts any sec-fetch-site --> DEFERRED: identical to /api/org/*, consistency not a new hole
- [CONVENTION] .claude/plans - stale against the code --> FIXED (2bcd7542e2)
- [NIT] braces in unquoted url(); Copied line lingers (fixed)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [BLOCKER] server.js:12719 - POST to the bare /api/personal-backup fell through to switchOff, past the step-up gate --> FIXED (fd4467c7d3), route test red with the old shape
- [WARNING] web/index.html pbPost - a remote step-up refusal was shown as "try again" --> FIXED (fd4467c7d3)
- [WARNING] web/index.html pbAccept - Not now posted to a gated, price-gated route --> FIXED (fd4467c7d3): decided on the page
- [WARNING] server test - no test that an unlisted method/path is inert --> FIXED (fd4467c7d3)
- [NIT] Copy without clipboard (fixed); saved clears at once (fixed); hidden panel drops a typed code (fixed)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (the stale header line predates the loop's fix commits)
- [WARNING] engine/personalbackupoffer.js:8 - header said a missing price shows "Price to be set" --> FIXED (c8b8eec5d2): claim deleted
- [WARNING] server.js - one shared field list for every step --> FIXED (c8b8eec5d2): per step, red with one list
- [WARNING] web/index.html pbAccept - ticket cleared before the post --> DEFERRED: only the ticket is lost, never a code; a new preview recovers it
- [NIT] inline requires; a fourth copy of the dark-field colours

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html pbAccept - the move to a new computer had no working route to restore --> FIXED (668be6fa74)
- [WARNING] engine restore - a restore left the panel in needs-key (no key-ready marker) --> FIXED (668be6fa74), red with the marker removed
- [WARNING] server.js restore - called restorePersonalKey directly, which reads the ACCOUNT's current membership: on an account in a company it acted on company rows --> FIXED (668be6fa74): engine restore() behind boundHereNow, red with the check removed
- [WARNING] restore copy claimed nothing on this computer changes --> FIXED (668be6fa74)
- [NIT] raw because (fixed: asSentence); read ordering (fixed: seq); restore/off pass-through untested (fixed)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html pbMaybe - a failed read hid the box and dropped a code on screen --> FIXED (0a070142ba)
- [WARNING] engine restore - ran with the key already set up, and could drop a pending code --> FIXED (0a070142ba): needs-key only, red with the rule removed
- [NIT] `already` passed but unread (fixed); offer() evaluated three times; marker write failure swallowed (carried to #7681)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above (the step-up comment and the restore guard comment were both written by this loop's own fix commits; both claims deleted, not reworded)
- [WARNING] server.js:5205 - comment said preview only reads; preview makes the personal membership --> FIXED (5173388e33): preview gated, claim deleted
- [WARNING] engine/personalbackup.js restore - guard comment claimed protection the code did not give (needs-key from a pending code) --> FIXED (5173388e33): codeWaitingHere refuses it, red with the guard removed; the comment is gone, the test is the guard
- [WARNING] web/index.html - no outcome test of the code leaving the page --> FIXED (5173388e33): web.pbcode-7404 on the fake DOM, red with the drops removed
- [NIT] keep the ticket on a step-up refusal; plan copy (fixed); static Finish button (fixed); duplicated not_a_code wording

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] price not bound to what is billed --> FOLLOW-UP #7681 (item 1)
- [WARNING] print from a 0x0 frame may print the parent page in some browsers --> FOLLOW-UP #7681 (item 2)
- [WARNING] restore checks state before an await, not after --> FOLLOW-UP #7681 (item 3)
- [WARNING] a failed key-ready write after a restore is not explained --> FOLLOW-UP #7681 (item 4)
- [NIT] ticket and words kept on hide; restore doc comment placement; `code` in the default keep list (last two on #7681)
**Stopped** - round cap reached with no BLOCKER open (Splinter's usage rule).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html:12255 | BRANCH | unclosed CSS brace | FIXED | 1150b41d14 |
| 2 | 1 | WARNING | web/index.html pbPaint | BRANCH | confirm undone by repaint | FIXED | 1150b41d14 |
| 3 | 1 | WARNING | server.js step-up | BRANCH | saved ungated | FIXED | 1150b41d14 |
| 4 | 1 | WARNING | server test | BRANCH | no pass-through test | FIXED | 1150b41d14 |
| 5 | 1 | WARNING | personalbackupoffer.js | BRANCH | price from env | DEFERRED | weakest premise, #7681 |
| 6 | 2 | WARNING | pbPrint | BRANCH | print window kept code | FIXED | 2bcd7542e2 |
| 7 | 2 | WARNING | server.js keep | BRANCH | code doubles as secret | FIXED | 2bcd7542e2 |
| 8 | 2 | WARNING | server.js GET | BRANCH | HEAD / isViaScreen | DEFERRED | same as /api/org |
| 9 | 2 | CONVENTION | plan | BRANCH | stale plan | FIXED | 2bcd7542e2 |
| 10 | 3 | BLOCKER | server.js:12719 | BRANCH | bare POST reached switchOff | FIXED | fd4467c7d3 |
| 11 | 3 | WARNING | pbPost | BRANCH | step-up refusal unshown | FIXED | fd4467c7d3 |
| 12 | 3 | WARNING | pbAccept | BRANCH | decline to gated route | FIXED | fd4467c7d3 |
| 13 | 3 | WARNING | server test | BRANCH | inert-path untested | FIXED | fd4467c7d3 |
| 14 | 4 | WARNING | personalbackupoffer.js:8 | BRANCH | stale price claim | FIXED | c8b8eec5d2 |
| 15 | 4 | WARNING | server.js keep | BRANCH | one shared field list | FIXED | c8b8eec5d2 |
| 16 | 4 | WARNING | pbAccept | BRANCH | ticket cleared first | DEFERRED | only the ticket is lost |
| 17 | 5 | WARNING | pbAccept | BRANCH | no route to restore | FIXED | 668be6fa74 |
| 18 | 5 | WARNING | engine restore | BRANCH | no key-ready marker | FIXED | 668be6fa74 |
| 19 | 5 | WARNING | server.js restore | BRANCH | acted on company rows | FIXED | 668be6fa74 |
| 20 | 5 | WARNING | restore copy | BRANCH | overclaimed | FIXED | 668be6fa74 |
| 21 | 6 | WARNING | pbMaybe | BRANCH | failed read dropped code | FIXED | 0a070142ba |
| 22 | 6 | WARNING | engine restore | BRANCH | ran with key set up | FIXED | 0a070142ba |
| 23 | 7 | WARNING | server.js:5205 | SELF | preview "only reads" | FIXED | 5173388e33 |
| 24 | 7 | WARNING | engine restore | SELF | guard comment overclaimed | FIXED | 5173388e33 |
| 25 | 7 | WARNING | web/index.html | BRANCH | no outcome test of code drop | FIXED | 5173388e33 |
| 26 | 8 | WARNING | price binding | BRANCH | price not bound | DEFERRED | #7681 item 1 |
| 27 | 8 | WARNING | pbPrint | BRANCH | 0x0 frame print | DEFERRED | #7681 item 2 |
| 28 | 8 | WARNING | engine restore | BRANCH | check before await | DEFERRED | #7681 item 3 |
| 29 | 8 | WARNING | engine restore | BRANCH | marker write failure | DEFERRED | #7681 item 4 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- 404 before the agent 403 lets an agent tell the switch is on (iteration 1)
- braces inside an unquoted url() would miscount (iteration 2)
- inline requires swallow a module fault as shown:false (iteration 4)
- the not_a_code sentence is in two places (iteration 7)
- ticket and words survive the panel hiding; harmless, expires in ten minutes (iteration 8)

### Strengths (across all iterations)
- Exact-path routes, 404 with the switch off, 403 to agents, step-up on every step, named fields per step (iterations 3 to 8)
- The recovery code leaves the board once, under its own name, and leaves the page on saved, on hide and on a view change, with a fake-DOM test (iterations 2, 7)
- restore and the key step share one Kosmos+ binding check (boundHereNow), tested against a company membership with a control (iteration 5)
- The CSS brace guard is class-level, with its own red-capable control (iteration 1 onward)

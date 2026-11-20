---
pre_challenge: true
method: challenge-loop
branch: moverswitch-8841
diff_hash: bc8d2d9e038095a738950f42a6fa6410a7ed865530b866b9b25a1202f7721354
validation: not run locally (machine reserved for the 0.8.13 release for the whole loop; the full suite for this head is CI's). Run locally at b5b111e268 - the unit, route, page and neighbour tests with the guards, all passing (counts below). One browser check is owed a run.
subdir_audit: n/a (no CLAUDE.md file changed)
timestamp: 2026-11-20T22:47:23Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped after iteration 8 under the fleet's standing rule (Splinter, 2026-11-12, recorded in my
report to Josh that day: "a review loop stops at 8 rounds unless a real blocker is open"). No blocker is open:
iteration 5's and iteration 7's were fixed, and iteration 8 raised none. One question is open and is asked below.
**Total findings:** 57 (2 BLOCKERs, 28 WARNINGs, 1 CONVENTION, 26 NITs)
**Fixed:** 2 BLOCKERs, 18 WARNINGs (3 of them in part, each marked) | **Deferred:** 9 WARNINGs (3 judged, 6 repeats of a recorded decision) | **Asked (awaiting a person):** 1

### How this run differs from the skill as written
- **Validation.** Steps 6.0, 6g and 6j call the validation helper, which is the full suite. The machine was reserved
  for the 0.8.13 release throughout (extended every ten minutes), and no suite may start during a reservation, so the
  helper did not run. After each fix round I ran the test files that cover the change and the guards a new engine
  module, data file, test file and page change must pass. At b5b111e268 (the last code commit; fed66bd825 after it
  changes only the plan): `web.kept-switch-8841`, `engine/keptswitch` and `server.autobalance-7152` 30 of 30; the
  guards for fixtures, Windows coupling, reachable modules and raw writes with the automove, usagepoll and
  automove-deps tests 177 of 177; earlier, at 59018dea97, every test that lifts the page's accounts painter 333 of
  333. The full suite runs in CI on the PR.
- **One browser check is owed.** `docs/browser-checks/render-autobalance-7152.js` was changed and NOT run: no browser
  check may run during a reservation, and it is not in the set a pull request runs. The page lines are also covered by
  a unit test that runs the painter. It must run on a free machine before the merge.
- **Reviewer brief.** The skill's template, plus: the worktree's absolute path, no file created in the worktree, no
  test or build run by the reviewer (the reservation), nothing changed on the live board. Later rounds named more code
  to read (the accounts route, the page painter, the Windows-coupling guard) and, in round 8, the record's states by
  the variables' values. Nothing was narrowed.
- **Origin column.** Set by reading which commit wrote the cited line, not by the skill's blame script.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 6 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (no loop commit existed yet)
- [WARNING] engine/keptswitch.js:83 — the log said "on" for a switch the brake held off --> FIXED (af3ac062a5): the line says it is held off; test on the exact text
- [WARNING] engine/keptswitch.js:68 — an unreadable record was rewritten with only this start's switches, losing the other --> FIXED (af3ac062a5): never written over
- [WARNING] engine/keptswitch.js:64 — the kept value was set in process.env, so every shell and test the board started would inherit it --> FIXED (af3ac062a5): kept in the module, for the board's own environment object; test with a copy
- [WARNING] engine/keptswitch.js:24 — widens a deliberate default with nothing on screen --> FIXED in part (af3ac062a5, then 59018dea97): Settings says when a switch is kept; the widening itself is the plan's first recorded decision
- [WARNING] engine/automove.js:8 — header comments said the variable alone decides --> FIXED (af3ac062a5)
- [WARNING] engine/keptswitch.test.js:121 — the board's call pinned by source text only --> FIXED in part (af3ac062a5, 59018dea97): one exported call with the live rule inside it, tested; a route test; the source pin kept for order (see iteration 3, 5, 7, 8)
- [NIT] empty value undocumented --> FIXED; [NIT] data root frozen at load --> FIXED; [NIT] the live rule repeats usagepoll's --> FIXED (moved into the module, with the reason)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the page line was written by iteration 1's fix)
- [WARNING] web/index.html:31188 — the page said "kept on" for a switch the brake held off --> FIXED (9aceb8768f): not listed while the brake holds it; test
- [WARNING] engine/keptswitch.js:85 — one `=1` start sticks for good, with no off switch on the page --> DEFERRED: the plan's first decision, on Liu Kang's direction for this part ("a restart should not silently undo the poll setting"); the off switch is `=0`, named in the log each time
- [NIT] one date for two switches; an invalid date --> FIXED (9aceb8768f): a line each, and no day when none can be said
- [NIT] a caller passing a copy of the environment reads off --> FIXED later (e7a58cacf0, a comment at each reader); [NIT] lazy require --> left

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above (the page line's place and wording came from iterations 1 and 2)
- [WARNING] web/index.html:31188 — the kept line showed only inside the auto-balance row, hidden with one account or with auto-balance off, where the poll still runs --> FIXED (59018dea97): its own place under the accounts, sent beside the decision; cases for both
- [WARNING] engine/keptswitch.js:66 — "automatic moves ... kept on" read as moves happening when the mover was not running --> FIXED (59018dea97, c1afe63d1a): the line says the switch is on, not that anything runs
- [WARNING] engine/keptswitch.test.js:153 — the call-site test could not see the order that matters; nothing showed `kept` reaching the page --> FIXED (59018dea97): position before the mover is made, and a route test
- [WARNING] engine/keptswitch.test.js:145 — the unwritable-record arm assumed chmod stops a write --> FIXED (59018dea97, then c1afe63d1a properly)
- [NIT] "through every restart since" not true in every state --> FIXED (c1afe63d1a); [NIT] data root read before the live check --> FIXED; [NIT] stale comments on the mover's switch --> FIXED; [NIT] the check's date depended on the viewer's time zone --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/keptswitch.js:100 — one `=1` start sticks --> duplicate of iteration 2's deferral
- [WARNING] engine/keptswitch.js:20 — the record sits in the data folder, which a backup takes, so a restore elsewhere would switch the poll on --> FIXED (cea0f311e1): the record is tied to the computer that wrote it
- [WARNING] web/index.html:31205 — the line could show where the board is not live --> DEFERRED: not an issue; nothing is kept unless the start was live, so the read has nothing to show (read at cea0f311e1)
- [NIT] lazy require; a silent catch beside its neighbours; a non-live start clears the kept state (correct) --> left

#### Iteration 5
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 3 of the above (the Windows branch, the host name and the failed-read control all came from earlier fixes)
- [BLOCKER] engine/keptswitch.test.js:160 — a bare win32 branch in a test file not in the Windows list turns the Windows-coupling guard red --> FIXED (c1afe63d1a): skipOnWin32 with its reason, the file in HOST_BRANCH_EXCLUDED, the guard run green
- [WARNING] engine/keptswitch.js:54 — a host name changes on a Mac, which silently switches a kept switch off --> FIXED in part (c1afe63d1a, b5b111e268): the name is compared without case or network suffix, and a record not applied is said in the log and on the page; what remains is the asked question below
- [WARNING] engine/keptswitch.js:95 — one `=1` start sticks --> duplicate of iteration 2's deferral
- [WARNING] docs/browser-checks/render-autobalance-7152.js:271 — the failed-read control could not fail --> FIXED (c1afe63d1a): two lines shown before the failed read
- [WARNING] engine/keptswitch.test.js:171 — source-text pin --> duplicate of iterations 1 and 3; the decision is in the plan
- [NIT] an odd value turned a kept switch off silently --> FIXED; [NIT] "another computer" said when the name could not be read --> FIXED; [NIT] "has stayed on since" --> FIXED (the page now describes the present)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0 of the above acted on as self-generated
- [WARNING] engine/keptswitch.js:32 — host name not stable --> duplicate of iteration 5
- [WARNING] engine/keptswitch.js:131 — switching on over a record from elsewhere drops the other switch it held --> DEFERRED: intended and already pinned (the record from elsewhere is not this computer's; test "a record written on another computer")
- [WARNING] engine/keptswitch.js:75 — a copy of the environment reads off --> FIXED (e7a58cacf0): a comment at each reader, naming the test
- [CONVENTION] tools/windows-tests.js:148 — the module ships on Windows boards and its test has not run on a Windows host --> left as the entry says; on Windows the board is never live here, so nothing is kept
- [NIT] lazy require; source pin; wording of the page lines --> left (wording settled in the plan)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 3 of the above (the host check, the not-applied flag and the plan's CI claim came from earlier fixes)
- [BLOCKER] engine/keptswitch.js:104 — `=0` did nothing to a record written under another name, so the usage poll came back when the name did --> FIXED (b5b111e268): an explicit off is honoured whatever name wrote the record; test with the name changing and changing back, and a control
- [WARNING] engine/keptswitch.js:45 — the raw host name compared exactly --> FIXED (b5b111e268): lower case, without the network's suffix; test
- [WARNING] docs/browser-checks/render-autobalance-7152.js:268 — the plan said CI runs the browser check; it is not in the set a pull request runs --> FIXED (b5b111e268): a unit test that runs the painter; the plan corrected; the check is owed a run
- [WARNING] engine/keptswitch.js:99 — a record this start replaced was still reported as not applied --> FIXED (b5b111e268)
- [NIT] the host name in plain text in a file backups take --> FIXED (a short hash); [NIT] the not-applied line gives nothing to do; the source pin; a comment's place --> left

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/keptswitch.js:34 — two computers can share a generic name, so a backup restored onto one keeps the switch --> ASKED (below). Checked the suggested fix: the install id is in the same data folder and travels with the same backup, so it tells nothing apart
- [WARNING] engine/keptswitch.js:58 — a name that changes drops the choice --> duplicate of iteration 5
- [WARNING] server.js:30318 — a later caller reading the switches before the start step would see off --> duplicate of the call-site finding; the position is pinned
- [NIT] `odd` missing from a doc comment; lazy require; the page line where the board is not live (the reviewer: no change needed) --> left
**Stopped here** under the eight-round rule. Not converged.

### Final Ledger (BLOCKERs and WARNINGs)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/keptswitch.js:83 | BRANCH | Log says on under the brake | FIXED | af3ac062a5 |
| 2 | 1 | WARNING | engine/keptswitch.js:68 | BRANCH | Unreadable record rewritten, other switch lost | FIXED | af3ac062a5 |
| 3 | 1 | WARNING | engine/keptswitch.js:64 | BRANCH | Kept value written into process.env | FIXED | af3ac062a5 |
| 4 | 1 | WARNING | engine/keptswitch.js:24 | BRANCH | Widened default, nothing on screen | FIXED | af3ac062a5, 59018dea97 (the screen); the widening is decided |
| 5 | 1 | WARNING | engine/automove.js:8 | BRANCH | Header comments out of date | FIXED | af3ac062a5 |
| 6 | 1 | WARNING | engine/keptswitch.test.js:121 | BRANCH | Call site pinned by text | FIXED | af3ac062a5, 59018dea97 (in part; decision in plan) |
| 7 | 2 | WARNING | web/index.html:31188 | SELF | Page says kept on under the brake | FIXED | 9aceb8768f |
| 8 | 2 | WARNING | engine/keptswitch.js:85 | BRANCH | One =1 start sticks | DEFERRED | Decided on Liu Kang's direction; raised again in 4, 5 |
| 9 | 3 | WARNING | web/index.html:31188 | SELF | Kept line hidden with the auto-balance row | FIXED | 59018dea97 |
| 10 | 3 | WARNING | engine/keptswitch.js:66 | SELF | Reads as moves happening | FIXED | 59018dea97, c1afe63d1a |
| 11 | 3 | WARNING | engine/keptswitch.test.js:153 | BRANCH | Order not asserted; no route test | FIXED | 59018dea97 |
| 12 | 3 | WARNING | engine/keptswitch.test.js:145 | BRANCH | chmod arm on root and Windows | FIXED | c1afe63d1a |
| 13 | 4 | WARNING | engine/keptswitch.js:20 | BRANCH | Record travels with a backup | FIXED | cea0f311e1 |
| 14 | 4 | WARNING | web/index.html:31205 | BRANCH | Line where the board is not live | DEFERRED | Cannot show: nothing kept unless live |
| 15 | 5 | BLOCKER | engine/keptswitch.test.js:160 | SELF | Windows-coupling guard red | FIXED | c1afe63d1a |
| 16 | 5 | WARNING | engine/keptswitch.js:54 | SELF | Host name changes | FIXED | c1afe63d1a, b5b111e268 (in part; see 23) |
| 17 | 5 | WARNING | docs/browser-checks/render-autobalance-7152.js:271 | SELF | Control cannot fail | FIXED | c1afe63d1a |
| 18 | 6 | WARNING | engine/keptswitch.js:131 | BRANCH | Switching on over a foreign record drops its other switch | DEFERRED | Intended, pinned by a test |
| 19 | 6 | WARNING | engine/keptswitch.js:75 | BRANCH | A copy of the environment reads off | FIXED | e7a58cacf0 |
| 20 | 7 | BLOCKER | engine/keptswitch.js:104 | SELF | =0 did not clear a record under another name | FIXED | b5b111e268 |
| 21 | 7 | WARNING | engine/keptswitch.js:45 | SELF | Raw host name compared exactly | FIXED | b5b111e268 |
| 22 | 7 | WARNING | docs/browser-checks/render-autobalance-7152.js:268 | SELF | Check not run by PR CI; plan said it was | FIXED | b5b111e268 (unit test; run owed) |
| 23 | 7 | WARNING | engine/keptswitch.js:99 | SELF | Replaced record still "not applied" | FIXED | b5b111e268 |
| 24 | 8 | WARNING | engine/keptswitch.js:34 | BRANCH | Same-named computers are not told apart | ASKED | See below |

### Outstanding questions (ASKED, still unresolved when the run ended)
- [WARNING] engine/keptswitch.js:34 — The record is tied to a computer by its name. A backup restored onto a second
  computer with the same name (a generic "Mac-mini", or a Mac set up by Migration Assistant) would keep the switch
  there, and the usage poll would send that account's subscription token to the undocumented endpoint with nobody
  having switched it on at that computer. --> ASKED of Josh, through Liu Kang (unanswered): is tying it to the name
  enough for this switch, or should it wait for an identity a copied folder cannot carry (the hardware id, which
  engine/computerprint.js forbids storing under a data root today)? My recommendation: accept it for now, because the
  same restored folder already carries the account logins themselves, and the page says when a switch is kept.

### NITs (non-blocking, left as they are)
- [NIT] engine/usagepoll.js:128, engine/automove.js:54 — the require sits inside the function (iterations 2, 4, 6, 8)
- [NIT] engine/keptswitch.js:116 — `odd` is not in the doc comment's return shape (iteration 8)
- [NIT] web/index.html — the not-applied line gives the person nothing to do (iteration 7); wording settled in the plan
- [NIT] server.js:30316 — a comment sits one block away from its code (iteration 7)
- [NIT] engine/keptswitch.test.js:178 — the call site is pinned by source text (iterations 5, 6, 7)

### Strengths (across all iterations)
- [STRENGTH] The default holds: a board nobody switched on writes no record and stays off, with a control (every iteration)
- [STRENGTH] The kept choice lives in the module, for the board's own environment object, and is proved both ways (iterations 2 to 8)
- [STRENGTH] A record that cannot be read is never written over; the brake wins everywhere; nothing is read, written or kept under a test, a dry run or without live execution (iterations 3 to 8)
- [STRENGTH] Every other reader of the two switches goes through `enabled()` or `movesOn()`, so nothing disagrees with the board (iterations 3, 5, 7)
- [STRENGTH] The plan says what was measured and what was inferred, each decision and what would change it, and the weakest part (every iteration)

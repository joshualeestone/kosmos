---
pre_challenge: true
method: challenge-loop
branch: taskwake-8669
diff_hash: 906098bae125c80a9551e0f3c840b7bda5b624e16317bf4a1e815eb8fc7223c2
validation: targeted lists only (175 files, 2310 tests, 0 fail, on the branch merged onto origin/main); full suite not run locally under the Mortals hold, CI runs it
subdir_audit: not run (no subdir CLAUDE.md changed)
timestamp: 2026-11-18T00:37:46Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the fleet's 8-round review cap (a standing fleet rule, with no BLOCKER open), after round 8's findings were fixed. No round reported a BLOCKER.
**Total findings:** 51 (0 BLOCKERs, 24 WARNINGs, 2 CONVENTIONs, 25 NITs)
**Fixed:** 19 WARNINGs, 13 NITs | **Deferred:** 5 WARNINGs and NITs with reasons below | **Asked:** 0

Validation note: the canonical validation helper runs the full suite, which Liu Kang's hold forbids on this box (m7609). Each round's fixes were validated with targeted test files instead, and the final gate was a targeted batch of 175 files on a temporary worktree of the branch merged onto current origin/main: 2310 tests, 2292 pass, 0 fail, 18 existing skips. Both browser-check gates (#2518, #1720) pass, and the new browser check render-task-wake-8669 passes 48 of 48, with a negative control that reds it.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0 of the above (no loop commit yet)
- [WARNING] engine/taskactphrase.js:120 — wake history kinds had no words in the CLI or page activity --> FIXED (919d12186b)
- [WARNING] install/kosmos:6289 — task wake help line split task ran from its options, both CLIs --> FIXED (919d12186b)
- [WARNING] engine/taskwake.js:274 — a branch 404 from a lost sign-in read as the branch removed --> FIXED (919d12186b: gone only when the repository answers)
- [WARNING] engine/taskwake.js:241 — a file wake took any absolute path; refusals told what exists; rows carried the fingerprint --> FIXED (919d12186b: home folder only, no hidden folders or Library, one refusal sentence, fingerprint stripped)
- [NIT] engine/taskwake.js:180 — gh stderr after stdout could break the reading --> FIXED (first line only)
- [NIT] web/index.html:72652 — new function split an existing doc comment from its function --> FIXED
- [NIT] engine/taskwake.js:410 — time wake tell words relative to setAt --> FIXED (relative to now)
- [NIT] engine/taskwake.js:83 — a pasted /files PR address refused --> FIXED
- [NIT] engine/taskwake.js:453 — fallback idle tracking only while a wake is owed --> noted for the real-board measurement
- [NIT] engine/tasks.js:1926 — board-written wake rows counted as activity --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION (none found), 3 NITs
**Self-generated:** 1 of the above (the link re-check, a code line from 919d12186b, fixed as code)
- [WARNING] engine/taskwake.js:203 — a link swapped in after set time was read --> FIXED (50abc6937c: re-checked on every look)
- [WARNING] engine/taskwake.js:288 — 64 MB hashed on the board thread --> FIXED (8 MB cap)
- [WARNING] engine/taskwake.js:354 — one hung gh delayed telling met wakes --> FIXED (tell before and after the look; GitHub reads four at once)
- [WARNING] engine/taskwake.js:495 — a holder briefly off the project spent the wake --> FIXED (held, not spent)
- [NIT] engine/taskwake.js:401 — branch woke words repeated themselves --> FIXED
- [NIT] install/kosmos:7437 — words with a quote or path with a tab mangled by the Mac CLI --> FIXED (node JSON read, tab refused)
- [NIT] engine/taskwake.js:437 — task sentence typed into a pane --> DEFERRED: plainWords folds it to one plain line, as repeatdue does

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 1 of the above (the plan's 64 MB line, prose the loop itself left stale; fixed by stating the constant)
- [WARNING] server.js:30344 — the tell wiring was not driven end to end by any test --> FIXED (592a84f930: server test through the real tick, red with the tell removed)
- [WARNING] .claude/plans/taskwake-8669.md:5 — plan weakened the card's done-when --> FIXED (plan says the minute is measured at QA on a real board)
- [CONVENTION] .claude/plans/taskwake-8669.md:23 — plan said 64 MB, code 8 MB --> FIXED
- [NIT] engine/taskwake.js:323 — hash read the unresolved path --> FIXED (reads the resolved path)
- [NIT] install/kosmos:7429 — tab refusal applied to every kind --> FIXED (file only)
- [NIT] install/kosmos:6743 — woke mark stayed on list lines after the tell --> FIXED (both CLIs, controlled)
- [NIT] engine/taskwake.js:190 — gone-branch second read not counted --> FIXED (comment states it)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION (none needed), 2 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/taskwake.js:402 — an unassigned task's wake told nobody --> FIXED (f3b61c9a6b: tells the agent that set it)
- [WARNING] engine/taskwake.js:176 — git/ref answers a list for a prefix branch name --> FIXED (branches route)
- [WARNING] server.js:27311 — status codes mapped from error words --> DEFERRED: the same mapping as the repeat route beside it, pinned by the server tests for 403 and 409
- [NIT] engine/taskwake.js:42 — header read as if busy holders were not handled --> FIXED
- [NIT] engine/taskwake.js:259 — a touch counts as a change for files over the hash cap --> DEFERRED: documented at the constant

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the Library check, a code line from 919d12186b, fixed as code)
- [WARNING] engine/taskwake.js:231 — ~/library (lower case) passed the Library rule on macOS --> FIXED (cdd5bd55a6: realpathSync.native and a case-free compare; test reds without it)
- [WARNING] engine/taskwake.js:274 — a macOS privacy refusal read as a generic refusal --> FIXED (its own sentence naming the setting)
- [NIT] engine/taskwake.js:212 — a file growing past the cap between stat and hash --> DEFERRED: a narrow race, bounded by the per-tick hash cap added in round 6
- [NIT] engine/taskwake.js:58 — SHA-256 commit ids refused --> FIXED
- [NIT] install/kosmos:6542 — a bare -- refused with different words on Windows --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] server.js:30375 — a 60 s tick could not hold "within a minute" --> FIXED (5651d91c2d: 30 s tick, 25 s per wake, GitHub reads kept to 20 wakes a minute)
- [WARNING] engine/taskwake.js:105 — "to merge" while a close also wakes --> FIXED ("to merge or close")
- [WARNING] engine/taskwake.js:375 — unbounded file hashing per tick --> FIXED (HASH_PER_TICK 4, rest next tick)
- [WARNING] server.js:27322 — what an agent may watch was not a decided posture --> FIXED (decision recorded in the plan)
- [NIT] engine/tasks.js:1008 — size and time left on rows --> FIXED
- [NIT] engine/taskwake.js:399 — woke subject derived from display text --> FIXED
- [NIT] engine/taskwake.js:461 — not-reached after three tries is final --> FIXED (recorded in the plan)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 6 NITs
**Self-generated:** 3 of the above (timing comments left stale by round 6's change; fixed by deleting the numbers and naming the constants)
- [WARNING] engine/taskwake.js:17 — header said once a minute --> FIXED (f4c6efac36: names CHECK_EVERY_MS)
- [WARNING] server.js:30336 — tick comment's timing and read counts wrong --> FIXED (names TICK_MS and checkTick's limits)
- [WARNING] server.js:27295 — route comment named functions that do not exist --> FIXED
- [NIT] install/kosmos:7451 — "looks once a minute" in both CLIs --> FIXED (timing dropped)
- [NIT] install/kosmos:6292 — usage said merges only --> FIXED
- [NIT] server.js:27326 — clear with a condition accepted --> FIXED (400, tested)
- [NIT] engine/taskwake.js:461 — a person's wake on an unheld task tells nobody --> FIXED (the row and page say so)
- [NIT] engine/taskwake.js:503 — markTold wrote an unchanged project back --> FIXED
- [NIT] engine/taskwake.js:262 — a privacy prompt may appear at set time --> DEFERRED: round 5's refusal sentence names the setting; warning before the read is the person-facing instructions' job
- [CONVENTION] engine/taskwake.js:57 — lazy require in plain() --> DEFERRED: a cached lookup, and lazy keeps tasks, taskwake and agentnudge out of a load cycle

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/taskwake.js:331 — a transient missing file spent the wake as removed --> FIXED (375867c4e7: two misses in a row; a found file forgets the miss)
- [WARNING] engine/taskwake.js:394 — board memory kept for wakes gone while nothing was pending --> FIXED (the look runs to forget)
- [NIT] engine/taskwake.js:178 — SSO words read as not signed in --> DEFERRED: display only
- [NIT] engine/taskwake.js:411 — local looks one at a time --> DEFERRED: bounded by HASH_PER_TICK and the 8 MB cap
- [NIT] engine/taskwake.js:482 — tell words not passed through plain --> FIXED

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/taskactphrase.js:120 | BRANCH | wake kinds had no activity words | FIXED | 919d12186b |
| 2 | 1 | WARNING | install/kosmos:6289 | BRANCH | help line misplaced | FIXED | 919d12186b |
| 3 | 1 | WARNING | engine/taskwake.js:274 | BRANCH | branch 404 read as removed | FIXED | 919d12186b |
| 4 | 1 | WARNING | engine/taskwake.js:241 | BRANCH | any path watchable | FIXED | 919d12186b |
| 5 | 2 | WARNING | engine/taskwake.js:203 | SELF | link swapped after set | FIXED | 50abc6937c |
| 6 | 2 | WARNING | engine/taskwake.js:288 | BRANCH | large hash on board thread | FIXED | 50abc6937c |
| 7 | 2 | WARNING | engine/taskwake.js:354 | BRANCH | hung gh delayed tells | FIXED | 50abc6937c |
| 8 | 2 | WARNING | engine/taskwake.js:495 | BRANCH | off-project holder spent wake | FIXED | 50abc6937c |
| 9 | 3 | WARNING | server.js:30344 | BRANCH | tell wiring untested | FIXED | 592a84f930 |
| 10 | 3 | WARNING | .claude/plans/taskwake-8669.md:5 | BRANCH | plan weakened done-when | FIXED | 592a84f930 |
| 11 | 3 | CONVENTION | .claude/plans/taskwake-8669.md:23 | SELF | plan said 64 MB | FIXED | 592a84f930 |
| 12 | 4 | WARNING | engine/taskwake.js:402 | BRANCH | unassigned wake told nobody | FIXED | f3b61c9a6b |
| 13 | 4 | WARNING | engine/taskwake.js:176 | BRANCH | prefix branch name | FIXED | f3b61c9a6b |
| 14 | 4 | WARNING | server.js:27311 | BRANCH | status from error words | DEFERRED | same as repeat route, tested |
| 15 | 5 | WARNING | engine/taskwake.js:231 | SELF | lower-case library passed | FIXED | cdd5bd55a6 |
| 16 | 5 | WARNING | engine/taskwake.js:274 | BRANCH | privacy refusal unnamed | FIXED | cdd5bd55a6 |
| 17 | 6 | WARNING | server.js:30375 | BRANCH | minute bound not held | FIXED | 5651d91c2d |
| 18 | 6 | WARNING | engine/taskwake.js:105 | BRANCH | merge wording vs close | FIXED | 5651d91c2d |
| 19 | 6 | WARNING | engine/taskwake.js:375 | BRANCH | unbounded hashing | FIXED | 5651d91c2d |
| 20 | 6 | WARNING | server.js:27322 | BRANCH | watch scope undecided | FIXED | plan decision |
| 21 | 7 | WARNING | engine/taskwake.js:17 | SELF | header timing stale | FIXED | f4c6efac36 |
| 22 | 7 | WARNING | server.js:30336 | SELF | tick comment stale | FIXED | f4c6efac36 |
| 23 | 7 | WARNING | server.js:27295 | SELF | route comment names wrong | FIXED | f4c6efac36 |
| 24 | 7 | CONVENTION | engine/taskwake.js:57 | BRANCH | lazy require | DEFERRED | avoids a load cycle |
| 25 | 8 | WARNING | engine/taskwake.js:331 | SELF | transient miss spent wake | FIXED | 375867c4e7 |
| 26 | 8 | WARNING | engine/taskwake.js:394 | SELF | stale board memory | FIXED | 375867c4e7 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
Listed per iteration above; deferred ones carry their reason there.

### Strengths (across all iterations)
- Looking and telling are separate halves keyed on the wake's setAt, so a restart, a re-set wake or a slow look never tells twice or for a stale wake (iterations 1 to 8).
- Inputs reach gh as an argument array with no shell, validated first; file wakes follow links and are re-checked on every look; one refusal sentence; path, fingerprint, size and time stay off page rows (iterations 2, 5, 7, 8).
- Tests can fail: negative controls reddened the engine, server, CLI, page and browser-check tests for each main behaviour (iterations 3, 5, 6).

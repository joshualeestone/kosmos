---
pre_challenge: true
method: challenge-loop
branch: dmbusy-2660
diff_hash: 16648b6daa742b64aa5633d8ae97e35e72a0265ef270b895b6e526945722522a
timestamp: 2026-09-10T21:16:56Z
iterations: 3
converged: true
---

# Challenge-loop proof: dmbusy-2660 (kosmos#2660)

Josh: *"I'll get a reply and then it will show the little thing that says the
agent is working. It'll last for a few seconds and then go away."*

## 🛑 That sentence was already in this repo

**#1150 fixed it, for the ROOM.** The dialog box is the surface that fix never
reached. Two working lines were deliberately built to share their markup
(`busyRow`) and the one word that carries the claim (`WORKING_VERB`), and the
correctness filter went to one of them.

⭐ **The question that finds this class is "which surfaces have NO guard", not
"where else does the defect appear".**

Full design record and every round's findings:
`.claude/plans/dmbusy-2660-20260910.md`.

## The mechanism

Both paint in the **same tick**: `paintTalk` fires an async thread fetch, then
`paintBusy` runs **synchronously** off the snapshot that tick already holds. On
the tick an agent finishes, the snapshot still reads `working`, the line asserts
it, and the reply renders underneath.

## 🛑 The room's fix could not be copied

It reads a map whose seeding is keyed on the open **PROJECT**, and a dialog has
none. Lifting it verbatim would compile, read as correct, and filter nothing.
**A guard that always misses is indistinguishable from no guard, and it reads as
fixed.**

## Iterations: 3, converged

| round | found | kind |
|---|---|---|
| 1 | the stamp block untested and the fix inert-able; seeding on a failed read; a stale cache seeding the wrong agent; an unpinned boundary; a conditionally-true justification | instrument + product + prose |
| 2 | the fold left an orphaned comment | prose |
| 3 | **NO NEW ISSUES** | converged |

⭐ **The diagnosis was the hard part; the code is about twenty lines.**

## Verification at convergence

- `bash tools/run-tests.sh`: **exit 0, 5804 tests, 5804 pass, 0 fail, 0 skipped**,
  zero FAIL lines, carried through to the SHELL gates rather than stopped at the
  node tally. Browser-check surface gate and bc-surface-map both **0 FAILED**.
- `render-busy-line.js` under real Playwright: **exit 0**, with three new rendered
  arms (stale working hidden, fresh working shown, auth_failed still shown).
- `web.typing-order-1150.test.js`: **8/8** from the repo root.
- Mutation controls, each redding only its own arm:

  | mutation | result |
  |---|---|
  | make the stamp inert (`learnedAt: 0`) | **red**, the stamp arm. Before round 1 this was **green** |
  | seed even on a failed read | red, the stamp arm |
  | `>` becomes `>=` | red, the boundary arm |
  | drop the staleness filter | red, the staleness arms (unit and rendered) |
  | filter swallows `auth_failed` | red, the #874 arm |

- Round 3 **independently reproduced** the inert-fix and boundary mutations
  rather than taking them on trust, and confirmed the script still parses.

## Residuals, stated rather than hidden

- `DM_SPOKE_AT` / `DM_SPOKE_SEEDED` are never deleted from. **So are the room's.**
  Bounded by agent count; a stale entry goes inert as the snapshot advances past
  its `learnedAt`, and a later reply re-stamps it.
- The room's line still has no visibility of a DIALOG reply, so a stale
  `working` can survive there after a DM. **Pre-existing** (the room's guard was
  always room-only) and not widened by this card.
- One deliberate divergence from the room: it PRESERVES an existing `learnedAt`
  when re-stamping unseeded; this writes 0. Equivalent today (one key, one call
  site) and not equivalent by construction.
- **Weakest premise:** that "dialog boxes" means the agent panel rather than the
  room. Read that way because the room already has the fix and the symptom
  persists. If he means the room, this is a regression in the existing filter
  instead, which is a different investigation.

## Review output, per iteration

#### Iteration 1: 3 WARNING, 2 NIT

[WARNING] 🛑 THE STAMP BLOCK HAD ZERO COVERAGE AND THE WHOLE FIX COULD BE MADE INERT WITH EVERY TEST GREEN. Measured: replacing `learnedAt: seededThread ? Date.now() : 0` with `learnedAt: 0` turns the shipped fix into a no-op, and the six arms stayed 6/6. The arms drove `paintBusy` with a HAND-SUPPLIED map, and the browser check set the map by hand too, so both tested the READ side. Nothing touched the WRITE side, which is the half that decides whether the read ever fires. ⭐ A fix with two halves needs a test per half, and "the tests pass" said nothing about one of them. Fixed with an arm that SLICES the real block out of the shipped source, the technique the room's own seeding test uses for the stated reason: a retyped copy tests this file's version of the logic, which is how a defect ships under a green test.

[WARNING] A FAILED READ SEEDED THE THREAD. The route answers 200 with `messages: null` when a thread read fails, so an unguarded seed marked it known-with-zero-rows; the next poll's real backlog then read as all-new and blanked the working line for a poll on a genuinely working agent. That is the HIDE direction, the one this branch exists not to fail in. Gated on `Array.isArray(body.messages)`.

[WARNING] A STALE CACHED THREAD COULD SEED THE WRONG AGENT. `__lastBody`/`__lastName` were assigned on every paint and cleared nowhere, and the search input repaints from them: typing after an agent switch, before the new fetch resolves, ran the painter with the previous agent's body while `CURRENT` was the new one. Rows were dropped correctly; the SEED still fired.

[NIT] The boundary was unpinned: every arm used SNAP plus or minus one, so `>` and `>=` were indistinguishable.

[NIT] The separate-map justification was ONLY CONDITIONALLY TRUE. It said reusing the room's map could not seed; keying its set on the session would seed fine. The load-bearing reason is that `ROOM_SPOKE_AT` is keyed on the SPEAKER GLOBALLY, so a dialog stamp would suppress the ROOM's line too.

[STRENGTH] The round mutation-tested rather than reasoned, which is what surfaced the inert-fix finding at all.

#### Iteration 2: 1 WARNING

[WARNING] THE FOLD TOOK THE CODE AND LEFT THE COMMENT. Two near-identical blocks: one attached to the clear, and an orphan six lines later above unrelated statements. ⭐ An orphaned comment does not read as leftover, it reads as DOCUMENTATION OF WHATEVER IT LANDS ON, and this one landed on something: a reader would have believed those lines cleared the cache. Sixth instance of one class this shift, and the first that got there by moving the code rather than by describing the wrong thing.

[STRENGTH] It independently reproduced the inert-fix mutation against the sliced-block arm, confirming the harness genuinely drives the shipped block rather than a copy.

[NIT] It recorded the seed guard's backend behaviour as unverifiable ("no backend route source in this worktree"). `server.js` is in the worktree root, and the `[]` versus `null` distinction is the whole load-bearing property of that guard. Answered and stated. ⭐ A gap recorded as "cannot check" is worth one grep before it is believed. The reviewer acknowledged the miss.

#### Iteration 3: No issues found

No issues found.

[STRENGTH] It independently reproduced BOTH mutations rather than trusting them, confirmed the script still parses after the diff, and answered the question that mattered most: a genuinely working agent cannot stay hidden longer than one poll, because `LAST_AT` advances unconditionally every 5s and is never paused while a dialog is open. It also confirmed the clear runs unconditionally on every open, synchronously after `CURRENT` is set and before the async fetch, which is what actually closes the race.

#### Self-inflicted, between rounds

[NIT] A `const th0` collision, a name already taken in that scope, stopped the ENTIRE script parsing. It surfaces as `paintBusy is not defined` with the browser check dead and two unrelated web tests red, which reads as a missing function rather than a syntax error. Caught by the browser check plus a parse of the script blocks, not by reading. ⭐ Asking why the name was taken then produced the better fix: the block that owns that element was already there, so the clear belonged in it rather than in a second lookup two lines away.

[NIT] `git checkout -- web/index.html`, used to revert a mutation on an UNCOMMITTED file, discarded the fix along with it. Recovered from the edit scripts. ⭐ The habit that replaced it: commit before mutation-testing, and back the file up rather than trusting a revert.

### Final Ledger

3 iterations, converged. 3 WARNING, 4 NIT, 3 STRENGTH. All addressed or explicitly accepted with reasons above. The DIAGNOSIS was the hard part and the code is about twenty lines; review found almost nothing about behaviour, and round 1's real prize was that the fix could be made inert with every test green. Suite at convergence: exit 0, 5804 tests, 5804 pass, 0 fail, 0 skipped, zero FAIL lines, both shell gates 0 FAILED. Browser check exit 0 under real Playwright with five measured mutation controls.

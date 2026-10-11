---
pre_challenge: true
method: challenge-loop
branch: dmolder-5841
diff_hash: 8d5ed044a92d8d619f6aa39bb7b0bfbbad5a123a858167cf7e7f557f3da6ad13
validation: passed
subdir_audit: passed
timestamp: 2026-10-11T17:02:09Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8, alternating opus (odd) and sonnet (even).
**Converged:** Yes. Iteration 8 (sonnet) raised NITs only.
**Design change:** in iteration 3 the earlier rows moved from a second box INTO the thread. Seven warnings shared one cause: the box missed every rule and handler keyed on #d-dmthread, and it left a gap.

**Validation:**
- Full `tools/run-tests.sh` on Mortals at bd27ce5f1: clean, hash 8d5ed044a92d, base 0bfeb143.
  - Node suite: 19141 tests, 18898 pass, 0 fail.
  - The shell suite passed.
  - The surface gate accepted 16 overrides, each citing a green run.
- Run 1, at 299b74717, failed 3 tests. All three were guards this branch tripped:
  - SITE_COUNTS had no line for the new check;
  - web.dm-badge-2863 reads the first 1800 characters of paintTalk;
  - web.typing-order-1150 runs the DM stamp block on its own.
  All three were fixed in 640020db2.
- The 16 existing checks that assert d-dmthread or msg ran green on this branch: 1497 PASS, 0 FAIL.
- The new check, render-dm-earlier-5841, passes 20 of 20.

**Mutants** (each failed the named arm):

| Removed | Arm that failed |
|---|---|
| the gap fill | the gap arm |
| earlierOn's session check, plus the reset | the cross-agent arm |
| the reset alone | the come-back arm only; isolation does not rest on the reset |
| the shrink test's readable-answer guard | "survives a failed poll" |
| the tail guard | "shows the failure" |
| the name gate | the borrowed-name test |
| the older route's guide mask | the mask test |

### Per-Iteration Breakdown

#### Iteration 1 (opus)
**BLOCKER:** another agent's earlier rows could stand under the next agent's name. FIXED: a reset before any await.

**WARNINGs:**
- The button was rebuilt on every poll, which took focus. FIXED: the button is static.
- The earlier rows missed the thread's CSS and handlers. FIXED (first pass); superseded by the iteration 3 redesign.
- Reply heads used the wrong lookup. FIXED.
- Hide then Show during a load drew the page twice. FIXED: the opening counter.
- The gate test never reached the gate. FIXED: a borrowed-name arm.

#### Iteration 2 (sonnet)
**WARNINGs:**
- The read-only conversion left handlers that match by class. FIXED (removed); superseded by iteration 3.
- Labels were lost. FIXED.
- Focus was dropped on open and on hide. FIXED.

#### Iteration 3 (opus)
**WARNINGs:**
- A gap appeared while the earlier rows were open. FIXED: earlierFillGap.
- Attachments, menus, the phone squeeze, missing styles, pressable-looking spans, focus lost on More: REDESIGNED, the earlier rows now go in the thread.
- An arm for held messages could not fail. Moot after the redesign.

#### Iteration 4 (sonnet)
**BLOCKER (mine):** restoring web/index.html from a newer main carried in #5836's wording. FIXED: merged main.

**WARNINGs**, all FIXED:
- read-aloud spoke old rows
- a reaction on an earlier row was lost on rewrite
- the earlier rows were off-screen above
- a failed latest read was hidden under old rows
- edge cases in the gap fill

#### Iteration 5 (opus)
**WARNINGs**, all FIXED:
- the read-fails arms could not fail
- one failed poll closed the earlier rows
- a late load painted over the failure note
- scrollIntoView moved the whole page
- a comment and the plan overclaimed

#### Iteration 6 (sonnet)
**WARNINGs**, both FIXED:
- "starts closed" was overstated
- a press in the switch window acted for the old agent

#### Iteration 7 (opus)
**WARNINGs**, both FIXED:
- the line contradicted the failure note
- an answer was not checked against the range asked for

#### Iteration 8 (sonnet)
NITs only. **CONVERGED.**

### Not covered by a check (said plainly)
- the read-aloud pause
- the thread scroll (the harness's thread does not scroll)
- a reaction kept on an earlier row

Review read all three; none was measured.

### NITs (not taken)
- the poll's cost with a long thread open
- the roster read for the guide check on each older page (parity with the thread route)
- the "latest N" count includes synthetic rows (this predates the change)
- a margin of 9 characters in web.dm-badge-2863's window

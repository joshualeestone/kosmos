---
pre_challenge: true
method: challenge-loop
branch: asb-hosted-3660
diff_hash: 36145bb873b1d075db8461e3fcb217d9487e4fac6f0b1743629472ef8695b97e
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T11:07:33Z
iterations: 12
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 12 (blind reviewers, alternating opus and sonnet)
**Converged:** Yes (iteration 12 had nothing at WARNING or above; two NITs left, reasons below)

Each iteration's findings and fixes are in .claude/plans/asb-hosted-3660.md, under "Review iteration N". In short:

#### Iteration 1 (opus)
- [BLOCKER] Hosted must also mean no model of their own. Fixed: hostedOffered, on both GET and POST, with H13.
- [WARNING] Focus on a 501, a stale line on the move to a guide, and 501 once per session. Fixed.
#### Iteration 2 (sonnet)
- [WARNING] not-guide left hosted stale. Fixed, H14.
#### Iteration 3 (opus)
- [WARNING] A late answer painted over a guide, timers closed a guide's chat, and a switch hid a focused panel. Fixed, with H16 and H17.
#### Iteration 4 (sonnet)
- [BLOCKER] The step-aside flipped state before its reopen check. Fixed, H9c.
#### Iteration 5 (opus)
- [WARNING] A folded refusal went unseen, the note hid that words leave the Mac, and H8 could not fail. Fixed, H18.
#### Iteration 6 (sonnet)
- [BLOCKER] A waiting refusal reached a guide's chat. Fixed, H19.
#### Iteration 7 (opus)
- [WARNING] x4: own_model cut short, Send locked on a guide, 'unchecked' unreachable, stale after first run. The timers were REDESIGNED into a visibility grace, and H20 added.
#### Iteration 8 (sonnet)
- [BLOCKER] An opened refusal was closed by the guide confirm. Fixed.
- [WARNING] A fold lost the sentence. Fixed.
#### Iteration 9 (opus)
- [WARNING] x3: the timer was the only exit, a withdrawal vanished, and H19 could not fail. The TIMER was REMOVED (closing is reading), and H21 added.
#### Iteration 10 (sonnet)
- [BLOCKER] A folded withdrawal vanished. Fixed, H22 plus the H22b control.
#### Iteration 11 (opus)
- [WARNING] x3: two sentences that could lie, and no announcement of the reason on open. Fixed, with H10b, H18, H23 to H26.
#### Iteration 12 (sonnet)
No BLOCKER or WARNING.
- [NIT] hostedOffered is a tested wrapper with no production caller. Left: it is the named boolean the unit arms pin.
- [NIT] Copy phrasing. Left: iteration 11 settled it, and H2 pins it.

## Controls
Every fix above was checked with its guard removed, and the named arm failed. The list is in the plan.

## Validation
- Full suite clean: 9,153 tests, 0 failed (hash 36145bb873b1d075db8461e3fcb217d9487e4fac6f0b1743629472ef8695b97e).
- One earlier run went red on engine/feedbacksend's timing test at a load of 14.6 on 10 cores. That file is untouched by this branch, and it passed 3 of 3 alone.
- render-assistant-hosted-3660: 96 arms. render-assistant-bubble-3034: 54. render-agentdm-3414 green.

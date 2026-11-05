# wallrescue-8048: the mover can move an agent already stopped at its limit

Card: kosmos#8048 (item 2, the rescue half). Ruling: Josh 10-13, 10-25 (#7152), 11-05 11:35, "nobody runs out".

## Problem (measured on 11-05)
Sonya Blade and Sub-Zero sat at a weekly limit on Mortals for ten hours. Even with the sweep and mover armed,
autobalance.movableFor only passes agents whose card reads idle (assigner.idleCard). An agent at the wall reads
rate_limited, so the mover could only ever act before the wall, never at it.

## Change
engine/autobalance.js movableFor: an agent that assigner.limitedCard accepts (ours, rate_limited, a DATED reset more
than 10 minutes away) is movable even though it is not idle, and its open work and commitments do not hold it. The
unsent-words check and the guide check still apply. Optional nowMs, so a test can pin time.

Why limitedCard and not a new test: it is the Assigner failover's own rule (#5382), already reviewed for the hard
cases (an old limit line left on an idle screen, Codex/Gemini lines nothing clears, undated five-hour limits).

## What it does not do
- No change to who is a target, the 90% risk line, the 6 h reset rule, or the mover's rules (two ticks, re-check,
  holds, the works-again watch). The re-check before a move reads the same movableFor, so it agrees.
- Does not answer the limit dialog. The move restarts the session on the new account.
- Does not arm anything: the switches are a deploy step (card comment, after the 0.7.92 hold).

## Weakest premise
That the move's restart cleanly leaves the limit dialog and the moved agent resumes; reasoned from accountmove, not
measured on a real limited agent. The first real move on Mortals is the measurement (skills and hook checked too).

## Tests
engine/autobalance-7152.test.js: a dated weekly limit holding work and a commitment is movable; CONTROL the same idle
agent is not; undated, past reset, unsent words, guide, not ours are not; decide() names the move. Both halves of the
change, removed one at a time, turn the first assertion red.

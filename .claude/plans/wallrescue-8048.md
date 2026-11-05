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

## As built after eight review rounds (the sections above are the first cut)
- engine/autobalance.js: stoppedAtLimit(card) = assigner.limitedCard, not a remembered reading, not a switched-off
  swarm. movableFor lets such an agent through after the unsent-words and guide checks, before commitments and open work.
- engine/automove.js:
  - remembers when each would-move was first seen at its limit (limitSeenAt), cleared on every early return;
  - a move off the limit needs two sightings at the limit;
  - it is skipped ("it was working again", said once an hour) when the agent reported a tool call after the first
    sighting (deps.workedAt);
  - the move's message says the agent had stopped at its limit and the restart ended anything running, and names
    its commitments: current as they are, stale with their age, future-dated not at all, never an entry with an @,
    at most five, read before the move.
- server.js: the report route keeps a 'tool' activity marker, written only for the hook's PreToolUse report
  ("running <tool>", auto); automoveDeps.workedAt reads it. A prompt reaching a stuck agent writes 'working', not 'tool'.
- Measured: the incident's two agents hit a weekly limit that reset 50 h later (their account-d transcripts), which
  Claude Code prints dated, so this branch would have moved both.
- Residuals: a weekly limit under 24 h from reset (undated) is not reached; an agent that recovered before its first
  sighting and runs no new tool, or has no report hook, can be moved; Settings copy and four lows are #8056.

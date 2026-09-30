# holdnothing-4552: the Assigner could never give work on a real board (kosmos#4552)

## Found (April's live check, 2026-09-29)
engine/assigner.js gave work only to an agent whose commitments record read `clear`, and nothing shipped writes
that record (only an agent's own PUT, which nothing makes). Every real agent read `unknown` (neverReported), so the
Assigner never acted. Her positive control: writing {"commitments":[]} by hand made it give the task 20 min later.

## Decision (reversible): drop the requirement for an equivalent signal, decided at check time
The Assigner treats an agent as free by commitments (assigner.commitmentsFree) when its record is stated clear, or
nothing is stated: never reported, or the last stated list was empty and has only aged (commitments.read now marks
that `stale: true`, a field, so it is told apart from unreadable without matching prose). Not free: a list naming
work, fresh or stale; a record that exists but cannot be read; a record dated in the future. The other two
conditions are unchanged: the board card reads idle (idleCard), and no open task part (hasOpenWork). Nothing is
written in the agent's name, and nothing decays.

## First design, withdrawn after review round 1
Round 1 was on a first build that WROTE {"commitments":[]} from the report route on every recorded idle report.
It found two blockers, both real:
- the written list outlived the idle moment: after the Assigner gave a task (at minute 20 of the 30-minute clear
  window), the record still said "holding nothing", so the task card read "says it is not on this" and the restart
  dialog read "not part way through anything" for about ten minutes, in the agent's name;
- idle reports fire once per turn, so the record went stale 30 minutes after the last turn and an agent idle
  overnight still never got a morning task.
Both come from writing a derived fact into a store whose whole rule is "an empty list only counts as an assertion".
The redesign writes nothing, so neither can happen.

Said plainly (review round 3): on a real board today this acts like dropping the commitments gate, because nothing
shipped writes the record, so every real agent reads never-reported and is free. The gate still refuses an agent
that has stated work, but no shipped path lets an agent state it. The card rejected dropping the gate "so a restart
cannot hand new work to an agent holding unreported work"; that protection never worked on a real board, since the
same missing writer that stopped the Assigner also means no work was ever reported. The Assigner is on by default.
Also rejected: writing the record (above); a CLI verb or instruction the agent must remember (the same never-fires
failure).

Uneven over time, on purpose: a never-reported agent is free for as long as it stays idle, while one that once stated
a list naming work stays not-free until it reports again, however long ago that was. The cautious direction.

Weakest premise: an agent that stopped mid-promise without ever stating it, whose card reads idle and which holds no
task part, is now free for new work (it was never given any before). The concrete common case (review round 3): an
agent sitting at its prompt while a background shell job runs (a CI watch, a loop) reads idle, because status.js
reads only the "Waiting for N background agent" line as working. After 20 minutes it would be given a task. How to
observe it after release: the server log's `assigner:` lines, checked against agents that had a background job
running. What would change my mind: a promise or a background job dropped because the Assigner handed the agent
something else.

## Verified
- engine/assigner-free-4552.test.js, the runner's own tick over real cards, the real commitments reader and real
  projects/tasks: never reported is given the task (April's case); an empty list gone stale overnight is given it;
  a stated list, fresh and stale, is not (control: stating nothing then is); an unreadable record is not (control:
  removed, it is); a future-dated record is not; nothing is written in the agent's name; commitmentsFree truth table.
- Mutations: restoring main's clear-only rule reds 5 tests (the control that the current code gives nothing); dropping
  the never-reported clause, the stale clause, loosening stale to any list, treating any unknown or holding as free:
  each reds tests.
- Related suites green: assigner (32), commitments (65), assigner-give-3595 (6), recommender-assigner-2619 (13).
- Not yet measured: a live board after release (April's run, without the hand-written record).

## Challenge loop
### Iteration 1 (opus): on the first design; its two blockers are the reason for the redesign (see above).
### Iteration 2 (sonnet)
- WARNING decided, intended: the same "free" set feeds the phase-3 goal ask, so a never-reported idle agent with
  nothing to give is now also asked to draft tasks toward a project goal. It is the same "no work" judgement and
  Josh's spec is about agents continuing to work. Tested, with a control that an agent holding stated work is not.
- CONVENTION fixed: the server's Assigner runner comment said "commitments read clear"; it now names commitmentsFree.
- NIT taken: a direct step test that 'free' is given like 'clear', with 'unknown' still not given.
- NIT noted: future-dated with a non-empty list falls to not-free by the same path as the tested empty one.
### Iteration 3 (opus)
- BLOCKER fixed: the Settings hint said the Assigner gives work to an agent that "has recently said it is holding no
  work"; the main case is now an agent that never said anything. Now "has not told Kosmos it is still holding work".
- WARNING fixed in the plan: said plainly that this acts like dropping the gate on a real board today, and named the
  background-shell-job case as the concrete weakest premise with how to observe it.
- CONVENTION fixed: commitments.js names the Assigner as the one deliberate exception to "unknown is never safe".
- CONVENTION fixed: the future-dated arm now has its control (present-dated empty list is given).
- NITs taken: future-dated added to the Assigner's "does not" list; the uneven-over-time rule stated in the plan.
### Iteration 4 (sonnet): CONVERGED
- No BLOCKER, WARNING or CONVENTION. NITs noted: the long tick line; the commitments header's "every other reader"
  (checked: no other reader of stale or neverReported); the residual risk (already the weakest premise; note the
  reviewer called the setting off by default, but it is ON when never configured, assigner-setting.js).

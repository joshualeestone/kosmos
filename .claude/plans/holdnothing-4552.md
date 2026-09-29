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

Rejected: writing the record (above); dropping the commitments gate entirely (an agent that stated work would be
given more); a CLI verb or instruction the agent must remember (the same never-fires failure).

Weakest premise: an agent that stopped mid-promise without ever stating it, whose card reads idle and which holds no
task part, is now free for new work (it was never given any before). That is the card's point and April's measured
fix. What would change my mind: a promise dropped because the Assigner handed the agent something else.

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

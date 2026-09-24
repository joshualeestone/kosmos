# Sub-plan: #3595 phase 3, Assigner goals to tasks

Author: April, 2026-09-24. Branch `assigner-goals-3595`.
**Master plan:** `.claude/plans/recommender-assigner-3595-2026-09-24.md` (build order item 3).
Phase 1 (Recommender) merged as #3617; phase 2 (Assigner idle-assign) merged as #3627.

## What this branch builds
When an agent is idle for assignment (phase 2's rules: ours, reads idle, commitments clear, no open
work, for `IDLE_MS`) and phase 2 has **nothing to hand it**, and one of its live projects has **no
open tasks at all** and a **goal** in its BRIEF.md, Kosmos asks that agent, once, in its pane, to
draft up to 3 tasks toward the goal with `kosmos task add`. The agent's new tasks are unassigned,
so phase 2 gives it the first one on a later tick. No goal means no ask: Kosmos never invents work.

## Where the goal comes from
- Only BRIEF.md's `## Goal` section (the heading `engine/projects.js` seeds), up to the next `## `
  heading. No goal is read from anywhere else.
- A missing file, a missing section, an empty section, or the seeded placeholder
  (`BRIEF_GOAL_PLACEHOLDER`) is NO goal.
- Read safely: `lstat` first and refuse anything that is not a regular file (a symlink is refused),
  cap the read at 64 KB, and trim the goal to 500 characters for the pane line.

## Decisions (each reversible in one commit)
- **The ask has its own memory and caps, separate from assignments.** Charging it to the
  1-per-agent-per-hour assignment cap would block the very assignment it sets up for an hour.
  Instead: at most once per project per 24 hours (`GOAL_ASK_MS`), and at most 3 asks per hour
  across the fleet (`MAX_ASKS_PER_HOUR`), and at most 1 per agent per hour. Two idle agents in one
  project: only one is asked.
- **"No open tasks" is its own check**, not "pick found nothing": a project whose open tasks are
  all taken already has work, and is not asked about.
- **The line is marked as Kosmos's and quotes the goal as text written in BRIEF.md**, not as the
  person's words: anyone on the project, agents included, can edit the brief, so it is given no
  more authority than that. Double quotes in the goal become single quotes, so it cannot close its
  own quotation and continue in Kosmos's voice.
- **It says Kosmos will give the first task**, rather than "take the first": there is no CLI verb
  for an agent to assign itself, and phase 2 does it on the next tick.
- **Same switch as phase 2** (the Assigner). The label "Turn your goals into assigned work" is now
  true; the hint gains one sentence for this behaviour.
- **An ask that reaches nobody (COULD_NOT) is tried again after 10 minutes**, not a day later and
  not every minute, and it keeps its hourly charge so a refusing pane cannot loop; UNCONFIRMED is
  remembered for the full day (a re-send could duplicate it).
- Weakest premise: that a goal written in BRIEF.md is specific enough for an agent to draft useful
  tasks. The agent's standing rule (defaults.js: never invent work) still applies, so a vague goal
  should produce "nothing to add", not busywork.
- What would change it: rooms showing agents drafting low-value tasks from vague goals; then the
  ask needs a stricter trigger (for example the "Done looks like" section filled in too).

## Verification
- Unit tests on the goal parser (heading variants, placeholder, empty, next-heading boundary) and
  the safe reader (symlink refused, oversize refused, missing file).
- `engine/assigner.test.js`: the ask on real cards, commitments, projects, tasks and a real
  BRIEF.md written into the project folder; every guard proven by removing it.
- `tick` on real reads with the goal reader injected; the server wiring passes the real reader.
- Browser check updated for the hint sentence.

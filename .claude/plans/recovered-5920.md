# recovered-5920: a late recovery keeps the misses before it; each run has until the next is due (kosmos#5920)

From a user feedback report: a recurring monitor hit a provider error, a retry held the agent for hours, and the
scheduled runs after it never ran, with nothing to show they were missed. Reproduced on main a3f74299 (on the card):
the board counted the misses while the retry was open, then the recovering run moved lastRunAt past them and they
vanished from the count and the history, leaving one "late" row.

## The record (board side)
- engine/taskrepeat.js `skippedBefore(t, at)`: the slots missedRuns counts at `at`, less the one the run answers
  (answeredSlot, the rule runIsLate uses). `firstUnanswered` is shared with missedRuns, so the two start from the same
  slot.
- engine/tasks.js `recordRun`: measured on the task as it was, kept as `lastRunRecovered` { missed, from, to, more } and
  on the run's history row (`missedBefore`, `missedMore`). A rule change or clear drops the mark.
- web/index.html: the repeat line and the history row say "after N missed runs"; a recovering run is never folded into
  the nothing-new rollup.

## The lease (decided; Josh can override)
- Each run has until the next one is due: doctrine v29's repeating-work paragraph, and the Prompter's due-run nudge
  names the deadline. The agent records an overrunning run as it stands and starts the next.
- Rejected: the board interrupting a working agent (the Prompter never types into one, #4544); handing the next cycle
  to another agent (a run-ownership model nobody asked for).
- Weakest premise: an agent deep in a retry notices the time. If not, the misses now show instead of vanishing.

## Doctrine
v29 pinned (fingerprint 63b704431e8076d5). engine/doctrine-past.js gains the v29 row and the new section hash only:
tools/doctrine-past.js also dropped two interim v21 rows and an old section hash that this worktree's history cannot
see, so those rows were kept.

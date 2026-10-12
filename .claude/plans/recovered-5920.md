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
v29 pinned (fingerprint fad5f367610465f9, after review 1 reworded the deadline; the first wording, 63b704431e8076d5,
was never released and keeps its row as any branch block does). engine/doctrine-past.js gains rows only:
tools/doctrine-past.js also dropped two interim v21 rows and an old section hash that this worktree's history cannot
see, so those rows were kept.

## Review 1 (opus, blind, on 7d624942): 2 blockers, 0 warnings, 2 conventions, 2 nits. FIXED
- B: the deadline "until the next run" disagreed with the slot accounting: a run recorded inside the miss grace before
  the next slot answers that slot early, so an obedient overrun read as a missed run (and the real next run as late).
  The deadline is now the next slot LESS the miss grace: the nudge names that time ("record it by ..."), the doctrine
  says "a little before the next one is due (the reminder Kosmos sends names the time)". A test pins that a record a
  second before the deadline answers its own slot, with the 09:50 control.
- B: engine/taskactphrase.js (the CLI's copy of the history words, held word for word with the page) did not say the
  misses, so `kosmos task activity` dropped them. Fixed, with parity fixtures.
- C: a task with no time the rule was set now claims no skipped runs (runIsLate says not late there too).
- C, noted rather than changed: a missed-run notice (missedtell, from missedRuns) can say "3 runs missed" and the
  recovering run's row "late, after 2 missed runs" for the same outage. Both are right: the third is the slot the late
  run answers, which its row calls late.
- NITs: the nudge uses the doctrine's words for the overrun step; lastRunRecovered.to is documented as the last slot
  counted (the cap's slot when `more`).

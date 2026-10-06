# missedrun-4787: #4787 slice 2, a repeating task's missed runs

Slice 1 (#5389) and 1b (#5396, #5398) let an agent or the person make a task repeat and report each run. This slice makes a missed run visible.

Built:
- taskrepeat.dueSlot: the one rule for which scheduled slot a repeating task is due for next (from its last run, or from when the rule was set). waitingForNextRun now reads it, with the same results as before; recordRun reads it too.
- taskrepeat.missedRuns: a slot is MISSED when its time plus a grace has passed with no run since. The grace is the smaller of 15 minutes and a quarter of the period, so a job a few minutes late is not called missed. It counts the slots missed (capped at 99, with a flag for more) and names the latest. No miss is claimed where there is nothing to measure from (no stamp, a run stamped in the future) or on a closed task.
- fieldsOf carries repeatMissed / repeatMissedMore / repeatMissedAt / repeatMissedWords to the Tasks route and the projects list (the task page), in the board's own time.
- The Tasks row and the task page lead the repeat line with "Missed the run due today at 9am." (or "Missed 3 runs, the latest due ..."), and the line turns the error red (var(--danger)) while a run is missed.
- recordRun marks a run that is off the schedule (runIsLate) as late (lastRunLate, and `late` on the run in the task's history). The line says "by Ada, late". An on-time run clears it; stopping the repeat clears it with the other run fields.
- whenWords says a past slot: "yesterday at 9am", a weekday within the last week, a date beyond.

Review 1 (fixed): the latest missed slot past the 99 cap is found directly (latestAtOrBefore); late is measured against the latest slot at or before the run, not the oldest unanswered one; a run up to the miss grace before its slot answers it; a changed rule drops the late mark.

Review 2 (fixed): late is taskrepeat.runIsLate, from the rule and the run's time only, so a job reporting a few minutes early is not late and a second runner in the same minute gets the same answer; dueSlot ignores a run made before the rule was set or changed, so it never swallows the new rule's first slot.

Review 3 and 4 (fixed): one rule, taskrepeat.answeredSlot, says which slot a run answers, for both the missed line and the late mark: the next slot when the run is at most the miss grace before it, otherwise the latest slot at or before it. A run is late when it came more than the grace after the slot it answers. So a job run well before its slot (08:44 for 9am, a weekly job a day early) is late for the slot before, and the coming slot shows as missed if nobody runs it: the row never says on time and missed about the same run (a property test walks every run time over two weeks for each rule). The first slot is strictly after the rule was set, as in dueSlot. (Round 3 had tried "the nearer slot"; round 4 showed it contradicted the missed line, so it was replaced.)

Review 5 (fixed): a missed weekly slot says "last Monday at 9am", never the same words as its next run; fieldsOf sends repeatMissAfter, and while the Tasks view is open it reads again once a shown slot passes it and every 5 minutes while a row is red (at most once per 30 seconds), so the red line appears and clears without a reload.

Review 6 (fixed): repeatMissAfter is the first slot whose grace has not passed (a read at 09:05 for a 9am slot rereads at 09:15 today, not tomorrow); TSK.readAt is stamped when a read starts, so a slow read is not restarted every poll. Declined: "on Monday" for "last Monday" (plain English for the most recent Monday).

Left as is, on purpose: dueSlot's own early grace (10 minutes, 2 for hourly) still decides the NUDGE, so a job that ran 12 minutes early can be nudged at its slot while it is not called missed (slice 1 behaviour, milder than the red line). The red line names what was missed and not a next step: the owner is nudged, and the person's next step depends on their job. The task page's red line is covered by the shared tskRepeatMissed tests and the row's browser arm, not by its own browser arm; it repaints with the projects list as the rest of the task page does, without its own timer.

The owner is already nudged: once a slot passes, waitingForNextRun is false, so the agent nudge and the Assigner see the task as open work (slice 1).

Decided, not in this slice:
- Not moved to Needs Your Decision. That group means an agent is waiting on the person; a missed run is first the owner's to fix, and the owner is nudged. The red line on the row is how the person sees it. If missed runs need to reach the red tile, that is a later call.
- No named reviewer yet (the report's "automation plus a named reviewer"): it needs a new field and a screen to set it. Next slice.
- No sweep that writes a "missed" event into the task's history: the state is derived, so nothing is written on a timer. The late run's history entry records the miss after the fact.

Weakest premise: that agents report each run. A repeating task whose agent never reports will show missed runs while the job is healthy. That red line is the visible check on the premise: a run counts only once it is reported.

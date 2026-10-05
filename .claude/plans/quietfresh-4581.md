# quietfresh-4581: a finished project's summaries are not "behind" because the members are idle

Card: #4581, reopened by the 10-05 user diagnostic (0.7.22, item R9): `kosmos project show` listed all five members'
summaries as older than the 4-hour rhythm (10 hours to 5 days) while the project had no open work.

## Why #5030 did not cover it (read from source)
idleExcused excuses a stale summary only if it was written within the rhythm before the member's LATEST idle report.
Every turn while the project is quiet (a community prompt about every 3 hours, a room post, an Assigner prompt) moves
that report on, so on a project whose work ended days ago the excuse never applies.

## Change (engine/projectview.js)
quietExcused, applied after idleExcused: a STALE summary of a present, tied, IDLE member, on a project with no open
task, written no earlier than the rhythm before the project's work ended, reads `quiet` with quietSince/quietMinutes.
"Work ended" = the newest task closedAt or part closedAt (lastWorkAt). No such time (never a task, or no timestamps):
left stale. The CLI (Mac and Windows share projectview.renderShow) prints "current when the project's work ended (...;
the last task ended N ago)".

## Tests (engine/projectview.test.js)
Quiet arm through real fleet members; part-closed and task-closed-with-open-part arms; controls: open task, part
closed after the summary, a later task closed after the summary, the 4-hour edge, no tasks, a current summary stays
current, a non-idle member never quiet. Each site perturbed: open check, parts, task closedAt, NaN guard, stale-only,
member check, rhythm, wiring; each turns a test red.

## Weakest premise
Work done outside any task (asked in a room or DM) leaves no task time, so a member who did hours of untasked work
after the last task closed, and wrote no summary, reads quiet. Kept because the alternative is the diagnostic's
complaint; the member's own idle excuse (#5030) still applies first.

# #5260: a file changed in the project folder is work moving for the room valve

## Problem
Daily feedback 2026-10-04 (one install): two agents ran a fact-check cycle in a project room (batch posted,
checked with corrections, corrections applied, next batch). The room's back-and-forth valve held it at the cap and
the task stalled until the person posted. #4786 (0.7.16) gives a bounded allowance for work moving, but counts only
TASK steps (engine/taskchat.js progressTimes). A cycle that edits files and talks moved no task, so it earned nothing.

Measured on origin/main: the default room cap is 80 arrivals an hour (perHour 20 x ROOM_FACTOR 4). Emoji
reactions are `kind: 'reaction'` rows and are NOT counted (the counter filters `kind === 'post'`), so the lead's
reaction in the report did not trip it; the batch posts did.

## Call
A file in the project's folder changed since countFrom is a step forward too (engine/projects.js
changedFileTimes), in the SAME allowance: a quarter of the cap per step, at most one more cap in all, shared with
task steps, never moving countFrom.
- Each file counts once however often it is rewritten (a newest-first list holds a path once).
- Not counted: dot-files, scratch names, dependency/build folders (listFiles' rules); what making the project wrote
  (a file last changed within 10 s of createdAt: the BRIEF.md stub); a file dated more than 2 s after now.
- A file dated up to 2 s after now counts, as now: a save just before the post can read a millisecond ahead of
  Date.now() on APFS (measured: without the slack, the room test failed intermittently, and a mutation removing it
  reds the room test).
- Only the newest 32 files are kept, and the walk runs only when the room is already over its cap with the limit on and task
  steps have not already earned the most.

## Rejected
- The lead agent reopening the room once (the report's second idea): agents must never be able to reset the count
  (messages.js #2710 note). Rejected.
- Text signals ("batch N of 3", distinct task numbers): a looping agent writes new words every turn for free.
- Raising the cap: helps the fact-check room and every loop equally.

## Weakest premise
That the cycle in the report changed files in the PROJECT folder. The report says corrections were "applied" and
suggests "a changed file" itself, but does not say where. If the agents edited files elsewhere (their own folders),
this does not help them, and the next step would be counting a changed file attached to a room post. What would
change my mind: the install's room log showing no project-folder writes during the cycle.

Second (review round 1, accepted): EVERY file change counts, whoever made it. A person's edit, a `git pull`, an
`npm install`, a sync tool or a dev server writing logs all earn steps, so in such a folder a looping room can reach
twice the cap with no agent work. Accepted because it stays inside the bound (never a reset), and in an adopted repo
the agents' real work IS file edits; excluding repos would exclude the work. What would change my mind: a report of a
loop running to 2x in a synced folder.

Cost (review round 1, measured round 2): one listFiles walk per post that is already over the cap, the same walk the
Files panel makes on every poll. A refused loop pays it on every post. Measured on the kosmos repo itself as a project
folder (2271 files listed): median 7.3 ms, max 8.8 ms, n=20, synchronous. Not cached: a 5 s reuse was tried and rejected, because an agent saves and posts within seconds and a
reused listing misses exactly that save. The listing keeps the newest 32, so a few files dated in the future cannot
take every slot (tested with 10; 32 or more such files would, which errs on the strict side: no allowance).

Per window (review round 2, accepted): countFrom is the window start, so a file changed in one hour and again in the
next counts in each hour. The same holds for task steps and is bounded per window the same way.

## Also in this branch
engine/messages.test.js now sandboxes AGENT_WORKFORCE_PROJECTS. Unset, projects.create made real folders in
~/Kosmos/Projects (the #3564 tests had left "Swarm Valve Room" and "Swarm Off Room" there since September; my first
run of these tests left two more, removed).

## Tests
engine/messages.test.js '#5260' (2 tests) with #4786 and #3564: 7/7, three runs. Mutations, each red on its own
assertion: no file steps; no clock slack; no creation rule (also reds #3564); an unbounded allowance.

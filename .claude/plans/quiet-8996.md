# kosmos#8996 slice 1: a project's last activity, and when quiet is worth telling the person

## Call (what the code does now)
`kosmos project show <id>` (both CLIs; engine/projectview.js renderShow runs in the CLI's own process, so the date is the
person's local day) prints one line after Tasks:

  Last activity: <a post in its room | work on a task | the project was made>, <N days ago | within the last day> (<date>). <verdict>

Verdicts:
- under 14 days: "Quiet is normal until 14 days." (made and nothing since: "Nothing has been posted or moved since it
  was made; quiet is normal until 14 days.")
- from 14 days: "That is past the 14 days Kosmos counts as normal quiet. If you are on the project, read kosmos room
  <id>: if nobody has told your person there in the last 14 days that it is quiet, post that there once."
- quiet expected, said with its reason: paused; archived; a test project (#8236); the starter project Kosmos made
  (#8832), only while it holds no task, open or finished; parked (every unfinished task on hold with its own reopening
  condition unmet, or built and waiting).
- the room log cannot be read: "cannot say" (or the expected reason, which is known without the room).

Activity = newest of messages.lastPostAt (the room's last post; Kosmos's own notes excluded, #6341), each task's
tasks.lastActivityOf (the board's "Quietest first" measure: a task made, closed, or anything said on an open one), and
createdAt. A post or task time in the future reads as now (the readers return only the newest time, so dropping it would
hide every older one); a making in the future is left out.

The payload (`activity` on GET /api/project/:id/overview) carries at, kind, ageDays, quietDays, quiet, unknown and
`expected` (the reason, or null). An older board sends none and the line is not printed; an older CLI facing a reason
or kind it does not know says it neutrally.

## Rejected
- A board badge or a "needs you" flag in this slice: #6209 and #6341 closed exactly that kind of noise.
- A person-set threshold in this slice: one default (QUIET_DAYS = 14) first.
- Counting member summaries or agent turns as activity: work the person cannot see in the room or on a task is not
  project activity to them.
- One quiet notice ever: a still-dead project gets one reminder per 14 days, said in the room so every member sees it.

## Known limits, stated not fixed
- The quiet notice is itself a post, so it restarts the clock: a project dead for months reads "a post in its room, N
  days ago" and gets one notice every 14 days (the line says "in the last 14 days" for exactly this). Telling notices
  from work would need a marked post kind.
- Each show reads every open task's chat (lastActivityOf), as `task list --stale` already does. Fine at today's sizes.
- An unreadable room discards the task and making times it has; the answer is "cannot say", never "quiet".
- Nothing yet teaches agents this line exists. Slice 2: one sentence in the projects block (it owes every agent a
  re-read, so it waits until the words settle), a board line, and a person-set threshold if 14 days is wrong.
- A pause an agent set counts the same as the person's: decided, since the room is told who paused it either way.

Weakest premise: that 14 days is the right default. It is a judgement, not a measurement.

## Review rounds (challenge loop, 8-round cap)
1 opus: room-directed words, parked, local date, real-store test, CLAUDE.md row. 2 sonnet: expired holds, guarded
reader, `kosmos room <id>` named. 3 opus: members only, test and starter projects, help lines, known limits. 4 sonnet:
`expected` names the reason. 5 opus: unknown reasons and kinds said neutrally, defaults, starter only without tasks.
6 sonnet: future times read as now. 7 opus: the second-notice rule made one, stale text removed.

## Tests
engine/projectview.activity-8996.test.js (20): newest wins with its kind; the 14-day line; each expected reason with a
control; their order; an expired hold is not parked; the starter with a task (open or finished) is watched; an
unreadable room is unknown; a future post reads as now, a future making is left out; an older CLI facing a newer board;
malformed fields; every sentence word for word; the line's place in project show; overviewOf carries it; the real
store with nothing stubbed. Each rule has a mutant that fails its test.

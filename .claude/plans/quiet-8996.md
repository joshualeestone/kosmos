# kosmos#8996 slice 1: a project's last activity, and when quiet is worth telling the person

## Call
`kosmos project show <id>` (both CLIs; engine/projectview.js renderShow runs in the CLI's own process, so the date is the
person's local day) prints one line after Tasks:
  Last activity: <a post in its room | work on a task | the project was made>, <N days ago | within the last day> (<date>). <verdict>
Verdict: under 14 days "Quiet is normal until 14 days."; from 14 days "That is past the 14 days Kosmos counts as normal
quiet. Read kosmos room <id>: if nobody has said so there, post it there once, for your person."; paused or archived,
or parked (every unfinished task on hold with its condition unmet, or built), "quiet is expected"; made and nothing
since says so.

Activity = newest of messages.lastPostAt (the room's last post, Kosmos's own notes excluded, #6341), each task's
tasks.lastActivityOf (the board's "Quietest first" measure: a task made, closed, or anything said on an open one), and
createdAt. A future post or task time reads as now; a future making is ignored. An unreadable room log is "cannot say", never quiet.

## Rejected
- A board badge or a "needs you" flag in this slice: #6209 and #6341 closed exactly that kind of noise, and the card's
  own ask is that the agent can read it. A board line can follow once the words are agreed.
- A person-set threshold in this slice: one default (14 days, QUIET_DAYS) first; a setting is slice 2 if the default is
  wrong in practice.
- Counting member summaries or agent turns as activity: an agent working alone without posting or moving a task is not
  project activity the person sees.

Review 1: the quiet verdict says to tell the person IN THE ROOM, and only if nobody has: every member then sees it was
said, and the post restarts the clock, so six members do not each tell them and a restarted agent does not repeat it.
A project whose every unfinished task is on hold or built is "parked": its quiet is expected, like a pause. The date is
this computer's local day, and "within the last day" replaces "today". "A task was added or moved". A real-store test
(nothing stubbed) and the CLAUDE.md test-map row.

Review 2: an expired hold (its date passed, its task closed) is not parked. The verdict names `kosmos room <id>` so the
agent can see whether someone already said it, and says "post it there once": the post counts as activity, so once
said, the verdict goes quiet for every member. The injected task reader is guarded like the default one.

Review 3: the quiet verdict starts "If you are on the project" (a non-member cannot read or post in the room, and the
person may run show too). A test project (#8236) and the starter project (#8832) are quiet by design, like a pause. A
pause known without the room is said even when the room cannot be read. Both CLIs' help lines name "last activity".
Review 4: the payload says WHY quiet is expected (`expected`: paused, archived, test, starter or parked; null when
it is not), not one `paused` flag meaning five things, and the line names that reason. Parked is honoured when the
room cannot be read, as a pause is. The "Review N" comment labels follow this repo's convention.
Review 5: a time up to 5 minutes ahead is clock skew and read as now (beyond that it is dropped). The starter project
counts as expected quiet only while it holds no task. A reason or kind an older CLI does not know is said neutrally
("Kosmos expects this project to be quiet", "something on the project"); a missing threshold is 14 days; a
non-numeric age is left out. Every printed sentence is pinned. A pause an agent set counts the same as the person's:
decided, since either way the room was told who paused it.
Review 6 (replaces review 5's skew window): any post or task time in the future is read as now. The readers return
only the newest time, so dropping one would hide every older time under it and could call a busy project quiet; read
as now, it errs toward "not quiet". A making in the future is left out, so it never outranks a real post. The starter
excuse holds only while it has no task, open or finished. The verdict says what to post: "if nobody has told your person
there that it is quiet, post that there once".
KNOWN LIMITS, stated not fixed:
- The one quiet notice is itself a post, so it restarts the clock: a project dead for months reads "a post, 3 days ago"
  and gets one notice every 14 days. Telling notices from work would need a marked post kind; the room shows both.
- Each show reads every open task's chat (lastActivityOf), as `task list --stale` already does. Fine at today's sizes;
  a cache by file mtime if show ends up in a polling loop.
- Nothing yet teaches agents this line exists; an agent that never runs show still picks its own threshold. Slice 2:
  one sentence in the projects block (it owes every agent a re-read, so it waits until the words settle), and a board
  line, and a person-set threshold if 14 days is wrong in practice.

Weakest premise: that 14 days is the right default. It is twice the reread give-up (7 days) and matches the records'
staleness scale; nothing measured says it is right for every project.

## Tests
engine/projectview.activity-8996.test.js: newest wins with its kind; the 14-day line; paused and archived never quiet
(control: same project not paused is); unreadable room is unknown; a future time ignored; the exact words; the line's
place in project show; overviewOf carries it. Mutants (paused ignored; unknown dropped) each fail. Probe against the
real store: made-only, then a task, both dated.

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
createdAt. A future time is ignored. An unreadable room log is "cannot say", never quiet.

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

Weakest premise: that 14 days is the right default. It is twice the reread give-up (7 days) and matches the records'
staleness scale; nothing measured says it is right for every project.

## Tests
engine/projectview.activity-8996.test.js: newest wins with its kind; the 14-day line; paused and archived never quiet
(control: same project not paused is); unreadable room is unknown; a future time ignored; the exact words; the line's
place in project show; overviewOf carries it. Mutants (paused ignored; unknown dropped) each fail. Probe against the
real store: made-only, then a task, both dated.

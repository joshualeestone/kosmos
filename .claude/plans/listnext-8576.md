# listnext-8576: the list across every project says when each task last moved and what it waits on

Card: kosmos#8576 (agent feedback 11-16). `kosmos task list --all` (and --all --blocked / --built / --mine) shows state
and owner but not when a task last moved or what it is waiting for, so a coordinator told waiting from drift only with
the --stale threshold or by opening each project.

## Decision
- The board (server.js, the cheap list arm, all=1 with order=state only) adds `lastActivityAt` to each row, from
  tasks.lastActivityOf, the measure --stale uses (null when there is no date). One transcript read per row that is not
  closed (see Weakest premise); a closed row reads none.
- engine/tasklist.js acrossLines (both CLIs print through it) appends "(last activity today | yesterday | N days ago |
  no activity on record; waits on ...)" to each --all row. The "waits on" part comes only from fields the row already
  carries: a hold until a task or a time, a hold for or by the person, a paused project, a built mark (waits on a review
  and close), a repeat's next run. Nothing is guessed: an open task with none of these says only when it last moved.
- Only when the board sent lastActivityAt, so an older board's rows print exactly as before. One project's --stale list
  keeps its own "(quiet N days)".
- The words go before the built list's "(seen by the person ...)", which stays last.

## Rejected
- A "waiting on a release / device" event: Kosmos tasks carry no such field. Those parks live on GitHub cards, not on
  Kosmos tasks, so the list has nothing true to say about them.
- Computing whether an agent waits on the person (needs a roster read and the Tasks view's rule) for this cheap list.
  A hold for the person is already on the row and is said.
- Adding it to one project's plain list too: the card asks for the list across projects, and one project is opened.

## Weakest premise
That the read is cheap enough. `kosmos task list --all` (all=1 with order=state) reads one transcript per row that is
not closed: open, held or built, a wider set than --stale, which reads only the open group. `kosmos task files --all`
sends no order=state and pays nothing. If --all is slow on a big board, the next step is an opt-in parameter.

Also decided: a held row carries holdUntilMet (tasks.holdUntilState). A hold does not lift itself, so a row whose
condition is met says so and that it is still on hold. The board's answer wins over this computer's clock, which only
fills in when the board sent none.

## Tests
- engine/tasklist.next-8576.test.js: today / yesterday / N days / no date / a clock ahead; each waits-on source; a
  plain hold; CONTROL: an older board's rows unchanged; --stale unchanged.
- cli.task-list-across-7057 and cli.task-list-mine-7992 (real board, both CLIs) now expect "(last activity today)"
  and, on a built row, the waits words before the seen words.
- Mutants: the board not sending the field, and the older-board gate removed, each turn a test red.

## Left at the review cap
The review loop stopped at its 8-round cap with no blocker open. Carried to kosmos#8577: a repeated project id can give a
held row a wrong holdUntilMet, a held task in a paused project does not say the project is paused, and three nits.

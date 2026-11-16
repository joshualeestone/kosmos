# listnext-8576: the list across every project says when each task last moved and what it waits on

Card: kosmos#8576 (agent feedback 11-16). `kosmos task list --all` (and --all --blocked / --built / --mine) shows state
and owner but not when a task last moved or what it is waiting for, so a coordinator told waiting from drift only with
the --stale threshold or by opening each project.

## Decision
- The board (server.js, the cheap list arm, all=1 only) adds `lastActivityAt` to each row, from tasks.lastActivityOf, the
  same measure --stale already uses (null when there is no date). One transcript read per open row, which --stale
  already pays across every open task; a closed row reads none.
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
The cost is accepted, not avoided: every all=1 answer (`--all`, `--blocked`, `--built`, `--mine`, and `kosmos task files
--all`, which prints none of it) now reads one transcript per open row. `--stale` reads the same for every open task, so
this is no new kind of cost, but it is now paid on the everyday forms. An opt-in parameter was considered and not taken
(two CLIs to change for a read the stale list already makes); it is the first thing to do if --all is slow on a big board.
A held row also carries holdUntilMet (tasks.holdUntilState), so a hold whose task closed or whose time passed says it is
due to lift rather than that it waits.
That one transcript read per open row is cheap enough for every --all call. It is what --stale already does for all
open tasks; if --all turns out slow on a big board, the read can move behind a flag.

## Tests
- engine/tasklist.next-8576.test.js: today / yesterday / N days / no date / a clock ahead; each waits-on source; a
  plain hold; CONTROL: an older board's rows unchanged; --stale unchanged.
- cli.task-list-across-7057 and cli.task-list-mine-7992 (real board, both CLIs) now expect "(last activity today)"
  and, on a built row, the waits words before the seen words.
- Mutants: the board not sending the field, and the older-board gate removed, each turn a test red.

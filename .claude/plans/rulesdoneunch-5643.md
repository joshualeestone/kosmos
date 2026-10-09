# rulesdoneunch-5643: the working rules teach --done (#5152) and --unchanged (#5643 slice 2)

## Finished looks like
The working rules' "Put the work on a task first" section tells agents to:
- write each check with `kosmos task add ... --done "<check>"` (up to three);
- put checks on a given task with `kosmos task done-when`, keeping checks the person wrote;
- record a scheduled run that found nothing new with `kosmos task ran ... --unchanged`, and post nothing about it in the room.

DOCTRINE_VERSION 26 is logged; the fingerprint and doctrine-past rows are updated. It is measured with claude -p before merge.
It depends on #5639 (--done, done-when) and #5646 (--unchanged) being on main: rebase onto both before the PR, because a parity test checks that every option the rules name exists.

## Measured (claude -p --setting-sources project,local; every run in its OWN fresh copy of the agent folder; stand-in kosmos logging each argument)
The harness is in the scratchpad meas/ (batch3.sh, results3/). Batches 1 and 2 are superseded: their control runs shared one folder and read each other's files (review round 1, W3).

| Scenario | New rules (v26) | Today's rules (v25, control) |
|---|---|---|
| Setup of an hourly check, empty list | 2/2 `task add` with separate `--done`, then `repeat hourly` | 0/2 (one put all three checks into one `done-when` blob, one wrote none) |
| A run with nothing new | 3/3 `ran --unchanged`, no room post | 1/2 posted in the room, 1/2 did nothing |
| A run with changes, from the person | 2/2 `ran` without the flag, answered the person directly | not run |
| Asked in the room whether it ran | 2/2 `ran --unchanged` and answered in the room | not run |
| A run that could not check | 2/2 `ran` without the flag, `report blocked` (and 2/2 again after review 2's wording) | not run |
| A scheduled run, nobody asking, finds changes (review 2) | 2/2 `ran` and posted in the task's room | not run |
| Nothing new, re-run after review 2 | 2/2 `ran --unchanged`, no post | |
| A task whose checks the person set | 2/2 left them alone | not run |
| Given task 5, no checks | 1/1 `done-when` with separate checks | 0/1 |

**Weakest premise:**
- small samples;
- Claude only;
- the stand-in lists other tasks as the agent's, so some runs wandered into them;
- the agents reached the host account's connectors (Gmail) and first name. That is a harness leak, not a rules effect.

## Review log
- **Round 1 (opus):** 1 blocker, 4 warnings.
  - B1 fixed: the generator dropped released v21 rows and a section; restored and pinned by a test.
  - W1, W2 and W4 fixed in the text, and measured (see the table).
  - W3 fixed: isolated runs; the log and the table were rewritten.
  - C1 and C2 fixed: the log label, the test comment.
  - NIT: reflowed.
- **Round 2 (sonnet):** 0 blockers.
  - W fixed: a change found with nobody asking had nowhere to go; now it is posted in the task's room (measured 2/2).
  - C fixed: the v26 row is placed newest-first in doctrine-past.js.
  - C fixed: Blocked names `kosmos report blocked`, for that run only (measured 2/2).
  - NIT fixed: "record what it found", not "say".
- **Round 3 (opus):** 0 blockers.
  - W fixed: the bare `kosmos report blocked` is refused by both CLIs, and Blocked is wrong when only the person can fix it. Now `blocked --on "<what>"`, or needs_you as above, then `report clear` on the next good run. Measured: timeout 2/2 `blocked --on`; expired login 2/2 needs_you.
  - C fixed: a test ties "set by the person" to both CLIs' output.
  - NITs fixed: the log reflow, and the test comment.

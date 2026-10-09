# rulesdoneunch-5643: the working rules teach --done (#5152) and --unchanged (#5643 slice 2)

## Finished looks like
The working rules' "Put the work on a task first" section tells agents to:
- write each check with `kosmos task add ... --done "<check>"` (up to three);
- put checks on a given task with `kosmos task done-when`, keeping checks the person wrote;
- record a scheduled run that found nothing new with `kosmos task ran ... --unchanged`, and post nothing about it in the room.

DOCTRINE_VERSION 26 is logged; the fingerprint and doctrine-past rows are updated. It is measured with claude -p before merge.
It depends on #5639 (--done, done-when) and #5646 (--unchanged) being on main: rebase onto both before the PR, because a parity test checks that every option the rules name exists.

## Measured (claude -p --setting-sources project,local, --permission-mode bypassPermissions; stand-in kosmos logging argv per argument)
The harness is in the scratchpad meas/ (run.sh, batch.sh, batch2.sh, bin/kosmos). Agents get the block plus a Your projects section (Price watch).
The probe "who do you work for?" answered only from the agent's own file.

| Scenario | New rules (v26 draft) | Today's rules (v25, control) |
|---|---|---|
| Setup of an hourly check, empty list | 3/3 `task add` with separate `--done` args, then `repeat hourly` | 1/2 put checks as ONE `done-when` blob; 1/2 wrote no checks |
| Given task 5 | 2/2 `done-when 5` with 3 separate checks | 0/1 wrote checks |
| A run with nothing new | 3/3 `ran --unchanged`, no room post | 0/2 recorded a run (both asked where the list is) |
| A run that found changes | 2/2 `ran` without the flag, and posted the change in the room | not run |
| Small talk | 1/1 read-only calls, no writes | not run |

Batch 1's setup arm was void: the stand-in's list already showed a task 3. It was re-run as batch 2.

**Weakest premise:**
- Claude only; Codex and Gemini were not measured.
- The control's "nothing new" arm did not record a run at all, so the comparison shows the new text gets a run recorded AND flagged; it does not isolate the flag.
- One run wrote a real first name from this host into a check, a leak from the host account, not from the rules.

## Review log

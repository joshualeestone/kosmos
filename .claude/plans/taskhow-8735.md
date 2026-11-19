# taskhow-8735: kosmos#8735 slice 2, part 1: the task commands for one situation each, printed on demand

Stacked on newbrief-8735 (slice 1, the community routine). Same rule: only text whose trigger is a concrete command or
situation moves, word for word, to a guide printed by the command the agent is about to use; behaviour rules stay.

## Change
- engine/taskguide.js (requires nothing): from "Put the work on a task first", word for word: fixing a task's title or
  detail, listing open tasks across projects, a file's fingerprint, a code fix's commit, and the repeating-task procedure
  (repeat, ran, --unchanged, the 15-minute deadline, a run that could not check). Two "as above" pointers to text that
  stayed in the rules now say "as your working rules say".
- engine/defaults.js: the section keeps the rule, add/list/done-when/check/built, "one task that repeats, not a new task
  each time", "a question is not a task", and one line naming the moved situations with `kosmos task --how`. Doctrine 53,
  logged; fingerprints pinned; engine/doctrine-past.js regenerated (tools/doctrine-past.js).
- `kosmos task --how` in install/kosmos and tools/windows/kosmos-cli.js (a flag, as community --how), usage and help lines.

## Proof
- Verbatim: every line that left the rules is in the guide, darwin and win32, but the two intended "as above" lines.
- Working rules 33,259 -> 30,031 characters (darwin). pm brief 51,670 -> 48,436. Ratchet 48,500.
- engine/taskguide.test.js: both CLIs print the guide; the moved lines are in the guide and in no platform's rules.
- Retargeted: defaults.test.js #5152/#4787/#5920 and fileprint-6849 read the guide for what moved; #5152 also pins the
  section's pointer and "one task that repeats".

## Weakest premise
That an agent runs `kosmos task --how` when it sets a schedule, records a run, or marks a file or a code fix built. The
line names each situation; the task help names --how. Not measured on agents.

## Not in this part
Colleague-message mechanics, the daily feedback routine, and the duplicated files guidance (slice 2, part 2); then the
wording pass (slice 3), written up on the card before it is built.

## Review 1
- The pointer says "the first time ... (and again whenever you no longer remember how)" and that a due run's reminder
  repeats what each run needs: reading the 3.2k guide before every hourly run would cost more than the move saves.
  v53 re-pinned (unreleased), doctrine-past regenerated, ratchet 48,600 (pm 48,554).
- Not changed: the two "as your working rules say" lines run longer than their neighbours (rewrapping would change the
  line boundaries the verbatim check compares). The three v52 rows doctrine-past gained are drafts of a branch merged
  with its history on main (tools/doctrine-past.js documents this); no agent holds them.

## Review 2
- Three run-recording rules apply on EVERY run, not in one situation, so they stay in the rules as one sentence: an
  unchanged run is recorded with --unchanged and not posted about; a run that could not check is not unchanged (record
  and report it); a run that finds something is told to whoever asked, where they asked. The pointer now says a due
  run's reminder "names the commands" (it does not repeat everything). v53 re-pinned, doctrine-past regenerated,
  ratchet 48,900 (pm 48,842).

## Review 3
- The kept per-run sentence carries the guide's fallback (if nobody is asking, in the room the task belongs to).
- Log 53 says what stayed and the real saving (about 2,800; darwin 33,260 to 30,492). The guide names the heading the
  agent sees (How you work, whatever the job). Ratchet 49,000 (pm 48,897).

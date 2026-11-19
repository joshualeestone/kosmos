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
- First measured: working rules 33,259 -> 30,031 characters (darwin), pm brief 51,670 -> 48,436. Superseded by the
  reviews below; current figures are under Review 5.
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

## Review 4 (Sonnet)
- No BLOCKER. Kept `task built --commit HEAD` and `--file` in the guide only (decided on #8735: 150 characters against
  103 of headroom; the pointer names "a code fix built").

## Rebased onto main after #8750 merged (c5b323f401)
- The size guard now counts the kosmos command path as one fixed path (#8750's CI fix), so pm reads 48,843 here and on
  CI alike. Ratchet 48,900.

## Review 5 (Opus)
- WARNING fixed: the per-run sentence names `kosmos report blocked` and `kosmos report clear` (a board was left Blocked
  after a later good run). Pinned in defaults.test.js; perturbed (the words removed) -> red.
- To fit the ratchet: "whenever you no longer remember how" -> "whenever you forget how", and the sentence "It is long,
  so it is not repeated here" dropped (it explained, it did not instruct). darwin block 30,517; pm 48,868; ratchet 48,900.
- v53 re-pinned (never released, so no bump) and doctrine-past regenerated.
- WARNING, built after #8743 merged (993d9ab0d4, see below): a running agent's changes file marks the 47 moved task
  lines `-` ("no longer applies"). #8743 builds the "moved to a guide" treatment for the community guide; this branch
  must extend it to `taskguide.guideText()` when `rules` is named, after #8743 is on main. This branch does not merge
  before that. Measured by the reviewer (changedLines on v52 vs v53).
- Nits fixed: log 53's darwin figure; this plan's stale figures.

## The moved task lines (review 5's WARNING), built on #8743
- `changedLines` takes a list of moved entries, each with its own heading, counts and note (one entry behaves as
  before, so #8743's tests still pin it). `prepareChanges` adds the task guide under "Put the work on a task first"
  whenever the new file still has that heading; a file whose section is gone hides nothing.
- Measured on the real files: main's v52 darwin block against this branch's v53 marks 56 lines - without the entry and
  2 with it (the two deliberate "as above" rewordings, which the conditional sentence covers); 45 left out with the note.
- Tests: left out as moved; deleted section hides nothing (control); both guides at once, two notes. Perturbed: the
  entry off -> the first and third red; the heading guard off -> the control red.


# dailytimes-5752: a daily repeat can run at several times a day (slice 1 of #5752)

Card: joshualeestone/kosmos#5752 (decision comment 2026-10-10, night shift). Slice 2 (the non-member refusal names
its fix) and slice 3 (a board notice with Add as member) are separate.

## Change
- engine/taskrepeat.js: a daily rule's `at` is one time (a string, exactly as today) or two or more (a sorted list
  with no repeats, at most 24). `normalise` stores one time as a string, so every existing rule and reader is
  unchanged. A weekly rule still takes one time.
  - `nextAfter` tries every time of each day.
  - `describe` says "every day at 9am and 9pm" ("9am, 1pm and 9pm" for three).
  - `fromWords` reads `--at 09:00,21:00` (commas, spaces allowed).
  - The early-run and miss graces use the SHORTEST gap between the day's times (wrapping past midnight), so two
    times 30 minutes apart do not get a 10-minute grace. The latest-slot walk keeps a one-day period, so a
    lopsided pair (09:00 and 09:30) is never skipped.
- web/index.html (the task page's Repeats control): a list rule keeps its list. The time box shows the first time
  and the line below says every time. Editing the box changes that first time and keeps the others (sorted, a repeat
  collapsing to one); choosing another frequency takes the box's one time. Save stays off while nothing changed.
- install/kosmos and tools/windows/kosmos-cli.js: usage says `--at HH:MM[,HH:MM...]`; both already pass `--at`
  through as text, and the board checks it.

## Tests
- engine/taskrepeat-dailytimes-5752.test.js: shapes accepted and refused; nextAfter across both times and past midnight; describe;
  fromWords; graces from the shortest gap; missedRuns and runIsLate on a twice-daily rule; a lopsided pair's
  latest slot.
- server.task-repeat-4787.test.js (or a new file): the route sets `--at 09:00,21:00` and a run at each time is
  recorded on time.

## Weakest premise
That the screen editor is the only reader that turns a rule into one time. Checked: outside taskrepeat.js the rule
is read by tasks.setRepeat (JSON compare of the normalised rule), the route (fromWords), and web/index.html
(tkRepeatChoice / tkRepeatStoredChoice). Nothing else reads `repeat.at`.

## Not changed on purpose
- The agent rules (engine/defaults.js) still show only `daily --at 09:00`. Changing them bumps DOCTRINE_VERSION, which
  each version backs with measured agent runs against a control, and offers the new rules to every agent. The CLI help
  (`kosmos task repeat`) carries the new form now; the rules line is a follow-up on #5752.

## Not covered
- An interval cadence ("every 6 hours from 08:00"). Different shape; not asked for.
- The screen cannot ADD a time or remove one (except by moving the first onto another); that is the agent or the CLI. A design pass for a multi-time picker
  would be its own card.

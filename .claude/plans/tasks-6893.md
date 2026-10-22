# tasks-6893: a task can repeat every so many minutes (#6893, gap 1)

## Finished looks like
A person can make a task repeat every 30 minutes (or 15, 45, 90, 120...) from the task page or either CLI, the board
says "every 30 minutes" with the next run, and the run is due and missed on those slots. Gaps 2 and 3 are #6894, #6895.

## Steps
1. engine/taskrepeat.js: the rule { every: 'minutes', n } (5 to 720, divides 1440), normalise, nextAfter (multiples of
   n from local midnight, built slot by slot), describe, fromWords ("30m", "45min", "2h"; and "minutes" with --at n),
   periodOf (n minutes, which sizes the graces through gapOf).
2. Both CLIs: accept the minutes word, refuse --at and --on with it before the board, help and usage name 30m.
3. Task page: "Every so many minutes" with a number box; the choice travels as { every: 'minutes', at: '<n>' }.
4. Tests: engine, page (lifted real functions), both CLIs; every existing repeat test.

## Decisions
- Anchored at midnight, not at the last run: slots that drift make "missed" and "next" meaningless.
- n must divide the day: otherwise each day starts at a different offset.
- Floor 5 minutes, ceiling 720.
- Agent instructions (engine/defaults.js) unchanged: changing them moves the instructions version for every agent.

## Weakest premise
That 5 minutes is a sensible floor (miss grace a quarter of the interval: 75 s at 5 minutes).

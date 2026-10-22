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
- Floor 15 minutes (review 3: every run is a row in the task's history, which keeps them all; 5 minutes would be 288
  a day), ceiling 720.
- Agent instructions (engine/defaults.js) unchanged: changing them moves the instructions version for every agent.

- Clock changes: a time the spring change skips is dropped, never moved (02:15 is not 03:15); on the autumn night the
  repeated hour gets no slots of its own (a 30-minute task has a 90-minute gap there). Both deliberate (review 3).
- A stalled task's reviewer is told again about hourly while the same stall lasts; a run ends the stall.

## Weakest premise
That 15 minutes is a low enough floor. If people need every 5 or 10 minutes, the history needs a cap first.

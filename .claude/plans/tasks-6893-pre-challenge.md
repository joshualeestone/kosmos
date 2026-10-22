---
method: challenge-loop
branch: tasks-6893
diff_hash: 780841cf7df67fa21352ce92e799912ef15f73d0727ea375b27c21f5f6040c7b
timestamp: 2026-10-22T12:00:57Z
subdir_audit: passed
iterations: 4
converged: true
---

# Challenge-loop proof: tasks-6893 (kosmos#6893 gap 1, a task can repeat every so many minutes)

A new rule { every: 'minutes', n }: n from 15 to 720, dividing the day, slots on the multiples of n from local
midnight (a time the spring change skips is dropped). 60 is stored as the hourly rule. Set from the task page
(Repeats: Every so many minutes, with a number box) or either CLI (30m, 45min, 2h), which refuse --at/--on with it and
a second frequency. A stalled minutes task tells its reviewer again about hourly while the same stall lasts.
Gaps 2 and 3 of the card are #6894 and #6895. Four blind iterations: 1 Opus, 2 Sonnet, 3 Opus, 4 Sonnet.

#### Iteration 1 (Opus): one BLOCKER and four warnings, FIXED (2b3a11c, dfd8c10)
- BLOCKER: the Mac CLI's check was a shell pattern over the whole line, refusing valid weekly commands with a
  reviewer named like sam. Now a flag set in the argument loop.
- A time sent with a minutes word was dropped (now refused); a stalled 5-minute task would tell its reviewer every
  5 minutes (floor added); nextAfter walked from midnight (now starts a slot back); the DST test proved nothing
  under UTC (now a child pinned to America/Chicago).

#### Iteration 2 (Sonnet): no blocker; three warnings, FIXED (d5618d1)
- 60 in the minutes box lit Save on an hourly task (the choice is written as the board stores it); 60m on an
  hourly task tested as no change; edge slots pinned (midnight, 23:59 at 45 minutes, 03:10 on the spring morning).

#### Iteration 3 (Opus): no blocker; two warnings and three nits, FIXED (7e3b51c)
- History grows by a row a run, so the floor is 15 (96 a day); the reviewer floor delayed a NEW stall (now holds
  only while the same stall lasts); skipped spring times are dropped, not moved (tested at 45 minutes); the autumn
  night's repeated hour taking no slots is now stated; a second frequency word is refused in both CLIs.

#### Iteration 4 (Sonnet): no blocker or warning. One nit applied (4ee8be7: 12 hours at most is said). Not taken:
the '--at and --on go with how often: hourly, daily or weekly' sentences are right (a minutes rule takes neither);
case-sensitive frequency words predate this change in both CLIs alike.

#### Evidence
- 278/278 across the 16 test files that reach repeat rules or missed runs (after the rebase onto main).
- Mutants, each red: the divides-the-day check, hours read as minutes, a slot as its own next, the period, the
  re-tell floor, a dropped --at, 60 as hourly, the CLI refusal, skipped times moved, a new stall held, two
  frequencies (each CLI), the floor back at 5.
- Browser: render-onhold-4771.js (with new assertions: the minutes box alone, 30 saved reads every 30 minutes)
  108 PASS, render-unread-edge-3743.js 72 PASS, render-agentdm-3414.js 40 PASS, chromium and webkit, at a0d9adce71.
- Not changed, said: the agents' own instructions still name hourly, daily and weekly (changing them moves the
  instructions version for every agent).

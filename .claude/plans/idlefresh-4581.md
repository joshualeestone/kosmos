# idlefresh-4581: a summary current when its agent went idle is not "behind" (#4581 N10)

Card: joshualeestone/kosmos#4581, 0.7.15 diagnostic (2026-10-01): "N10 (Claude): freshness counts idle overnight hours,
so a quiet night marks three of five agents as behind. Suggested: measure against working time, or show 'idle since'
beside it."

## Measured first (origin/main 0a7157d41)
engine/projectview.js summaryFreshness compares the newest summary's write time with now: stale past four hours. The
rhythm it measures is "a summary every four hours WHILE WORKING" (roles.js SUMMARY_RHYTHM), so an agent idle since
evening reads stale by morning.

## What changes (engine/projectview.js only; both CLIs render through it)
- overviewOf passes each member's summary through idleExcused: a stale summary of a member that is present, tied and
  idle now, whose latest self-report is `idle` dated no later than now, written within four hours before that idle
  report, becomes state `idle` with idleSince/idleMinutes.
- renderShow says: "summary: current when it went idle (<file>, <age> ago; idle since <age> ago)".
- Unchanged: current, none, nofolder, future, unreadable; a stale summary of a working, asking or not-running member;
  a summary already over four hours old when the member went idle.

## Decided, and rejected
- Rejected: subtracting idle time from the age (measuring working time). It needs every idle stretch, which the board
  does not keep; the latest idle report is what it has, and saying "idle since" is the diagnostic's other suggestion.
- The idle moment is the latest report's time. Every turn end writes one, so a member idle since evening reads its
  evening time.

## Weakest premise
That the latest idle report's time is when the member stopped working. A member woken overnight for a short turn has a
later idle time; its summary from the evening then reads stale if that wake was more than four hours after it. What
would change my mind: PMs reading such members as behind on a quiet night.

## Tests
engine/projectview.test.js: idle 3h after the summary reads "current when it went idle"; idle 8h after reads stale; a
working report, no report, and an idle report dated in the future read stale; a current summary is untouched.

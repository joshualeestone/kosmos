# abquiet-8083: a quiet auto-balance sweep says it is running (#8083)

## Problem
On a board where nothing has been at risk since start, the sweep writes no record line (review 10 of #7152: a first
tick with nothing at risk writes none) and logs nothing, so "armed and quiet" and "not running" look the same.
Measured on Mortals 11-05: armed 15:26, no record and no log line by 20:12.

## Change
- engine/autobalance-sweep.js `quietLine(said, { nowMs, offWhy, did, because, unmeasured, logged })`: returns a
  board-log line when the sweep's state changes, and once an hour while a running state (quiet or broken) holds. A
  not-running state is said on change only. A tick the board printed a line for (`logged`) adds nothing.
- server.js: `autobalanceSweepOffWhy()` names the first shut gate of autobalanceSweepRuns({ forTick: true }), same
  gates and order; a start line "autobalance-sweep: timer set, every N min, running | not running now: <why>; the mover is on|off",
  which counts as said; quietLine called at
  the tick's early return (with the reason) and at its end (with did and the unmeasured count).
- The record is unchanged.

## Decided
- Log, not Settings: the log is where an operator or agent looks when the record is empty; Settings already shows
  whether it is recording.
- Hourly only while running: about 24 lines a day for a state that holds (a state that flaps says each change, as
  the existing "could not record" line already does). Not-running states come from settings and are said on change
  only, so a default install (usage poll off) does not log the same line every hour.

## Tests
engine/autobalance-quiet-8083.test.js: once then hourly; unmeasured counts; gate change said at once; Settings off;
CONTROL logged ticks add nothing; bad inputs; server wiring and gate parity read from source. Mutations: no re-say,
logged-ticks-not-said, early return silent: each red.

## Review round 1 (opus): four WARNINGs, all fixed
- A lasting unreadable decision went silent after one line: quietLine now has its own hourly "running, but it could
  not work out the decision (why)" state, and counts a tick as said only when the board printed a line (`logged`).
- A failed record write read as "nothing new to record": its own state and line.
- A dry run was named "the usage poll is off": enabled() is asked before liveAllowed(), each with its own words.
- A cleared risk got a false quiet line: the board now logs it as a recorded change (it writes a record line).
- Also taken from the NITs: the start line says "timer set" and the current gate state; a tick that throws is said;
  the parity control no longer matches the function's own name.

## Review round 2 (sonnet): two WARNINGs, fixed
- A repeated gap tick (no log line of its own) fell into "nothing new to record": gap has its own state and line.
- Fewer than two subscription accounts read as armed and healthy: the sweep now returns because 'fewer-than-two'
  for that early return, and the log says it plainly. Pinned on a real one-account tick in autobalance-sweep-7152.
- NITs taken: the offWhy comment no longer claims the same order; a test message said the opposite of its check.
- NIT left: the first tick after start repeats "running" once after the start line (one line per start).

## Review round 3 (opus): no BLOCKER or WARNING; NITs taken
- Off states hourly on every default install: now said on change only. The start line seeds quietLine.
- A backwards clock silenced a running state: a time before the last line is due.
- The gate-order comment gave the wrong reason (a claim this loop wrote): deleted, not reworded; the test message
  now names the case the order protects (a poll that is off is not named as a dry run).
- Plan lines brought up to date. Left: the unmeasured count is not part of the state key (a change in it waits for
  the hourly line), by design.

## Review round 4 (sonnet): two WARNINGs, fixed
- A broken state keyed by its words would print every tick when the words change (a path, a pid): unreadable and
  gap are keyed by kind; the line carries the latest reason; the board's own line still says a new reason at once.
- The unmeasured count was read outside the guard, so a throw there would read as a failed tick: guarded on its own.
- NIT taken: the start line asks the Settings switch too, so it no longer says "running" before a "switched off in
  Settings" first tick.
- Note: on a default install (usage poll off) the start line is the only line saying the sweep is not running; a
  rotated log loses it. Accepted to keep an unchanged setting out of the log every hour.

## Review round 5 (opus): one WARNING, fixed
- An unreadable Settings switch read as "switched off in Settings": the sweep returns because 'setting-unreadable'
  (from an optional deps.settingUnreadable), the log says "its Settings switch could not be read", and the start line
  reads the switch once with the tick's own fallbacks, so both name the same state.
- NITs left: a throw inside the tick's own .then is reported as a failed tick (best-effort wording); a record
  unreadable at start is said by the existing "off" line and once more by the first tick.

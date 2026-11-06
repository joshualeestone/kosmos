# abquiet-8083: a quiet auto-balance sweep says it is running (#8083)

## Problem
On a board where nothing has been at risk since start, the sweep writes no record line (review 10 of #7152: a first
tick with nothing at risk writes none) and logs nothing, so "armed and quiet" and "not running" look the same.
Measured on Mortals 11-05: armed 15:26, no record and no log line by 20:12.

## Change
- engine/autobalance-sweep.js `quietLine(said, { nowMs, offWhy, did, unmeasured })`: returns a board-log line when
  the sweep's state (running / not running and why / switched off in Settings) changes, and once an hour while it
  holds. A tick the board already logs (recorded, gap, unreadable) adds nothing and counts as said.
- server.js: `autobalanceSweepOffWhy()` names the first shut gate of autobalanceSweepRuns({ forTick: true }), same
  gates and order; a start line "autobalance-sweep: started, every N min; the mover is on|off"; quietLine called at
  the tick's early return (with the reason) and at its end (with did and the unmeasured count).
- The record is unchanged.

## Decided
- Log, not Settings: the log is where an operator or agent looks when the record is empty; Settings already shows
  whether it is recording.
- Hourly, both states: 24 lines a day at most, enough to tell quiet from dead without reading code.

## Tests
engine/autobalance-quiet-8083.test.js: once then hourly; unmeasured counts; gate change said at once; Settings off;
CONTROL logged ticks add nothing; bad inputs; server wiring and gate parity read from source. Mutations: no re-say,
logged-ticks-not-said, early return silent: each red.

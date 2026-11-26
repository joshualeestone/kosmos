# besidelog-9139: a red suite names the runs that went beside it (kosmos#9139, the reading half)

Owner: Renet Tilley. Card: kosmos#9139. Writer half: branch heavycap-9139 (queued-heavy's capped wait), then
kosmos-relay relaycap-9139 (relay CI through it).

## Goal
When a run goes beside a holder (relay CI on Mortals, today outside the queue), the holder's red summary should say
so, so a red in that window reads as contention rather than as the change (PigeonPete's point on #9139).

## Steps
- [x] tools/lib/cut-guard.sh: kosmos_note_beside_run start|end <id> [label] appends to <marker dir>/beside-runs.log
      (mkdir lock, trimmed past 500 lines to 400, never fails a set -e caller); kosmos_beside_runs_since <epoch>
      lists the runs whose window overlaps [epoch, now] (a start with no end counts as open for at most 7200 s).
- [x] tools/run-tests.sh: its red summary prints those runs, counted from when the suite took its turn.
- [x] tools/test-cut-guard.sh: 17 arms (overlap, open bound, malformed lines, 20 concurrent writers, stale lock,
      unwritable dir, set -e, GNU stat order).
- [x] 5 blind review rounds, converged (rounds 4 and 5 no BLOCKER or MAJOR): besidelog-9139-reviews.md.
- [x] Full validation through queued-heavy: PASSED on 8b5d374f90 (diff hash 0ad7de720845).
- [ ] PR CI green, including the Linux shell shard for test-cut-guard.sh (the GNU stat order was once Linux-only).
- [ ] Merge; the writer half rebases onto main.

## Decisions
- A start with no end is open for 7200 s at most, so a crashed writer cannot mark every later red as contention.
  Weakest premise: that no beside run lasts longer than two hours (relay CI is bounded by its job's 60 min).
- The writer never fails its caller: a beside note is evidence for a reader, never a gate.

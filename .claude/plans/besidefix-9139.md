# besidefix-9139: a beside note is never lost, and the reader is order-independent (kosmos#9139 follow-up)

Owner: Renet Tilley. Found by Angel's CI on kosmos#9152 (11-26 19:06 UTC): "concurrent writers lost lines (486 lines,
299 of 300 writer lines)" in the beside log merged this morning (#9148).

## Steps
- [x] A writer that misses the lock writes a pending file (mktemp, renamed into place); readers read pending files,
      then the log; the next locked writer folds them in (and pending-tmp files older than 60 s), then trims.
- [x] The reader is order-independent: the newest start and the largest end per id; epochs more than a day ahead
      are skipped; it never ends an errexit caller.
- [x] The trim keeps the last 400 lines plus, for an id among them, its newest start and largest end from before the
      cut (only lines the reader accepts), so pairs are not split and the log stays bounded.
- [x] Arms in tools/test-cut-guard.sh for each; every fix mutated and each mutation reds the file.
- [x] 5 blind review rounds; rounds 4 and 5 found no BLOCKER or MAJOR.
- [x] Full validation through queued-heavy: PASSED on 2db15a78f8.
- [ ] PR; merge after the 0.8.26 holds lift.

## Decisions
- Pending files, not a longer lock wait: the give-up is a count, and load reaches it; a wait long enough to never
  give up would stall CI steps.
- Weakest premise: that nothing reads the log faster than a fold. A pending file made after a reader's glob is
  seen on the next read only.
- Not pinned by an arm, checked by hand in review 5: the date fallback's "epoch N" output, and the read order
  during a fold.

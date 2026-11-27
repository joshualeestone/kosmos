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
- [x] Full validation through queued-heavy: PASSED on 2db15a78f8 (superseded by the rounds below).
- [x] PR #9163 (head 1f3c510fc7 pushed); CI reds on three colleagues' PRs (#9152, #9156, #9164) came from main's
      version of the 300-writer arm, which this branch replaces.
- [x] Rounds 6 to 8 (11-26 evening), after a rewrite for review 5's two-holder path:
  - Serialized breaks under a "$d.break" lock; the lock is broken in place only while a second read gives the pid
    read once (round 6: two EMPTY reads compared equal across two changes of hands).
  - The holder pid is written by redirect and read back (a $( ) form named a dead subshell: 299 of 300).
  - A lock with no pid has the 300 s ceiling (round 7: a holder slowed past 10 s before its pid write was broken).
  - The break lock holds a file named by its taker's token; a takeover removes only the name it saw, and a taker
    breaks only if its token is the dir's only entry (rounds 7 and 8).
  - The release removes only a lock carrying its own pid; the reader runs three cats in turn; a fold touches its claim.
  - Every new arm was shown red under a mutation of its fix.
- [ ] New full validation on the final head, push, merge on green.

## Decisions
- Pending files, not a longer lock wait: the give-up is a count, and load reaches it; a wait long enough to never
  give up would stall CI steps.
- Weakest premise: that nothing reads the log faster than a fold. A pending file made after a reader's glob is
  seen on the next read only.
- Rounds stopped at 8 (the usage cap); round 8 found no BLOCKER. Not changed: failglob in a caller, pid 1 as no holder
  (older code). Accepted limits: a holder stopped over 300 s, a breaker stopped over 60 s, a reused pid until 300 s.
- Not pinned by an arm, checked by hand in review 5: the date fallback's "epoch N" output, and the read order
  during a fold.

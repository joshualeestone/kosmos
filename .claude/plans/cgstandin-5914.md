# cgstandin-5914: the queue arms' stand-in waiters outlive the arms (kosmos#5914, second cause)

## Goal
tools/test-cut-guard.sh's arms that read a stand-in waiter must not go red (or green) because that waiter exited.

## Cause (measured 2026-10-31)
The stand-in `wp` (perl, 60 s life) is the waiter for every arm from its start to its kill that reads it (#4498,
#4609, #4911, #5272, #7512). That span took 23 s while the box's load average was 30 (Run A, timestamps added in a
scratch copy of main). On a box loaded by two full suites (13:5x CDT) it outlasted 60 s: the lib dropped the dead
waiter's marker as stale and eight order arms went red together, one printing `(ahead: <pid>)`. Reproduced exactly
with a 2 s life (Run B): the same eight arms, the same shape. The first #5914 fix (q_ready) closed a different cause,
a stand-in recorded before it showed as itself.

## Change
- Both long-span stand-ins (`wp` before the queue-order arms, and `wp` before the run-tests.sh arms) live 600 s.
- Each has a #5914 FIXTURE arm before its kill: it must still be alive (by its command line, as q_ready reads it),
  and for the second its marker must still be there: dead early, its last arm would pass for the wrong
  reason.
- `WP_LIVE` holds the live stand-in for the EXIT traps active during each span and is emptied at its kill, the
  pattern RP_LIVE already uses.

## Done when
1. The file passes on main's lib.
2. With a 2 s life the FIXTURE arm fails by name (control). Run by hand, not in the suite: at 55bb1c5bb1 (rebased onto main) the
   file passed (205, 0 fail); with the first stand-in at 2 s its FIXTURE arm failed by name beside the eight order
   arms; with the second at 2 s only its FIXTURE arm failed (the last run-tests.sh arm had passed with no waiter).
3. PR open, CI green by name.

## Not changed
The other timed stand-ins were not measured. The `wp` for the #4498 "a clear box still waits behind an older waiting suite" arm keeps its 60 s life:
it serves one assertion, with KOSMOS_NO_WAIT=1, so its span is one call.

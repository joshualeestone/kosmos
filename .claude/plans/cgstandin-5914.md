# cgstandin-5914: the queue arms' stand-in waiter outlives the arms (kosmos#5914, second cause)

## Goal
tools/test-cut-guard.sh's queue-order arms (#4498, #4609, #4911, #5272) must not go red because their shared stand-in
waiter exited, on any box load.

## Cause (measured 2026-10-31)
The stand-in `wp` (perl, 60 s life) is the waiter for every queue-order arm from its start to its kill, a span of
23 s on a box at load 30. On a box loaded by two full suites (Raiden's #7261 run, 13:5x CDT) it outlasted 60 s: the
lib dropped the dead waiter's marker as stale and eight order arms went red together, one printing `(ahead: <pid>)`.
Reproduced exactly with a 2 s life: the same eight arms, the same shape. The first #5914 fix (q_ready) closed a
different cause, a stand-in recorded before it showed as itself.

## Change
- Life 60 s to 600 s.
- A FIXTURE arm before its kill: the stand-in must still be alive, so a box that slow again fails by name.
- Not added to the EXIT trap: $wp outlives its kill and a reused pid would be another process's.

## Done when
1. The file passes on main's lib (204 pass, 0 fail).
2. With a 2 s life the FIXTURE arm fails by name (control, measured).
3. PR open, CI green by name.

## Not changed
Other timed stand-ins in the file serve only a few lines each (30 to 300 s lives).

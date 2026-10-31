# datelessclock: the dateless limit fixture no longer depends on the time of day

## Why
main's test run went red on e1c0c65512 (20:23Z, 15:23 CDT) with one failure, `engine/limithold-5805.test.js` review 17,
in a file that commit does not touch. The fixture `DATELESS` fixes the reset at "3pm". The same file was green on the
run before (026c2de6b1) and red alone on main 2b308b83b0 at 15:28 CDT.

## The call
`DATELESS` reads three hours from now through the file's own `clockAt`, as its neighbours are relative to `Date.now()`.
Measured at 15:3x: 19 of 20 before, 20 of 20 after, same tree otherwise.

Rejected: changing status.js. The product reading a passed reset as no time is its stated behaviour; only the fixture
pinned a clock time.

## Weakest premise
The exact hours the old fixture fails were not mapped: the evidence is red after 3pm and green before it, not a sweep of
the day. The relative form does not depend on that.

# dmrace-7171: the too-short-thread arm cannot count another agent's request

Card: kosmos#7171. render-dm-earlier-5841's last arm ("#6086: a thread too short to scroll loads every earlier page by
itself") failed twice in the 0.7.68 staging cut under load and passed alone.

## Cause
The arm made #d-dmthread 4000px tall while Uma (an older page still left) was on screen. Uma's thread then could not
scroll, so the board asked for her page, which is correct product behaviour. Quiet, that request landed before the
`__asked` clear; under load, after it, and the arm read `uma:2,opal:5,opal:3,opal:1`.

## Decided
- Switch to an agent with nothing older (vale, 3 kept rows, the same shape as the first CONTROL) and settle BEFORE the
  tall style. Nothing can then be asked for at any speed. The assertion itself is unchanged.
- Rejected: a longer wait before the clear (still timing, only less likely); filtering `asked` to opal's entries (would
  hide a stray request for any other agent, which is a thing worth seeing).

## Proven
- Forced slow ordering (clear, then the style, then a 400 ms wait): the OLD arm fails with `uma:4,uma:2,opal:...`, the
  shape seen in the cut; the NEW arm passes. As committed, 48 PASS, 0 FAIL.

## Weakest premise
That vale's thread, 3 rows with nothing older, asks for nothing when it becomes too short to scroll. The board's
earlierNearTop (web/index.html, `if (!first) return` with first = olderCount) returns before any fetch when nothing
is older, whatever the thread's height.

## Not changed
The product. Only the check.

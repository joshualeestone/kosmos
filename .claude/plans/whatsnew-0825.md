# whatsnew-0825: What's New for 0.8.25

Card: the gap alarm (kosmos#1050), 2026-11-26 03:23 CST: main 92 commits past staging 0.8.24.

## What 0.8.25 carries that a board user sees
Read from every PR merged since v0824 (c806ac5dc1). Most of the 92 commits are test-only (#9104, #9115, #9045, #9123),
internal (#9079 promote gate, #9085 send gate, SECURITY.md), or the iPhone app, which ships through TestFlight and is
not in the board's window (the pool has no iPhone entries). Board-visible:
- #9083: a "Not logged in" that a command or tool prints is no longer read as the agent's own sign-in failure. Added,
  pending, every platform, rank 12.6 (beside the sign-in items 12.5 and 13).
- #9097: Windows reads a Claude login's expiry, so it can warn before a login ends. Added as HELD, Windows only. It is
  merged but has not been seen working on a real Windows box, and a highlight claims a behaviour. When the box shows
  the warning, set it to pending (kosmos#9097 says so).
- #9081: a did-you-mean one level down on the kosmos CLI. Added as notesOnly (an agent's command), rank 155.
  Its first wording named Mac and Windows with no platforms tag; build refused it; reworded to name none.

## The built window (node tools/whats-new-pool.js build 0.8.25)
The build read prod 0.8.24 (and Windows prod 0.8.24) and marked 0.8.24's five highlights shown. The window is the
top four pending:
- A closed question says who closed it (carried from 0.8.23)
- An expired Claude login is said (0.8.23)
- A printed sign-in message is not the agent's (new)
- An old sign-in message no longer misleads (0.8.23, mac)

Four, not five: nothing else pending is board-visible and not notesOnly. Checked:
- whats-new-check 0.8.25: mac 4, windows 3;
- prod-check exit 0;
- the pool and engine What's New tests pass, 68 of 68.

## Rejected
- Listing the iPhone changes: the board window is not where an iPhone user sees them.
- Putting #9097 in the window now: it would tell Windows users about a warning nobody has seen work on Windows.

## Weakest premise
That the three 0.8.23 carry-overs still describe main. Each was true when written. A later change could have reworded
or replaced one, and the build does not check a highlight against the code.

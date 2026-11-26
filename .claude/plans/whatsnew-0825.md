# whatsnew-0825: What's New for 0.8.25

Card: the gap alarm (kosmos#1050), 2026-11-26 03:23 CST: main 92 commits past staging 0.8.24.

## What 0.8.25 carries that a board user sees
Read from every PR merged since v0824 (c806ac5dc1). Most of the 92 commits are test-only (#9104, #9115, #9045, #9123),
internal (#9079 promote gate, SECURITY.md), agent-facing (#9119 teaches --no-reply in project instructions), or the iPhone app, which ships through TestFlight and is
not in the board's window (the pool has no iPhone entries). Board-visible:
- #9083: a "Not logged in" that a command or tool prints is no longer read as the agent's own sign-in failure. Added,
  pending, Mac only (review 1), rank 12.6 (beside the sign-in items 12.5 and 13).
- #9097: Windows reads a Claude login's expiry, so it can warn before a login ends. Added as HELD, Windows only. It is
  merged but has not been seen working on a real Windows box, and a highlight claims a behaviour. When the box shows
  the warning, set it to pending (kosmos#9097 says so).
- #9081: a did-you-mean one level down on the kosmos CLI. Added as notesOnly (an agent's command), rank 155.
  Its first wording named Mac and Windows with no platforms tag; build refused it; reworded to name none.

## The built window (node tools/whats-new-pool.js build 0.8.25)
The build read prod 0.8.24 (and Windows prod 0.8.24) and marked 0.8.24's five highlights shown. The window is the
top four pending:
- A closed question says who closed it (carried from 0.8.23)
- An expired Claude login is said (0.8.23, mac since review 2)
- A printed sign-in message is not the agent's (new, mac)
- An old sign-in message no longer misleads (0.8.23, mac)

Four, not five: nothing else pending is board-visible and not notesOnly. Checked:
- whats-new-check 0.8.25: mac 4, windows 1 (after reviews 1 and 2);
- prod-check exit 0;
- the pool and engine What's New tests pass, 68 of 68 (rerun after review 2).

## Rejected
- Listing the iPhone changes: the board window is not where an iPhone user sees them.
- Putting #9097 in the window now: it would tell Windows users about a warning nobody has seen work on Windows.

## Review 1 calls
- #9083's line is tagged mac. Its fix reads an agent's tmux screen; a Windows agent has none and reads its sign-in from
  the stream, which #9083 did not touch. Untagged it would tell Windows users about a change they do not have. The cost:
  a Linux board shows only untagged highlights (engine/whatsnew.js has no linux tag), so Linux, where the fix does
  apply, does not hear of it. Saying less there is better than claiming something false on Windows.
- The line says "a command or MCP tool", not "a command or tool": the fix covers the first output block of a `!`
  command, Bash, BashOutput, Monitor or an MCP tool only. The same line in a Read or Grep result is still read as a
  sign-in failure.
- #9085 (#9112) is not internal: on Windows, a send while the agent list cannot be read now answers 409, "try again",
  where it said the agent did not exist. Left out of the window: an error path a person rarely meets, not a highlight.
- The carry-overs were checked against main by the reviewer (status.js WAIT_CLEARED_SHOW_MS and the card sentence;
  server.js loginEnded with accountline.js and autobalance.js; engine/oldsigninline.js, Mac only). All three hold.

## Review 2 calls
- "An expired Claude login is said" (a 0.8.23 carry-over) is tagged mac. Its accounts line and its keep-agents-off
  half rest on loginEnded, which needs the login's expiry date; off macOS that date is read only since #9097, which has
  not been seen working on a Windows box. Untagged, it would claim the same unseen Windows behaviour that #9097's own
  highlight is held for. Windows now shows one highlight; the build allows it.
- The plan's counts and the #9083 platform line were stale after review 1; corrected here.

## Review 3 calls
- The held #9097 line named Mac as well as Windows while tagged windows only; engine/whatsnew.js would refuse the
  window the day it is set to pending. Reworded to name only Windows.
- #9119 has no notesOnly entry: it changes the instructions agents are given, not a command they run, and the notes
  `kosmos whats-new` prints are about commands and behaviour an agent can use.

## Review 4 calls
- The #9083 line now says the command or MCP tool prints Claude's own "Not logged in" line: the fix needs that exact
  sentence with its remedy (NOT_LOGGED_IN_ROW), not any text that says "not logged in".
- When #9097's held item is set pending (rank 12.7) the window becomes five items, mac 5 and windows 2; the four here
  is the count for this cut only.

## Weakest premise
That "rarely meets" is right for #9112's 409. If Windows sends fail that way often, it deserves a line.

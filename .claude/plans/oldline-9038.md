# oldline-9038: an old sign-in line on an idle screen stops recording refusals for a repaired account (kosmos#9038)

## Problem
An agent repaired off-screen keeps Claude's old sign-in line in its bottom rows until its next turn. The account check reads
HEALTHY, so the card is calm, but a HEALTHY is kept 30 s: every re-check tick reads UNCHECKED, the card reads Sign-in Issue
for a moment, and a refusal is recorded against a working account (about every 35 s).

## Call
Evidence that the line is old: the account's login date moved LATER after the board first saw that line
(engine/oldsigninline.js). Then, and only when the last settled check said HEALTHY, the re-check tick reads as HEALTHY.
Everything else is as before: date unchanged (a revoked token), date unread, a new line, another account, a board restart,
a check that says signed out or cannot tell.
- The line's fingerprint: the last sign-in row, the 8 rows above it, and how many sign-in rows the capture holds.
- The first date counts only from a read that BEGAN at or after the line was first seen. One read before it, with a sign-in
  in between, would make a new refusal look old.

## Rejected
- Trusting the last HEALTHY: took the badge off a revoked account (#9031, round 2).
- The count of lines alone: an old one scrolling off as a new one prints keeps it.
- Persisting what was seen: a restart falls back to the old behaviour, which is safe.

## Left, declared
- A sign-in within the minute after the line appears (before its first date is read) is not seen as later: as on main.
- A screen that scrolls the old line's neighbours away starts over: as on main.
- macOS only, where the login date is read (the Keychain). Elsewhere nothing changes.
- A board restarted after the sign-in: as on main until the next turn.

## Weakest premise
That a refusal printed again always changes the count or the 8 rows above it. It fails only on a capture full of identical
exchanges, and then only between a sign-in and the next differing row.
Second: that a renewal never moves the login date later (read in Claude Code 2.1.332, not guaranteed by Anthropic).

## Test
engine/oldsigninline-9038.test.js, 13 tests through the real snapshot(), with a 20-minute run repaired, revoked, and refused
again; 23 mutations, all red.

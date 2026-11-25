# oldline-9038: an old sign-in line on an idle screen stops recording refusals for a repaired account (kosmos#9038)

## Problem
An agent repaired off-screen keeps Claude's old sign-in line in its bottom rows until its next turn. The account check reads
HEALTHY, so the card is calm, but a HEALTHY is kept 30 s: every re-check tick reads UNCHECKED, the card reads Sign-in Issue
for a moment, and a refusal is recorded against a working account (about every 35 s).

## Call
Evidence that the line is old: the account's login date moved LATER after the board first saw that line
(engine/oldsigninline.js). Then, and only when the last settled check said HEALTHY within one re-check, the re-check tick
reads as HEALTHY. Every doubt is as before: date unchanged (a revoked token) or unread, a new line, the line off the screen
for one tick, three minutes unseen, another run of the agent or no run known, a process that reads another login or could
not be read, a block of rows that stands twice on the screen, a board restart, a check that says signed out or cannot tell.
- The line's fingerprint: the last sign-in row, the 8 rows above it, and how many sign-in rows the capture holds.
- The first date counts only from a read that BEGAN at or after the line was first seen.
- The run is the supervisor's run instance on the session; the process's own CLAUDE_CONFIG_DIR is read once per line
  (tmux pane pid, then `ps eww`), asynchronously, and must name the login the date belongs to (#2129, #6095).

## Rejected
- Trusting the last HEALTHY: took the badge off a revoked account (#9031, round 2).
- The count of lines alone: an old one scrolling off as a new one prints keeps it.
- Keeping what was seen after the line leaves the screen (built first; review round 1's blocker): a restart or a new turn
  prints the same text, and a revoked account read calm.

## Left, declared
- A repaired agent that takes a turn and goes idle with the old line still in its bottom rows: as on main.
- A sign-in within the minute after the line appears (before its first date is read) is not seen as later: as on main.
- macOS only, where the login date is read (the Keychain). Elsewhere nothing changes.
- One `security` read a minute, and one tmux and one ps per line, for an agent showing a refusal.

## Weakest premise
That two refusals the board sees with no look between them (at most one tick) differ in the count or the 8 rows above.
`/clear`, the same first message and the same refusal, all between two looks and after a sign-in, would read old.
Second: that a renewal never moves the login date later (read in Claude Code 2.1.332, not guaranteed by Anthropic).

## Test
engine/oldsigninline-9038.test.js, 23 tests through the real snapshot(): 20 minutes repaired, revoked, refused again,
restarted, off the screen and back, another login, a hung check; 36 mutations, all red.

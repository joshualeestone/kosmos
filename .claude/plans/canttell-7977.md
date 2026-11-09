# canttell-7977: say why an agent reads "Can't tell" on `kosmos agent list`

Card: kosmos#7977 (from the 0.8.0 cross-seat report, #8298 item 3: seven agents read Can't tell, up from five).

## Why this slice, not a fix
The seven are on the five-family board, on another computer; the report names none of them and its seat notes are
only there. From source, "Can't tell" has three shapes: a paneless agent (no window here, known by token and
reports; PANELESS_DEFAULT is unknown until it reports), a job running where this board cannot see it (#668), and a
pane whose state cannot be read (a stale report against an idle screen, the shape #8002 fixed on a Mac). Each needs a
different fix, and only the seats on that board can see which. So the list now says it, and the next cross-seat
run measures all seven at once.

## Change
- engine/clilists.js rosterRow: for a "Can't tell" row only, `cantTell` (no-window / unseen / unread, from the card's
  paneless, running and jobRunningUnseen), and the last self-report's state and time (`lastReportState`,
  `lastReportAt`), or `neverReported`. No words of a report travel.
- stateLines: one line for the shape, one for the last report.
- server.js /api/agents/list: reads selfreport.read for "Can't tell" rows only.
- Help line in install/kosmos and tools/windows/kosmos-cli.js (identical).

## Tests
engine/clilists.test.js (3), server.agent-token-gate-4491.test.js (1 route test, with an idle control). 37 related
files green. 8 mutation arms red.

## Next slice
Once a cross-seat run reports the seven, fix the shape(s) that dominate.

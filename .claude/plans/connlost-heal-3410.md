# Plan: #3410 PR 2a, a retrying pane reads working (prerequisite for the self-heal)

## Finished looks like
An agent whose pane shows Claude Code's live "Retrying in Ns · attempt K/N" line classifies
WORKING. Only the pane left after the retries run out reads connection_lost. The auto-restart
(PR 2b) can then act on connection_lost without killing a turn that is still retrying.

## Why this first (measured 2026-09-24)
The #3410 comments in status.js told PR 2 to confirm, against a real captured retry sequence,
that a retrying pane classifies WORKING. Measured with Claude Code 2.1.281 in a throwaway tmux
session, API pointed at a closed port, one frame a second:
- seconds 2 to 153 showed "✻ Connection refused — … (ECONNREFUSED) · Retrying in 5s · attempt 4/10"
  and **read connection_lost** (WORKING_LINE needs an ellipsis and a "(Ns" timer; this line has neither)
- after attempt 10/10 the pane showed "⏺ API Error: …" plus the turn footer, and read
  connection_lost once the history filled the screen, which is correct
So the premise was false: a self-heal on connection_lost would have restarted agents mid-retry.

## Change
- `engine/status.js`: `RETRYING_LINES` (one measured layout: a column-0 spinner-glyph line ending "· Retrying in Ns · attempt K/N")
  classifies WORKING with "it is retrying a failed request to the API", just above the
  connection_lost rule. It is keyed on the retry suffix, so other network errors that retry the same way match.
- Two comments corrected: the placement note now names RETRYING_LINES, and the "premise unverified"
  warning now records the measurement.
- `engine/status.connlost-retry-3410.test.js`: real captured frames (retrying reads WORKING at several
  attempts/delays; the wedged pane reads connection_lost; a retry line quoted in agent output does not).

## Rejected
- A new `retrying` state: every consumer (tiles, heartbeat, self-heal) already treats WORKING as
  "leave it alone", and a new state would need a reconcileReport rule and every coupling site.
- Keying on the error text: the retry suffix is the live-ness signal; the error text also appears
  in the final wedged line.

## Weakest premise
Unmeasured shapes that would read connection_lost while still retrying (the false-negative
side; PR 2b's persistence-across-sweeps bound must absorb them): a `*` spinner frame, a
minutes-formatted delay ("Retrying in 1m 5s", a long retry-after on 429/529), and #874's
"└ Retrying in N seconds…" layout under a network error (deliberately not matched: matching it
anywhere in the tail made a wedged pane read working, the worse false-calm direction).
One Claude Code version, one error (ECONNREFUSED). DNS or timeout errors are assumed to draw the
same retry suffix, which has not been captured. A UI change would reopen this. At 80 columns
(measured, with and without -J) Claude Code truncates the retry line's error text with "…" and
keeps the suffix, so the line does not wrap; row-gluing was tried and removed as unreachable.
For PR 2b: the final "⏺ API Error: …" line is agent output, which does wrap, so on a narrow pane
CONNECTION_LOST_MESSAGE's phrase can split across rows and the wedged pane read idle. That
needs measuring before the self-heal relies on connection_lost.

## Next (PR 2b, separate)
The self-heal sweep: restart on connection_lost only when it persists across sweeps with an
unchanged pane tail, connectivity is back, and a loop guard escalates rather than looping
(class1-autohandle's shape).

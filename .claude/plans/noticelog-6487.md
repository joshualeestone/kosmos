# noticelog-6487: the board's log says why a phone notice showed plain (kosmos#6487)

## Finished looks like
When a lock-screen notice shows plain (no picture, no words), the sending computer's board.log says which id the push
carried, whether the phone can ask about that kind, whether the phone asked, and what it was answered (or why not).

## Why
Josh's plain "Jonah Ellis needs you" (TestFlight build 3, 2026-10-26 17:23): the cause is NOT established. Candidates:
an id the phone cannot ask about (crashloop:/stuckterminal:/ownbounds:), the borrowed-name 404, a report with no words
at that time, or the phone's request never reaching the board. Jonah's board is not on this Mac, so only a log on the
sending board can tell them apart, next time.

## Built
- engine/phonenotice.js explain(id) -> { got, why } (wordsFor is its `got`), idKind(id).
- engine/phonenotify.js happened(): one line per push actually sent (after every gate and the cooldown).
- server.js GET /api/phone/notice: one line per ask.
- docs/phone-notifications.md: how to read the two lines.
Never the words, never the id's time; the agent's session name, control characters blanked.

## Decided
- Separate PR from richnotice-6487 (the words fix): that one is reviewed and converged; this is new code with its own
  review. They touch the same file (phonenotice.js) in different functions.
- Logs to stderr, as defaultSend's refusals already do; logstamp stamps the time, so the two lines pair by time.
- Weakest premise: that the person's board.log is what gets read. Josh's own board is; Jonah's is on another computer.

## Review
- Round 1 (.claude/plans/noticelog-6487-review1.md): 0 blockers, 2 warnings, 3 nits, all fixed. The sent line now
  judges the id AS SENT (cut to 120 bytes; a cut id that still parses says the phone's ask finds no words); the doc no
  longer claims a missing ask always means the phone never reached the computer; a report:/reply:/post: id that does
  not parse answers `malformed-id`, not `unaskable`; no "for" with an empty session; the unused setLog seam is gone.
- Round 2 (noticelog-6487-review2.md): 0 blockers, 1 warning, 5 nits. Fixed: the doc's "no ask" rule applies only to
  a sent line that says the phone can ask; the sent line is written after the send (a throw logs nothing, tested with
  a control); names go through logName (C0, C1, U+2028/9 blanked, 80 chars); the ask line no longer claims the phone
  asked or says "a unknown"; a post ask is in the route test; the doc says <session>. KEPT: no route test for
  borrowed-name (it needs a stranger's pane claiming a name, the 6487 route test's borrowedName case covers the 404;
  the log branch is one ternary arm, read).

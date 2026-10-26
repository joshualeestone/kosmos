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

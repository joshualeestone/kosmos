# msgid-4888: two overlapping sends never share a message id

## The defect (kosmos#4888, 0.7.15 diagnostic N2)
Two room posts made together were reported with the same id (m721, m722, m763). Measured on Agent1s's own log
(2026-10-01): m211 twice, 128 ms apart, the same direct message (renettilley to Echo), both delivered.

## Mechanism (read on origin/main 26540d803)
Both send paths mint the id from the log (`highest id + 1`), then AWAIT the delivery (`sendAsync` ->
`chat.deliverAsync`, #4468; a room post fans out, #4765/#4808), and append the row only when the delivery finishes.
Two sends whose deliveries overlap both read the same highest id, so both take the next one. One board is enough.
My first card comment blamed two processes; that was read from a stale checkout and is corrected on the card.

## Change
`engine/messages.js`: `mintId(parsed)` replaces both inline mints (direct ~1214, room ~1839). The board keeps the
last id it handed out (`ID_HIGH`); a new id is the larger of that and the log's highest, plus one, taken
synchronously before any await. `resetForTests` clears it. A refused send has used its id (the stale comment that
said the next send re-mints it is deleted).

## Not done, deliberately
- A second board writing the same store is not covered (an in-memory mark cannot see another process). The port
  bind refuses a second board on the same port; nothing refuses one on another port. Rejected: a lock and counter
  file on every send, which answers a mechanism that is not the live one and puts a file lock on every message.
- No retroactive repair of logs that already hold a duplicate id; reactions and --in-reply-to on those stay
  ambiguous.

## Tests (engine/messages.test.js)
- two DIFFERENT messages held open together: different ids in the reply and in the log;
- two room posts from two agents held open together: different ids;
- a refused send does not hand its id to the next one.
Red check: ids from the log alone (`ID_HIGH = inLog + 1`) must fail both overlap tests.

## Weakest premise
That `withFleet`'s early restore (it returns before an async test's promise settles, as the #4580 tests already
rely on) leaves the log readable when the held deliveries finish. The #4580 tests make the same assumption and pass.

## Review 1 (opus, blind): 0 blockers, 1 warning, 3 nits; all taken
- W: the refused-send test could not fail without the fix (a refusal returns id: null, and the two later sends
  were sequential, so the log alone already separated them). Now the refusing delivery keeps the envelope it was
  handed, the test reads the id the refused send used from it, and asserts the next send got a different one.
  Red check now requires all three #4888 tests to fail under log-only ids.
- Nits: the room path's comment about a refused post's spill and the next mint is deleted (no longer true while the
  board runs); readLog's "ids restart" now says only on a board that has minted none since it started; the duplicate
  PARSE-ONLY comment at the direct call site is removed (mintId keeps it).

## Final validation on Mortals (19:30): 13,796 tests, 1 failed, fixed
- `#4447: a link the agent planted in its own folder cannot turn the spill into a write somewhere else` predicted the next
  id as the log's highest + 1. Its step (a) refuses a send first, which now uses m1, so the real next message is m2 and
  the planted link sat at the wrong name ("the message file is not a fresh file of its own"). The protection held: the
  victim file stayed untouched. A test assumption this change made stale, not a regression.
- Fix: `messages._nextIdForTests()` (read-only: the id the next send will get, from the log and the board's mark), used
  by both #4447 tests that plant a file at the next id.

# statusrace-5715: #4468 asserts ordering, not a 500 ms wall-clock race

kosmos#5715 (found by April). server.test.js "#4468: status answers during a 25-recipient post" raced GET /api/status
against a fixed 500 ms timer. It failed under host load (load 20-26) and passed alone.

## Done looks like

- The test asserts what it means: status answered while the room post was still held open. The post is held by the
  test's own paste gap until after the check.
- A wall-clock bound remains only as a deadlock guard (15 s) with a named message.
- A forced queue-behind still fails it.

## Decisions (reversible)

- Ordering over scaling: the card offered scaling the bound. Ordering is the actual claim and needs no number.
- 15 s guard: long enough that load cannot trip it, short enough that a real deadlock fails rather than hangs the
  suite.

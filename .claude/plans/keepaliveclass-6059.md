# keepaliveclass-6059: long threads in server tests are seeded in one write (#6059, the class)

Card: joshualeestone/kosmos#6059. PR #6078 fixed one test; the same `fetch failed` / `ECONNRESET` then hit
`server.projects.test.js:2488` on PR #6079 (6,107 ms, 1-minute load 1.43 on 10 cores).

## What is measured, and what is not (review 1 corrected my first wording)
- Measured: on CI a request on a pooled socket after a long synchronous gap (hundreds of appends between two requests)
  came back ECONNRESET: runs 38158076792 and 38184258270 (dm-older/dm-rollover-5841), PR #5751 (server.projects, which
  then skipped fsync while seeding, seedUnflushed, and it came back anyway), #6059 (dm-owes-4340) and PR #6079
  (server.projects again). Every `chat.appendMessage` reads and rewrites the whole thread.
- NOT settled: what closes the socket. dm-older-5841's comment names the server's 5 s keep-alive, but
  dm-rollover-5841 saw it again with the keep-alive at 120 s ("that timer was not the whole cause") and moved to a
  new connection per request (agent: false). So this branch claims only that it removes the gap.

## The call
- test-support/thread-fixture.js `appendMany(chat, projectId, agent, entries, bornAt)`: the first entry through
  appendMessage (the engine's own row), the rest that row with only text and at changed, in one write. Falls back to
  real appends when the shortcut could change a test's meaning: a field other than text/at differs, a thread that would reach MAX_MESSAGES (rollover), or a
  refused first append, or a text that is not already what appendMessage would store (`chat.storedWithin`;
  review 1: it collapses spaces and trims). Entries with no time get the first row's time plus their index in ms (a time is a row's
  identity for replies).
- Used at the three remaining sites, each asserting the fast path was taken (`via: 'one write'`), so a silent
  fallback cannot bring the slow loop back:
  - server.projects.test.js "the thread GET returns a bounded tail" (project thread): 7.0 s to 94 ms locally
  - server.projects.test.js "the thread is bounded" (direct): 8.5 s to 46 ms
  - server.dm-rollover-5841.test.js "a reaction made on a carried row survives": 4.0 s to 123 ms (speed only:
    that file uses a new connection per request, so the gap could not reset a socket there)
- Not touched: server.dm-owes-4340.test.js (#6078, its own one-write), server.dm-older-5841.test.js (its author seeds
  before any request), engine tests with no server.

- `seedUnflushed` had no other callers and is removed with its comment (its history is above).

## Rejected
- Raising the test server's keepAliveTimeout or closing idle sockets before a fetch: a product-side or timing-side
  change for a test problem, and closing idle sockets races the same way.
- Re-trying the fetch: hides a real reset.

## Proven
- test-support.thread-fixture.test.js: 20 same-shaped entries in one write read back deepEqual to 20 real appends
  (the shape control); entries with no time get distinct, increasing times; a differing field, a text the engine
  would store differently ('a  b') and a thread at the cap each fall back; a text it stores unchanged ('café') does
  not (control). Mutation: the old printable-ASCII check reds the 'a  b' arm.
- server.projects.test.js and server.dm-rollover-5841.test.js: 199 of 199 pass.

## Weakest premise
That there is no fourth site. Found by a sweep for loops of 100+ near appendMessage in test files; a loop written
another way (a mapped array, a helper elsewhere) could be missed. No guard stops the next one being written.

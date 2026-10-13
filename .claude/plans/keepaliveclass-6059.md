# keepaliveclass-6059: long threads in server tests are seeded in one write (#6059, the class)

Card: joshualeestone/kosmos#6059. PR #6078 fixed one test; the same `fetch failed` / `ECONNRESET` then hit
`server.projects.test.js:2488` on PR #6079 (6,107 ms, 1-minute load 1.43 on 10 cores).

## Mechanism (already diagnosed in this repo)
server.dm-older-5841.test.js's test.before: ~400 synchronous appends between two fetches held the event loop past the
server's 5 s keep-alive, and CI's fetch reused the socket the server was closing (CI run 38158076792). Every
`chat.appendMessage` reads and rewrites the whole thread, so 200 appends between two requests is enough on CI.

## The call
- test-support/thread-fixture.js `appendMany(chat, projectId, agent, entries, bornAt)`: the first entry through
  appendMessage (the engine's own row), the rest that row with only text and at changed, in one write. Falls back to
  real appends when the shortcut could change a test's meaning: a field other than text/at differs, text that is not
  plain printable ASCII (appendMessage normalises stored text), a thread that would reach MAX_MESSAGES (rollover), or a
  refused first append. Entries with no time get the first row's time plus their index in ms (a time is a row's
  identity for replies).
- Used at the three remaining sites, each asserting the fast path was taken (`via: 'one write'`), so a silent
  fallback cannot bring the slow loop back:
  - server.projects.test.js "the thread GET returns a bounded tail" (project thread): 7.0 s to 94 ms locally
  - server.projects.test.js "the thread is bounded" (direct): 8.5 s to 46 ms
  - server.dm-rollover-5841.test.js "a reaction made on a carried row survives": 4.0 s to 123 ms
- Not touched: server.dm-owes-4340.test.js (#6078, its own one-write), server.dm-older-5841.test.js (its author seeds
  before any request), engine tests with no server.

## Rejected
- Raising the test server's keepAliveTimeout or closing idle sockets before a fetch: a product-side or timing-side
  change for a test problem, and closing idle sockets races the same way.
- Re-trying the fetch: hides a real reset.

## Proven
- test-support.thread-fixture.test.js: 205 same-shaped entries in one write read back deepEqual to 205 real appends
  (the shape control); entries with no time get distinct, increasing times; a differing field, non-ASCII text and a
  thread at the cap each fall back (control: the fast path when nothing forbids it).
- server.projects.test.js and server.dm-rollover-5841.test.js: 199 of 199 pass.

## Weakest premise
That there is no fourth site. Found by a sweep for loops of 100+ near appendMessage in test files; a loop written
another way (a mapped array, a helper elsewhere) could be missed. No guard stops the next one being written.

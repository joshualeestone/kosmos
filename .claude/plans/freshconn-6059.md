# freshconn-6059: every test's fetch opens a new connection, so an idle kept-alive socket cannot reset

Card: kosmos#6059 (reopened 2026-10-23 with two more occurrences). #6833 fixed server.test.js alone by giving its
own req() `agent: false`. The same `fetch failed` / `read ECONNRESET` then failed `suite (node)` twice on PR #7021,
in server.agent-files-3614 and server.projects, files it did not change. 239 of 279 server test files call fetch.

## Finished looks like
Every node test process started by tools/run-tests.sh uses a global fetch that opens a new connection per request,
so no test can be handed a pooled socket the server or the runner has closed. A test proves it: three requests open
three connections with the preload, and the same three share a connection without it (the control). The suite line
carries the preload, and that is pinned.

## Change
- test-support/fresh-connections.js (new): preloaded by `--require`, like launch-guard.js and tool-guard.js. A
  throwaway fetch of a data: address creates Node's built-in undici agent synchronously (measured, Node 26.8), and its
  own class builds a `pipelining: 0` agent (undici's documented way to turn keep-alive off) under
  Symbol.for('undici.globalDispatcher.2'). If that ever fails it says so once on stderr and changes nothing.
- tools/run-tests.sh: the third `--require` on the flush-left suite line, with a note.
- test-support.fresh-connections-6059.test.js (new): the pin, the in-process check, and the with/without control.

## Decided
- One preload, not 239 edits: the same reset can hit any file that calls fetch, and a per-file fix (as #6833 was)
  leaves the next one to fail on someone else's PR.
- Rejected: `Connection: close` on each request. Measured: Node's fetch ignores it (three requests, one connection).
- Rejected: requiring the `undici` package. It is not a dependency; the built-in agent's own class needs none.
- Fail soft, not hard: if Node moves its agent, the suite still runs (pooled, as before) and this card's test goes
  red with the reason, rather than every test in the suite failing at once.

## Weakest premise
That `Symbol.for('undici.globalDispatcher.2')` stays where Node keeps fetch's agent. It is undici's own registry key
(.1 is the older one, which the measurement shows fetch no longer reads). If it moves, the pin test goes red.

## Validation
- The new test: 4/4 with the preload; 2 fail without it (the pin and the in-process check), which shows they can.
- A focused run through tools/run-tests.sh --only (queued turn): the two files that reset tonight, server.test.js,
  engine/agykeep-5812 (tracks its sockets), the run-tests pins (tools.run-tests-only-4929, create.launch-refuse-3605),
  test-support.tool-guard-4326, and the new test.

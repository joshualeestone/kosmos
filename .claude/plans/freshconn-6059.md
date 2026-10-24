# freshconn-6059: every test's fetch opens a new connection, so an idle kept-alive socket cannot reset

Card: kosmos#6059 (reopened 2026-10-23 with two more occurrences). #6833 fixed server.test.js alone by giving its
own req() `agent: false`. The same `fetch failed` / `read ECONNRESET` then failed `suite (node)` twice on PR #7021,
in server.agent-files-3614 and server.projects, files it did not change. 239 of 279 server test files call fetch.

## Finished looks like
Every node test process started by tools/run-tests.sh uses a global fetch that opens a new connection per request,
so no test can be handed a pooled socket the server or the runner has closed. A test proves it: five requests, a tick
apart, open five connections with the preload, and the same five share a connection without it (the control). The suite line
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

## Review round 1 (2026-10-23)
- Fixed: the in-process check passed without the preload. Back to back, request 2 raced the socket's return to the
  pool and always opened a second connection. Requests now go N=5, a tick apart; 8/8 runs fail 2 without the
  preload and pass 4/4 with it.
- macOS TIME_WAIT leak: REASONED, not measured. With the preload undici sends `Connection: close`, so the server
  closes first and holds the TIME_WAIT on its listening port, not on a port from the client's pool. netstat on this
  Mac shows zero sockets of any state (control: zero ESTABLISHED with 16 agents running), so it cannot measure it.

## Review round 2
- Fixed: the two in-process checks always failed under a bare `node --test <file>`, which is how the cut's isolation
  rerun (tools/lib/cut-rerun-guard.sh) re-runs a red file, so a contention red here could never be dismissed. They
  now skip unless KOSMOS_TEST_RUN is set (run-tests.sh always sets it). Measured three ways: suite shape 4 pass;
  marker without the preload 2 fail; bare 2 pass, 2 skipped.
- Fixed: the probe's spawn timeout goes through scaleBudget like the suite's other budgets.

# slowreqflake-6876: the slow-request integration test stops depending on a slow runner

Card: kosmos#6876. Owner: Ice Cream Kitty (wrote the test in #6721, PR #6745).

## Problem

`server.slowrequest-6721.test.js`, "the real board logs a request past the limit", sets
`KOSMOS_SLOW_REQUEST_MS=1` and expects one `GET /api/health` to be logged. `watchSlowRequest`
measures `Date.now() - t0` in whole milliseconds and returns without logging when `ms < limit`.
A request answered inside one millisecond measures 0 and is never logged, so the test fails on a
fast runner (seen on PR #6874's CI: `the request was not logged: []`).

## Change

Test only. While that one request runs, `Date.now` is replaced by a clock that steps a second on
every read; it is restored in the same `finally` that restores `process.stdout.write`.
`watchSlowRequest` reads `Date.now` at call time (`typeof o.now === 'function' ? o.now : Date.now`),
so the stub reaches it without a new seam in server.js.

The threshold itself (under the limit writes nothing, over it writes once) stays pinned by the
unit tests earlier in the same file, which inject `now`.

## Rejected

- A deliberately slow route: adds product surface for a test.
- Raising the measured value in server.js (for example rounding up): changes product behaviour to
  suit a test.
- A sleep inside the request: there is no seam for one without touching server.js.

## Weakest premise

The stub is process-wide, for the fetch and the 100 ms wait after it, so anything in the process
that reads `Date.now` in that window sees time jump by seconds: code on the request path, and async
work `start(0)` began that resumes then. One reader on the request path is known:
`remoteStepUpRefusal` reads it before the route, which is why the line says 2.0 s (it returns
before using the value for a loopback request). Timers do not read `Date.now`, so the wait is
unaffected. A reader that misbehaved on a jumped clock would need a narrower stub.

A value stored in that window (a cache time such as `TOKEN_GUARD_CACHE.at`) stays a few seconds in
the future after the restore, so it reads as fresh a few seconds longer. Nothing after this test in
the file uses the real board today. A board test added after it should move above it, or the stub
should narrow. Rejected for now: stepping only the reads `watchSlowRequest` makes, which would
depend on the order in which server code reads the clock.

The test also depends on `watchSlowRequest` reading `Date.now` per request. That is guarded: the
duration assertion requires at least 1.0 s, and a real request under a second reads 0.x s.

## Verification

- The file alone: 7/7 pass.
- Control: a frozen `Date.now` during the request fails with the CI message,
  `the request was not logged: []`.

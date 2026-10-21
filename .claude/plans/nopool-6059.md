# #6059 (reopened): server.test.js requests on a new connection each, never a pooled socket

## What happened
On 2026-10-21, hosted macos-latest failed one test in two unrelated PRs (#6795, #6792), with the same error each time:
"the first-run routes answer, and the completion route reports what stuck" (server.test.js), `fetch failed` caused by
`read ECONNRESET`, 14 to 16 ms into the test, at a 1-minute load of 25 to 31 on 3 cores. The test passes alone. The
test just before it makes no request, so the failing request reused a pooled keep-alive socket that went bad while it
sat idle. That is the same class #6059 closed for other files ("reopen if a fetch failed / ECONNRESET appears again
in a server test"). #6110 fixed it per file; server.dm-rollover-5841 already sends every request on a new connection
(`agent: false`) and counts connections to prove it.

## Change
`req()` in server.test.js (599 call sites; postJson goes through it) moves from global `fetch` (undici, pooled) to
`http.request` with `agent: false`: one new connection per request, so no idle socket exists to be reset.

Same contract for callers, from an audit of all 599 sites:
- **Options used:** only `method`, `headers` (plain objects) and `body` (always a string).
- **Redirects:** `fetch` follows them and `http.request` does not. The server's only redirect is the `?boot=` /
  `?token=` bootstrap (server.js 302), and no `req()` call in this file reaches it (0 matches; a control grep finds
  the 65 `/api/status` calls).
- **Return value:** unchanged, `{ status, type, body }`; the body is decoded as UTF-8 text.
- **Request shape (challenge loop iteration 1):** fetch types a string body with no content-type as
  `text/plain;charset=UTF-8`, and server.js's cross-site write guard refuses that type. So req() adds the same
  default, and the one arm that relied on it (`/api/remote/cert-watch/ack-lost`, expecting 403) still proves the
  guard it did. Of fetch's other defaults, server.js reads `sec-fetch-mode` only to compare it with `navigate`, and
  `user-agent` only into an access-log line (measured by grep; `accept` and `accept-encoding` are not read), so
  leaving them out changes no answer.
- **Timeout:** a socket idle for 300 s (undici's default) fails the request, naming it. It is an idle timeout, not a
  total deadline.

The 20 direct `await fetch(` calls left in the file (counted by that pattern after this change; main has 21, the 21st being req()'s own; more lines mention `fetch(` in comments) are left as they are: they are not on the failing path, and each is a
deliberate fetch-semantics check.

## Test
A harness arm, the last test in the file, asserts that more than 100 requests went through `req()` (a revert to
fetch leaves the counter at 0) and that none went out on a reused socket (`reusedSocket`, a tripwire for a pooled
agent). A name filter or `--test-only` does not run the arm (measured), so a single-test rerun is not reddened by it.

## Decided, not missed
- Retrying on ECONNRESET was rejected: it would hide a real server reset.
- Raising the server's keep-alive was rejected: #6059 recorded that the reset recurred with keep-alive at 120 s.

## Weakest premise
That a pooled-socket reset is the cause. Neither run captured which socket was reset. The evidence: the reset comes
on the first request after a request-free test, which is the shape #6059 and #5841 measured. With `agent: false`
there is nothing pooled left to reset, so a recurrence would disprove this premise.

## Challenge loop iteration 1 (opus): 3 WARNINGs, 3 NITs, all taken
- WARNING: "the contract is unchanged" was not true of the request headers. fetch types a string body with no
  content-type as text/plain, which the cross-site write guard refuses, so the one POST arm with no headers
  (`/api/remote/cert-watch/ack-lost`, expecting 403) had its 403 come from a different check. req() now sends the same
  default, so every caller sends the content-type it did before (two WARNINGs, one fix).
- WARNING: no timeout. req() now gives up after 300 s (undici's default) with an error naming the request.
- NITs: the BOM wording is gone from the comment and the plan; the REUSED assertion says "tripwire"; and a comment
  says the harness arm must stay last.
- Measured after: server.test.js 364 of 364 pass.

## Challenge loop iteration 2 (sonnet): 1 WARNING (deferred on measurement), 3 NITs
- WARNING, deferred: "the harness arm reds a single-test rerun". Measured: `--test-name-pattern` for one test runs
  only that test (tests 1, pass 1), so the arm does not run; `--test-only` likewise. The plan's "nonzero" now says
  "more than 100", as the code does.
- NIT, taken: setTimeout is an idle-socket timeout; the comment, error text and plan say so.
- NITs, left: a response closing early with no error waits for the idle timeout (bounded); reusedSocket is a tripwire
  (already stated).

## Challenge loop iteration 3 (opus): 1 WARNING, 4 NITs
- WARNING, fixed: a socket that closes mid-body may emit no `error` on the response, and the idle timer sits on a
  closed socket, so req() could hang where fetch rejects. req() now rejects on `res` `close` when the response is not
  complete. Measured on Node 26.8.1 with a server that promises 10 bytes and drops the socket after 3: the response
  emits `error` (ECONNRESET) and then `close` with `complete=false`, so the new handler is the backstop for a Node that
  emits no error (a second reject of a settled promise is a no-op).
- NITs, taken: content-length is now added only when no casing of it is present (content-type already was); the
  `test.after` comment says the direct fetch calls are why closeAllConnections stays.
- NITs, left: a leading BOM is kept where fetch's text() strips it (no route sends one); REUSED is a tripwire.

## Challenge loop iteration 4 (sonnet): 1 WARNING (deferred on measurement), 4 NITs
- WARNING, deferred: "a HEAD response could close without `complete` and be rejected". The reviewer's premise that no
  req() uses HEAD was wrong: six do (/api/status, the agent avatar, /api/you/avatar, an icon, /api/remote/join,
  /api/roles). Measured on Node 26.8.1: a HEAD response announcing a 42-byte content-length closes with
  `complete=true`, and all six arms pass (364 of 364).
- NITs, left: a header value of `undefined` throws in http.request where fetch sends the string (no caller passes
  one); the timeout's error listener order (async, works); BOM and tripwire (recorded above).

## Challenge loop iteration 5 (opus): 1 WARNING, 3 NITs
- WARNING, fixed: REUSED could move only if a socket was actually reused during the run, so a swap to a pooled agent
  could pass on a fast run. The tripwire now also counts `r.shouldKeepAlive`, which is false for every `agent: false`
  request and true for every keep-alive one, and it is asserted before the count. Mutant (a keep-alive agent), run
  with only 6 requests: the arm fails on the keep-alive assertion. Real file: 364 of 364.
- NIT, taken: the plan says how the direct fetch calls were counted (20 after this change; 21 on main, one of them req()'s).
- NITs, left: the arm must stay last (stated in its comment; the >100 floor is already met by the tests before it);
  a non-string body would throw inside the executor (no caller passes one).
- The reviewer's note that the six HEAD sites call fetch directly is wrong: grep shows them as `req(` (iteration 4).

## Challenge loop iteration 6 (sonnet): CONVERGED (every finding a duplicate of a ledger entry)
- The tripwire's scope (it checks req()'s own agent choice): iteration 5's fix states exactly that scope.
- "The arm must be last": iteration 2 (deferred on measurement) and iteration 5 (NIT, left). The new angle, within-file
  parallel tests, does not apply: node:test runs a file's top-level tests one at a time. Moving the check to
  test.after was rejected because an after hook also runs on a single-test rerun, which brings back iteration 2's
  false red.
- NITs (redundant inner `require('node:http')`, the documented fetch differences, the close backstop): recorded or
  harmless.

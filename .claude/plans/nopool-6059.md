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
- **Return value:** unchanged, `{ status, type, body }`; the body is decoded as UTF-8 text, as `res.text()` did.

The 21 direct `fetch(` calls in the file are left as they are: they are not on the failing path, and each is a
deliberate fetch-semantics check.

## Test
A harness arm counts `req()` requests and asserts that none went out on a reused socket (`reusedSocket`), and that
the count is nonzero, so a later switch back to a pooled agent fails loudly.

## Decided, not missed
- Retrying on ECONNRESET was rejected: it would hide a real server reset.
- Raising the server's keep-alive was rejected: #6059 recorded that the reset recurred with keep-alive at 120 s.

## Weakest premise
That a pooled-socket reset is the cause. Neither run captured which socket was reset. The evidence: the reset comes
on the first request after a request-free test, which is the shape #6059 and #5841 measured. With `agent: false`
there is nothing pooled left to reset, so a recurrence would disprove this premise.

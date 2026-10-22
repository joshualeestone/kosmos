# boardproof-win2-6464: the Windows half of #6464 (CLI, opener, pin test, redirects)

**Posture:** production

Card joshualeestone/kosmos#6464 (from the #6437 review). The shared parts (the report hook proving before each send,
`kosmos connect` on the Mac) merged in #6471. This branch takes the Windows CLI and opener, the redirect item and the
pin test. The launcher's board window (ask 3) is split out: see "Deferred" below.

## Finished looks like
1. `tools/windows/kosmos-cli.js` proves before EVERY request, never once per process, so a retry after a request
   that did not complete (msg's and post's cut-reply retry, task ran's retries) proves again. A listener that stops
   proving between two requests gets nothing at the second.
2. A request carrying a secret in its BODY (`kosmos connect`, `secret: true`) is never sent without a token in its
   headers to prove the listener with: with no readable board token it is refused, exit 1, nothing sent.
3. Every token-bearing fetch on the Windows senders refuses redirects (`redirect: 'error'`): the CLI's requests, the
   opener's mint, the report hook's keep, toolfail and report sends.
4. The opener refuses (opens nothing, exit 10) when the mint fails right after a passing proof, instead of opening
   the plain address. It never retries the mint, so a proof covers exactly one mint.
5. The caller pin test walks the whole repo (every .js/.cjs/.mjs outside node_modules, .git and tests), not only
   engine/*.js, and finds callers in either shape (chained on the require, or through a named require). It also pins
   that nothing passes the Windows CLI's main a fetch or hook of its own.

## Decided
- **Prove per request, no cache at all**, rather than "drop the cache after an incomplete request". Rejected: keeping
  the cache and clearing it on failure, which still lets a listener that changes between two COMPLETED requests ride
  the first proof. Matches the Mac CLI (proves on every call) and the hook after #6471. Cost: one extra loopback
  request per CLI request (a handful per command). Would change my mind: a verb that makes hundreds of requests.
- **Body secret rule keyed on the headers, not the seam**: connect's refusal reads the headers it would send, so it
  holds even under the test seams that skip the real check. Only connect carries a body secret today (checked every
  ctx.call in the CLI).
- **Mint failure after proof refuses**, as the card asks. The Mac's cmd_open still falls back to the plain address
  when the board answers without a nonce; that is the Mac's to change, noted in the opener's header.
- Weakest part: the proof and the send are still two connections (stated on #6437 and #6471): a takeover in the
  milliseconds between them still lands. Narrowed, not closed.

## Deferred
- **Ask 3, the board window (tools/windows/KosmosLauncher.cs)**: proving again before the window reuses its sign-in
  cookie (a reload after a crashed page, a failed navigation, F5). Any change to KosmosLauncher.cs needs the committed
  signed Kosmos.exe rebuilt and re-signed, and since #6512 the git-order test
  (tools.win-launcher-signin-6512.test.js) and the build's LAUNCHER_INPUTS check fail on every platform until it is.
  So it goes in its own follow-up, cut with the next Windows release's rebuild and re-sign.
- bin/agy-report-bridge.js also sends tokens with fetch and follows redirects; it is not one of #6437's Windows
  senders and is left for its owner.

## Tests
- `tools.windows-kosmos-cli-board-proof-1765.test.js`: a real listener that proves once, cuts the first msg and then
  answers like a squatter (the retry proves again and is not sent), with a control that keeps proving (two proofs,
  two sends); connect with no board token against a real squatter (nothing sent) and its control; a proven board
  that 307-redirects a send to a second real listener (nothing reaches it). The seam arm that pinned "one proof per
  process" is flipped to two.
- `tools.win-open-board-2007.test.js`: the two "falls back to plain after a failed mint" tests flipped to "opens
  nothing"; a proven board that 307-redirects the mint to a second real listener.
- `engine/kosmos-report-hook.board-proof-1765.test.js`: a proven board redirecting the keep, report and toolfail
  sends; the repo-wide caller pin for the hook's main and the CLI's main, with matcher fixtures.
- Each new or flipped test went red with its fix reverted (mutation runs recorded in the PR).

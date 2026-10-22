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
3. Every token-bearing fetch on the Windows senders never follows a redirect (`redirect: 'manual'`, a 3xx refused as a failed send): the CLI's requests, the
   opener's mint, the report hook's keep, toolfail and report sends, and the four report bridges the Windows bundle
   ships (codex, gemini, grok, agy). A source guard (tools.board-redirects-6464.test.js) holds every fetch call in
   those files to it, so a call added later without it goes red.
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
  milliseconds between them still lands. Narrowed, not closed. The same gap covers node fetch's own one retry of a
  421 on a fresh connection: it carries the tokens without a fresh proof,
  inside fetch where the CLI cannot prove between the two.
- The body-secret rule reads the two token headers, not a cookie: the CLI never sends a cookie. If headersFor ever
  adds one, this check and boardproof.tokenIn could disagree.

## Review log

### Round 1 (fresh blind reviewer): no blockers, 3 warnings, 4 nits
- [WARNING] the three redirect tests asserted only that the second listener saw nothing, never that the sends reached
  the redirecting board. FIXED: each asserts the board received the sends it redirected.
- [WARNING] the hook redirect arm's Windows paths were unescaped. FIXED.
- [WARNING] the pin matcher missed destructured, imported and later-assigned shapes. FIXED: all covered, each with a
  matcher fixture; a probe file in each new shape outside engine/ turns the pin red.
- [NIT] fetch's own 421 retry is unproven. Stated above (the existing proof-to-send gap).
- [NIT] the walk read untracked files. FIXED: git ls-files (walk only without git).
- [NIT] the secret check ignores a cookie. Stated above.
- [NIT] a control title said "proved once". FIXED.

## Deferred
- **Ask 3, the board window (tools/windows/KosmosLauncher.cs)**: proving again before the window reuses its sign-in
  cookie (a reload after a crashed page, a failed navigation, F5). Any change to KosmosLauncher.cs needs the committed
  signed Kosmos.exe rebuilt and re-signed, and since #6512 the git-order test
  (tools.win-launcher-signin-6512.test.js) and the build's LAUNCHER_INPUTS check fail on every platform until it is.
  So it goes in its own follow-up, joshualeestone/kosmos#6882, cut with the next Windows release's rebuild and re-sign.

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

### Round 2 (fresh blind reviewer): no blockers, 2 warnings, 5 nits
- [WARNING] the two flipped opener tests could pass on a proof refusal, never reaching the mint. FIXED: each asserts
  the mint was asked once (mutant restoring the plain-url fallback: both red).
- [WARNING] availability: a mint slower than its 15 s bound on a busy board now opens nothing where it used to open
  the plain address (which the window's still-valid session cookie often signed in), and the window's refusal page
  says it "could not confirm it was reaching your own Kosmos", which is not quite this case. ACCEPTED as the card's
  ask; stated here, and the wording goes to the launcher follow-up (the page text is in the signed exe).
- [NIT] a refused redirect read as a cut answer: msg asked again and verbs said "Is it running?". FIXED: its own
  reason and sentence, no retry (arm asserts one msg, mutant red).
- [NIT] a tracked file deleted in the working tree would throw in the pin. FIXED: existsSync filter.
- [NIT] msg's retry refused by a failed proof keeps the first attempt's "may have been delivered": true, since the
  first attempt was cut after sending. Kept.
- [NIT] the plan's mutation claim needs the runs in the PR. Done there.
- [NIT] bin/codex-report-bridge.js and bin/agy-report-bridge.js follow redirects with tokens. Taken up in round 3.

### Round 3 (fresh blind reviewer): no blockers, 1 warning, 3 nits
- [WARNING] the plan called the report bridges Mac senders, but the Windows build ships all four (codex, gemini,
  grok, agy; tools/build-kosmos-windows.sh) and win32keyed.js runs gemini and grok per turn. FIXED: redirect: 'error'
  on all six of their fetch calls; a source guard over every sender's fetch calls (mutant without the bridge fix:
  six calls named, red) and a real redirect through the gemini and grok bridges (mutant: both red).
- [NIT] a refused redirect returned notConnected and said "did not <what>", which the CLI cannot know (the listener
  got the request). FIXED: the sentence says to check before doing it again; the comment says why notConnected.
- [NIT] the opener's sentence said "this window" on the browser path too. FIXED: "did not sign you in".
- [NIT] the no-git fallback walk read .claude and dist. FIXED: skipped.

### Round 4 (fresh blind reviewer): no blockers, 1 warning, 2 nits
- [WARNING] the opener still opened the plain address, unproven, when board.token was there but unreadable (EACCES,
  or EBUSY while antivirus holds it): the same cookie exposure this branch refuses after a failed mint, and ask 2's
  "no secret unproven" case. #6437 had stated it as a limit. FIXED: readBoardToken returns null for a token it
  cannot read, and every caller (after the wait, after a wait that ran out, main's catch) opens nothing (exit 10).
  Tests put a folder where board.token goes (EISDIR on every platform); the #2007 chmod arm now expects null. Mutant
  (the opener before this fix): both new arms red.
- [NIT] connect against a fixture board that writes no board.token is now refused, with restart advice that does not
  fit there. ACCEPTED: refusing is the safe direction, and production boards on Windows always enforce (write the
  token); stated here.
- [NIT] the source guard knew only the names fetch and doFetch. FIXED: it adds every name the file binds to something
  mentioning fetch or fetchImpl, with a fixture for an alias.

### Round 5 (fresh blind reviewer): no blockers, no warnings, 2 nits: converged
- [NIT] the refused-redirect sentence told reads to "check before doing it again". FIXED: reads end plainly (arm on
  `room`, mutant red).
- [NIT] an unreadable token plus a board that never answers writes two refusal notes to stderr. Kept: the outcome is
  right and each note is true.

### Validation found a regression: redirect 'error' broke the board's 421 (fixed)
The affected-suite run (branch against an origin/main control, compared by test name) showed four new failures in
tools.windows-kosmos-cli-outbox-1704.test.js: a reply/msg/post/report/react to a board serving another Kosmos read as
"could not reach Kosmos". Cause, measured on node 24: undici retries a 421 once on a fresh connection, and with
`redirect: 'error'` that retry fails on a request with a body ("Request body length does not match content-length
header"), so the 421 never arrives. `redirect: 'manual'` keeps the retry and still never follows a 3xx (measured: a
307 comes back with status 307, the second listener gets nothing).
FIXED: every sender says 'manual' (the proof itself, a GET with no body, keeps 'error'); the CLI reads any 3xx as its
refused-redirect reason; the opener's mint and the hook read a 3xx as a failed send (not ok). The source guard now
requires 'manual' in the senders, and a real 421 arm through the hook holds the reason (mutant with 'error': red;
the outbox-1704 tests: red with the CLI on 'error', green on 'manual'). Every redirect arm re-run against 'follow'
mutants: red.

### Round 6 (fresh blind reviewer, after the 'manual' switch): no blockers, no warnings, 2 nits: converged
- [NIT] the plan said the 421 retry gap is noted at WRONG_WORLD_STATUS in the CLI; that comment does not say so.
  FIXED: the plan no longer points there.
- [NIT] a test comment said the 421 arm drives the CLI too; it drives the hook. FIXED: the comment names the outbox
  test that holds the CLI's 421.

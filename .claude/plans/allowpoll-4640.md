# allowpoll-4640: a second computer moves on by itself once the other computer allows it

Card: #4640 (follow-up to #4638). Owner: renettilley. Stacked on secondmac-4638 (PigeonPete) until it merges.
Needs kosmos-relay signinstatus-4640 (`signin status` tunnel verb) for the live path; without it the page keeps
today's behaviour (the code and a Done button).

## Change
- engine/remote.js: absorbSession marks a second computer (`second` = the answer named another computer's
  address). signinRegister keeps the session token after a successful register ONLY then, as
  allowWatch = { token, until: now + 15 min }. signinAllowStatus() runs `signin status` with the token on stdin,
  returns { device_status } in pending/acked/denied, clears the watch on acked/denied, and returns
  { stop: true } when there is nothing to wait for or the tunnel predates the verb (clap's "unrecognized
  subcommand"). A down coordinator is { stop: false }: ask again. Dropped by signinCancel, signinStart, forget,
  resetForTests.
- server.js: GET /api/remote/signin-allowed -> { ok, device_status } or { ok: false, stop }.
- web/index.html: plusSiSecondDone starts a 4 s poll (plusSiWatchAllow). acked: "Allowed. <computer> is in.",
  then after 3 s the Done button's own handler. denied: "Your other computer said no to letting this one in to it."
  with how to ask again, and stop asking; the "connected as" line stays, since this computer IS on Kosmos+.
  plusSiClear and Done stop the poll. (Current state; the review notes below record how it got here.)

## Decisions
- Reuse the register session (the coordinator answers it after register; pinned in kosmos-relay
  coordinator/tests/api.rs kosmos4640_register_keeps_the_session_and_it_sees_the_allow). Rejected: a new poll
  token (coordinator change); polling from the page (the token must never reach it).
- Keep the token only on a second computer and only 15 minutes: a first computer has nobody to wait for, and the
  default rule is that a spent token does not linger.
- Extend Pete's browser check rather than a new file (a new file needs four hand-maintained wiring guards, and his
  branch lands first).

## Weakest premise
That the coordinator answers 401 (and only 401) for a session it no longer accepts on /v1/account/me. A 403 is
treated as retryable (pinned), so a wrong guess costs retries until the 15-minute window, never a false stop.
The old-tunnel stop is MEASURED, not assumed: a shipped kosmos-tunnel prints clap's error on the FIRST stderr line
and "For more information" last, so the engine matches the whole stderr (review iteration 2 found the last-line
match could never fire).

## Review changes (iterations 1 and 2)
- The window is enforced by an unref'd timer; Done tells the engine to drop the token (signin-cancel at first,
  signin-allowed-done from iteration 7).
- 401 is final. An old answer never tells a new watch to stop. Denied says "<computer> was not let in." and how
  to ask again (a denied device's next sign-in is a fresh knock, kosmos-relay db.rs upsert_device).
- register's already-set-up shortcut keeps the watch too (a retry after a no).
- The page stops after 15 unanswered asks (the board itself silent). The window is a test-only setter, not an env var.
- Iteration 3: the page OPTS IN. It sends awaitAllow with register only when it lands on the code screen (PLUS_SI_SECOND),
  and the engine keeps the token only when awaitAllow AND the sign-in answer named another computer. A reinstalled
  computer that takes the chooser keeps nothing. The denied copy points at a control that exists: Remove this computer
  retires the address (the account lists live addresses only), so the next sign-in is a second computer again and a
  fresh request. GET /api/remote/signin-allowed refuses a cross-site read.
- Iteration 5: the final answer is kept WITHOUT the token until the window ends (allowFinal), so a second tab or a
  lost response is told the same answer instead of "stop" (a reload does not restart the asking); Sign out, a new
  sign-in and Forget clear it.
  Controls pin the engine's own gate on both register paths: a first computer whose page sends awaitAllow keeps
  nothing. With several other computers the denied line says "One of your other computers".
- Iteration 7: Done and the move on after "Allowed" post POST /api/remote/signin-allowed-done (drops the token
  only), not signin-cancel (a full Sign out, which could cancel a sign-in elsewhere and dropped the final answer).
  The page counts an HTTP error answer (the board's 403, a 5xx) toward the 15-unanswered cap. The old-tunnel
  match is anchored on clap's own "error:" line.
- Iteration 8: while the engine answers that Kosmos+ could not be asked (ok:false, stop:false), the page backs off
  4, 8, 16, then 30 s at most, instead of asking every 4 s for the whole window; the unanswered path keeps its cadence
  and cap. "Allowed" shows for 3 s before moving on (time to read it, and for aria-live to announce it). The 401
  match is anchored on the tunnel's own "Error: Kosmos+ said no (401)" line.
- Iteration 9: a no does NOT unregister this computer (it stays on Kosmos+ at its address; the no is about reaching
  the other computer), so the denied landing keeps the "connected as" line and says "in to it", instead of
  "<computer> was not let in", which was false.
- Iteration 10: register's already-set-up shortcut keeps NO watch. The page opts in only when this computer's name
  is not among the account's addresses, and the shortcut runs only when the state dir is already at that name, so
  they meet only in the account-switch edge (the held session is another account's). A retry after a no goes through
  Remove this computer, which wipes the state dir, so it never takes the shortcut.
  Iteration 11 corrected that: the shortcut neither keeps NOR drops a watch. Every sign-in starts by dropping any
  watch (signinStart), so a live one at the shortcut was kept by this sign-in's own register: this is its Try again
  after the page lost the answer, and the watch is the right one. A failure to ask is logged once per watch (no
  token). "Allowed" says "by one of your other computers" when there are several. (busy() refuses a second register
  while one is in flight, so two opt-ins cannot race.)
- Iteration 13: after moving on by itself, focus goes to the Kosmos Plus section (#s-sec-plus, tabindex -1) instead of
  falling to the page (#4271, the #1918 class); browser arm asserts it.
- Was inherited, now resolved: #4638's pinned emit-site count is bumped to 209 on its own branch (merged in here);
  this branch adds no emit site.
- Iteration 6: the denied line starts "press Done" (Remove this computer is on the Kosmos Plus pane Done leads to,
  shown whenever this computer is enrolled). The promise behind it is PINNED in kosmos-relay signinstatus-4640
  (coordinator/tests/api.rs kosmos4640_after_a_no_removing_the_computer_and_signing_in_again_asks_afresh): after
  a no, retiring the computer drops its address and its next sign-in is pending. A non-401 refusal stays retryable:
  /v1/account/me refuses bad, expired and deleted sessions with 401 (session_claims), so any other refusal costs
  retries within the window, never a wrong answer.

## Validation
- node --test engine/remote.test.js (118/118); #4640 tests x4; server.test.js in-app sign-in route test.
- docs/browser-checks/render-plus-second-computer-4638.js: 20/20.
- Controls: keeping the token on a first computer reds the engine control; removing the page poll reds all five
  #4640 browser arms.
- Not measured: a real two-computer run.

## Board side: waiting to be allowed is not a fault (renettilley, 2026-09-30)
While a second computer waits for the older computer's Allow, the coordinator (retirehold-4681) refuses its relay
ticket with 403 code own_lineage, and the page printed "Kosmos+ refused this Mac: ... (HTTP 403 on
/v1/mac/relay-ticket, code own_lineage)." under a blue Connecting pill.
- engine/remote.js: allowWaitSentence(line) recognises the refusal (code own_lineage; or, for a tunnel with no code, the
  coordinator's sentence on a 403 for /v1/mac/relay-ticket). status() returns state 'waiting-allow' with the sentence
  alone as because, keeps it while the tunnel says only connecting (from lastTunnelFailure), and drops it once up or
  when the process writes any other failure.
- web/index.html paintPlus: a neutral "Waiting to be allowed" pill (data-state waiting, the plain grey style) and the
  sentence. server.js hookPublicLink: its own sentence for waiting-allow. engine/remote-report.js: code 'waiting-allow'
  ahead of every coordinator code; tunnelState maps waiting-allow to starting.
- Left deliberately: tools/plus-signin-fresh.js waits for 'up' and would report a waiting computer as not up, which is
  true for that tool's first-computer flow.

Weakest premise: the match is on another repo's words. The prefix "Kosmos+ refused this Mac: " (kosmos-relay
crates/tunnel/src/words.rs REFUSED_PREFIX), the parenthesis "(HTTP <n> on <path>[, code <c>])" (crates/tunnel/src/
coordinator.rs refusal line) and, for the code-less tunnel, the sentence "this computer is not allowed yet; allow it
from your other computer first" (coordinator/src/macs.rs). A rewording there fails toward today's behaviour (an
ordinary refusal), never toward hiding a fault.

Measured: remote.test.js 126/126; remote-report.test.js 15/15; server.webhooks-1307 39/39; render-plus-panel-3829 105
PASS 0 FAIL; the four browser-check guards and web.plus-tab green. Mutations, each restored and compared with cmp:
no waiting return (1 red), any code counts (the standing_lapsed control reds), code-less spelling dropped (reds), not
kept through the retry (reds), prefix kept in the sentence (2 reds), report row removed (1 red), tunnelState unmapped
(1 red), page pill mapping removed (browser check 104 PASS 1 FAIL: "Not connected" on a red pill).

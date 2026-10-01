# allowpoll-4640: a second computer waiting for its other computer's Allow says so

Card: #4640 (follow-up to #4638). Owner: renettilley. #4638 was reverted on main, so this branch is merged onto
main on its own (see "Rebased onto main after the #4638 revert" below).

## Change (what this branch ships, rewritten after the 2026-10-01 re-review)
- A second computer waiting for its other computer's Allow is a state of its own, not a failure:
  engine/remote.js allowWaitSentence() reads the tunnel's refusal (the wait sentence plus code own_lineage, or the
  older code-less 403 on /v1/mac/relay-ticket); status() returns state 'waiting-allow' with that sentence.
  engine/remote-report.js classifies it 'waiting-allow' ahead of every coordinator code. Neither matches the
  device word, so the relay renaming "this Mac" does not break either.
- web/index.html paintPlus: a neutral "Waiting to be allowed" pill and the sentence. server.js hookPublicLink: its
  own sentence for the state.
- REMOVED in the 2026-10-01 re-review: the engine half of the auto-advance (signinAllowStatus / signinAllowDone,
  signinRegister's awaitAllow, the routes /api/remote/signin-allowed and /signin-allowed-done, their tests and the
  reachability excuse). Nothing called it after the #4638 revert, it kept a session token for 15 minutes, and
  Josh's 09-30 ruling (a new computer is a purchase, #4754) put the free second-computer join it served on hold.
  Rejected: keeping it for #4754 (unused credential-holding code for a design that does not exist yet; three
  blind rounds raised it). It is in git history (b68b8d3ca and before) if #4754 wants it.
- History: the rounds below record the earlier design and how it got here; they are not the current state.

## Decisions (current)
- A wait, not a fault: a second computer refused with the coordinator's wait sentence and code own_lineage (or the
  older code-less 403 on the ticket path) shows its own 'waiting-allow' state and a neutral pill, never a refusal.
- Match on the sentence AND the code, never the code alone: own_lineage also carries two FINAL refusals.
- The device word is not matched, and case IS matched, identically in remote.js and remote-report.js, so the board and
  the report never disagree about one line (pinned with one recased line fed to both).
- Removed the unused auto-advance engine half (see Change).
- DEFERRED (round 5): the wait is kept while the tunnel only says connecting, so a dial that hangs right after the
  Allow still reads "Waiting to be allowed". Bounded by the tunnel's own timeouts (its next failure replaces it), and
  cleared on up or a new process. Would change my mind: a report of the pill outliving an Allow by minutes.

## Weakest premise (current)
That the relay keeps these exact words (coordinator.rs refusal line, words.rs REFUSED_PREFIX, macs.rs own_lineage
sentence). A rewording falls back to today's behaviour (an ordinary refusal), never to hiding a fault.

## History (the removed auto-advance design and its rounds)
### Decisions (the removed auto-advance design)
- Reuse the register session (the coordinator answers it after register; pinned in kosmos-relay
  coordinator/tests/api.rs kosmos4640_register_keeps_the_session_and_it_sees_the_allow). Rejected: a new poll
  token (coordinator change); polling from the page (the token must never reach it).
- Keep the token only on a second computer and only 15 minutes: a first computer has nobody to wait for, and the
  default rule is that a spent token does not linger.
- Extend Pete's browser check rather than a new file (a new file needs four hand-maintained wiring guards, and his
  branch lands first).

### Weakest premise (the removed design)
That the coordinator answers 401 (and only 401) for a session it no longer accepts on /v1/account/me. A 403 is
treated as retryable (pinned), so a wrong guess costs retries until the 15-minute window, never a false stop.
The old-tunnel stop is MEASURED, not assumed: a shipped kosmos-tunnel prints clap's error on the FIRST stderr line
and "For more information" last, so the engine matches the whole stderr (review iteration 2 found the last-line
match could never fire).

### Review changes (iterations 1 and 2, the removed design)
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

### Validation (the removed design; render-plus-second-computer-4638.js left with the #4638 revert)
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

## Review round 1 of the waiting-allow build (blind, sonnet, 11:30): 0 BLOCKER, 1 WARNING (fixed), 3 NIT
- WARNING, fixed: `code own_lineage` alone counted as waiting, but the coordinator (retirehold-4681 macs.rs
  held_refusal) sends that code with two FINAL sentences too ("was not allowed on your account", and "no other
  computer ... is left to allow it"). A denied or orphaned computer would have read "Waiting to be allowed" for ever.
  The wait now also needs the wait sentence. Controls for both final sentences in remote.test.js and
  remote-report.test.js; mutation (the sentence check removed) reds the new control. remote + remote-report 141/141.
- NIT noted: the sticky waiting state could mask a dial that hangs after the Allow (bounded: cleared on up, a new
  failure, or a new child; fails toward the old wording). NIT noted: if the tunnel process exits after the refusal
  rather than retrying in-process, the pill could alternate with "Connecting" (not confirmed which it does).
- NIT noted: POST /api/remote/signin-allowed-done has no cross-site guard; it only drops the watch token.

## Rebased onto main after #4677 landed (2026-09-30)

- Old head 22b1476b66bdb6b258d96e20f4fc8842471e6c73 (stacked on secondmac-4638). New base origin/main 844b2372a
  (#4638, landed as one squash via #4677).
- Kept the 20 allowpoll-4640 / #4640 commits (cherry-picked in order, one empty-by-design commit kept with
  --allow-empty). Dropped the 7 secondmac-4638 / #4638 commits and the 7 merge commits; the two merges of
  secondmac-4638 into this branch had no manual resolutions (remerge-diff empty), so nothing of ours lived in them.
- Conflicts: engine/remote.js resetForTests (every commit that touched it): kept main's resetSelfGrant() and this
  branch's allow-watch reset together. web/index.html: main's rewritten PLUS_NAME_RULE comment kept, PLUS_SI_WATCH
  declaration added above it; plusSiDoRegister kept main's try/catch with siRestore (#4608) and sends this
  branch's awaitAllow payload inside it. server.js hookPublicLink: main's "Kosmos+" wording (#4629) kept, the
  waiting-allow line added and reworded to "Kosmos+".
- Tests after the rebase: remote 133/133, remote-report 15/15, server 346/346, webhooks-1307 39/39,
  engine.reachable 1/1, reason-grep 5/5 (EXPECTED_SITES unchanged, measured by the test itself), indexed 1/1,
  selectors 4/4, browser-checks-wired 11/11. Browser checks: render-plus-panel-3829 105 PASS,
  render-plus-second-computer-4638 31 PASS, render-plus-signin-3478 175 PASS, render-plus-signin-enter-0929 12 PASS,
  render-plus-stars-3778 18 PASS, 0 FAIL in each. Full suite not run; the challenge-loop proof is stale after
  the rebase and must be regenerated before any PR.

## Rebased onto main after the #4638 revert (2026-09-30)

- Old head 028d65602 (on 844b2372a, #4638). New base origin/main a6632f152, which carries a67b04cd3 (Revert #4638).
- MERGED origin/main rather than rebasing: all 20 #4640 commits touch the regions the revert deleted, so a rebase
  would re-resolve the same conflict up to 20 times and leave commits that never ran. One merge commit holds the
  whole resolution in one reviewable diff; the #4640 history is unchanged.
- Kept (#4640's own): allowWaitSentence and the 'waiting-allow' tunnel state (wait sentence required; own_lineage's
  final sentences stay refusals), remote-report's waiting-allow code, the webhook line, the grey "Waiting to be
  allowed" pill in paintPlus, the render-plus-panel-3829 waiting arm and its control, and the engine allow-watch
  (signinRegister awaitAllow, signinAllowStatus, signinAllowDone, /api/remote/signin-allowed and -done) with its tests.
- Dropped, because each only extended #4638's reverted flow:
  - waiting_labels (#4681): lived in secondComputerFields and plusSiSecondStart, both gone; its test and fixture 232323.
  - The page's allow landing: plusSiWatchAllow, plusSiAllowed, plusSiRefused, PLUS_SI_WATCH, the aria-live on
    plus-si-match-lead, awaitAllow in plusSiDoRegister, the Done button's signin-allowed-done post. They hung off
    #4638's code landing (PLUS_SI_SECOND, plusSiSecondDone), which no longer exists.
  - The #4640 arms in render-plus-second-computer-4638.js (the file is deleted on main) and its README row.
  - The #4638 test "signin verify tells a second computer what it needs", and fixture 313131.
- Changed: absorbSession no longer calls secondComputerFields. The engine decides "second computer" itself (no
  account_address, at least one valid address listed) and keeps it in signinSession only; the page gets stage and
  account_address, as on main. New test pins that, with controls (bad address shapes, an owned address);
  mutation `!addr ||` reds it.
- ⚠️ Consequence: nothing on the page calls the allow-watch now, so the "moves on by itself" landing does NOT ship
  here. A second computer shows the waiting pill, which turns to Connected when its tunnel comes up. The engine half
  waits for #4754 (sign-in to a bought address) to call it.
- Conflicts: README.md (main's), render-plus-second-computer-4638.js (deleted), engine/remote.js (two hunks),
  engine/remote.test.js (two), web/index.html (four, all main's), plus two auto-merged index.html hunks naming
  PLUS_SI_SECOND, removed by hand.
- Tests: remote 132/132, remote-report 15/15, remote-standing-refresh 12/12, server 346/346, webhooks-1307 39/39,
  engine.reachable 1/1, wired 11/11, indexed 1/1, selectors 4/4, reason-grep 5/5 (no EXPECTED_* change needed:
  the revert already took 4638's emit sites out, and this merge adds none). Browser checks via the light queue:
  render-plus-panel-3829 118 PASS / 0 FAIL, render-plus-signin-3478 175 PASS / 0 FAIL. Full suite not run; the
  challenge-loop proof is stale and must be regenerated before a PR.

## Full validation 9ba643041 (Mortals, 18:03): 13037 tests, 1 red, and it was real
engine/machine.test.js "no live sentence in the other speaking files says 'this Mac'" counted the literal in this
branch's ALLOW_WAIT_LINE regex. The regex parses the relay's line and shows only the reason sentence to a person, but
the guard counts live code, and it is right to: the relay's own text will follow the rename. FIXED by not matching the
device word (`refused this \S+:`), with an arm that a "refused this computer:" line parses and a CONTROL that a line
without "this <device>:" does not. Both arms, and the guard, red with the old regex. Rejected: spelling the literal
around the guard ("this [M]ac"), which would pass it without making it true.

## Re-review after the proof was hand-updated (2026-10-01, Renet)
The proof's hash had been updated by hand after b68b8d3ca (a remote.js fix) with no review of that fix. This re-review
is that review.
- Round 1 (opus): FIXED the stale plan (Change section, title); FIXED remote-report.js matching the relay line's device
  word ("this Mac") while remote.js does not (mutation: reverting reds only the two new pins); DEFERRED the no-caller
  half, then REMOVED it after round 3.
- Round 2 (sonnet): the no-caller half again; "does a new process clear lastTunnelFailure": yes, startChild()
  (remote.js, already on main); the fixture's "refused this Mac" is the relay's own text.
- Round 3 (opus): the no-caller half a third time (now removed); its comments that described #4638's page (removed
  with it); "the wait may not survive a tunnel exit": the real tunnel does not exit on a session error, run_forever
  (kosmos-relay crates/tunnel/src/lib.rs) writes restarting with the refusal, then connecting, and loops with backoff,
  which is the retry the status() test drives. NITs left: the case rule differs (remote.js exact, remote-report /i).
- Round 4 (sonnet): the coordinator stores the report's `error` as bounded free text (kosmos-relay coordinator/src/
  macremote.rs `text(remote.get("error"), ERROR_MAX_CHARS, |_| true)`), so 'waiting-allow' is stored, not refused.
- Round 5 (opus): FIXED the case rule (remote-report.js /i removed; a recased line pinned in both files; mutation: /i
  back reds only that pin). DEFERRED the sticky wait (Decisions). FIXED the plan: the removed design's sections now sit
  under History.
- Round 6 (sonnet): DEFERRED the bare-sentence alternative in remote-report.js's waiting-allow row (prefix only, no code
  check). Its only producer is status(), which writes that sentence only after allowWaitSentence checked the code; the
  tunnel's own lines always start "Kosmos+ refused this <device>:". Would change my mind: a second producer of the bare
  sentence. NITs left (CSS comment for the grey pill; the fixture's relay wording).

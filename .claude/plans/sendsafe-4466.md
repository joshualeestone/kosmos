# sendsafe-4466: a send the board kept is never reported as failed, and never duplicated (#4580 item 1, #4466)

## The report
#4580 (Josh's Five Families project, 2026-09-29), item 1, hit by four of five model families: a post LANDS but the
sender is told it failed, so it re-sends (one agent posted the same message four times). Same path as #4466: on a
busy board the reply times out or is cut AFTER the board delivered.

## Why a per-request key is not enough
The agent re-RUNS the command, which would carry a new key. So the BOARD has to recognise the same send.

## Changes
1. engine/messages.js (shared by the live routes and the outbox drain): a send identical to one the SAME agent made
   to the SAME place (room, or recipient for a direct message) in the last SEND_DEDUP_WINDOW_MS (5 minutes) is not
   sent again; the reply is the first one's receipt with `duplicate: true`. A send still IN FLIGHT is remembered too
   (a busy board's fan-out can outlast the sender's timeout, and the log row is written only when it finishes), so a
   retry arriving meanwhile waits for the first one's receipt. Agents only: a person's post is never folded. The
   in-flight wait is on the async paths only (a synchronous caller expects a receipt, not a promise).
2. install/kosmos: `msg` asks ONCE more after a timeout or a cut reply (curl 18/28/52/56); `post` after a cut reply
   only (its 120 s timeout means it is still delivering, and the board folds a repeat meanwhile). A duplicate receipt
   is reported as delivered, "it had arrived the first time; it was not sent twice". `react` is NOT retried: reacting
   again takes the reaction back off.
3. tools/windows/kosmos-cli.js: the same, with `refused` (ECONNREFUSED: nothing arrived) never retried.

## Tests, each red with its layer removed
- engine: retry folded (one record, nothing typed twice); after the window a repeat IS sent; room post folded,
  another sender's identical post is not; an in-flight retry waits and starts no second delivery.
- Mac CLI: cut-once msg and post report "arrived the first time" after exactly one retry; cut-always gets ONE retry
  then the honest "may still have happened" (never a loop, never "not running").
- Windows CLI: reset then receipt (msg, post) reports delivered; refused and post-timeout are not retried.
- Existing tests that re-sent identical text on purpose now vary it (#460 quoting, #4447 spill files: they test
  where text lands, not repeats); #2909's timeout arm now expects exactly one retry.

## Review round 1 (fable): 1 BLOCKER + 4 WARNINGs + 1 CONVENTION + 5 NITs, all fixed
- BLOCKER: a folded retry in a FEDERATED room was sent to the other side again (federateOut gated only on id and
  text). `federateOut` now returns on `duplicate`. Arm in server.fedmsg-3311 with a control; red without the guard.
- W: the log scan STOPPED at the first row older than the window, but rows are appended at finish with the start
  time, so a slow fan-out lands out of order and hid a newer send. It skips old rows now. Arm, red on the old scan.
- W: the direct-message fold sat AFTER the pair valve, so a retry at the cap its own first copy reached was refused
  ("delivered but told it failed" again). It is now before the valve (the post fold already was). Arm, red.
- W: the folded post's state was a second derivation that disagreed for an agent alone in a room. One
  `aggregateState()` now serves both. Arm, red.
- W: the key ignored the message being answered, so "yes" to two different questions was folded into one. The
  answered message is part of the key and the match, on both paths. Arm with a same-question control, red.
- CONVENTION: the Windows retry notice goes through `ctx.err` (captured and asserted), not process.stderr.
- NITs: a post-side in-flight arm; dead code removed; the cut-always control runs `post` too; the #2909 arm's
  34 s wall time is explained; the CLAUDE.md #4466 row names the fold.

## Review round 2 (sonnet): 3 WARNINGs + 2 NITs fixed, 3 NITs deferred
- W: a folded twin of an UNCONFIRMED send returned `because: null` (the log keeps the state, not the words), so the
  CLIs fell back to generic wording. It now says "this was sent a moment ago and was not confirmed then; it may
  already be there, so it was not sent again". Arm, red.
- W: a retry waiting on an in-flight send that FAILED came back `could_not` with `duplicate: true`. Only a placed or
  unconfirmed receipt is a duplicate now; a failure is handed on as it is. Arm, red.
- W (deliberate, now written down): the post key ignores --new and reply_expected. A retry re-sends the same command,
  so a copy that differs only in a flag is the same post again and the first one's flags stand (comment at the fold).
- NIT fixed: a one-second pause before the retry (Mac `sleep 1`; Windows RETRY_PAUSE_MS, 1000 by default).
- NIT fixed: the Windows comment says why every non-refused failure is retried (loopback: no DNS or TLS to tell apart).
- DEFERRED: a single `__test` export object (the `_` prefix and comment already mark the seams); the fold's log scan
  is O(n) (the same order as the valve scans it sits beside).

## Review round 3 (opus): 2 WARNINGs fixed, 1 NIT written down, 2 NITs fixed, 2 deferred
- W: the fold could not tell a retry from a real second answer ("agreed", someone asks something new, "agreed"
  again). A retry follows its first copy with NOTHING new in that conversation, so the fold now needs the
  conversation QUIET since the match: no row from anyone else in the same pair (messages) or room (posts, the
  person included) after it. Arms for post and message, red on the previous fold.
- W: the #3224 which-room ask ran BEFORE the post fold, so a retry of a delivered post could be held back to ask
  which room it meant ("not posted" again). The fold now runs before the ask; a NEW post is still asked (control).
  Arm, red.
- WRITTEN DOWN: the outbox drain sends synchronously, so it folds against the LOG only, not against a live send
  still in flight (a synchronous caller cannot wait on a promise). Rare: kept entries drain long after the window.
- NITs fixed: Windows KOSMOS_RETRY_PAUSE_MS parses digits only; the pause's promise no longer shadows `r`.
- DEFERRED: a recipient spelled with different casing is not folded (both CLIs resend the identical body, so the
  retry path cannot differ); a shared bash helper for the two retry blocks (two short blocks, each with its own
  retryable codes and budget, commented at each site).

## Review round 4 (fable): 3 WARNINGs + 3 NITs fixed
- W: the window (2 min) equalled a room post's own 120 s budget, and a row is stamped when its send STARTED, so a
  slow fan-out that finished near its budget was already outside the window when the agent re-ran the command. The
  window is 5 minutes now; the quiet-since rule, not the window, is what keeps a real second answer apart. Arm pins
  the window at no less than twice the post budget.
- W: quiet-since listened only to OTHER voices, so "yes", "wait, hold on", "yes" folded the change of mind. Any later
  row in the same pair or room, the sender's own included, now breaks the quiet. Arms for message and post, red.
- W: nothing pinned "a Mac post that TIMES OUT is not asked again". KOSMOS_POST_TIMEOUT_S (digits only) is a test seam
  for the 120 s budget; the posthang arm asserts one send and exit 3. Red with 28 added to the post retry.
- NIT: the Windows retry pause reads the injected env (ctx.env), so tests set it to 0; the suite is 2.6 s again.
- NIT: an in-flight entry older than the window is ignored and dropped (a delivery that never settles cannot hold
  every identical retry forever).
- NIT: the CLAUDE.md #4466 row lists the #4580 test arms.

## Rebase onto main after #4539 merged (2026-09-29 12:2x)
- Main had gained #4491 since: `msg` and `post` send the agent's own token (`_tok`) so the board can tell agent from
  person. My retry curls passed an EMPTY token, so on main the retry went out WITHOUT the agent's identity. Both
  retries now pass `$_tok` (folded into the resolved iteration-4 commit). Arm "the retry carries the agent's own
  token": red with the msg retry's token removed (the stub saw [token, -]). Windows needed no change: its retry
  repeats the same ctx.call, headers included.

## Review round 5 (sonnet): 2 WARNINGs fixed, 1 confirmed not real (commented), NITs tidied
- W: the plan and the CLI comments still said "two minutes" after the window became five. Reworded (round 6 corrected
  the sweep: it had also changed two unrelated comments and missed two test comments).
- W: quiet-since used LOG POSITION only, but rows are appended at finish, so a reply that started after the first
  copy could sit before it and be missed. A row now breaks the quiet if it is later in the log OR started strictly
  later than the match (same-millisecond rows are ordered by the log). Errs toward sending. Arm, red.
- NOT REAL (commented): "the message fold has no person guard". Only agents reach sendWithDelivery (the sender is
  always an agent card: /api/msg and the outbox drain); a person's direct messages go through chat, not here.
- NITs: comment order above asDuplicate, a stray blank line, the posthang comment; the 31 s worst case of a msg
  that times out twice is already written at the #2909 arm.

## Review round 6 (opus): 4 WARNINGs fixed, 1 written down, NITs
- W (my own sweep): the round-5 "two minutes" -> "five minutes" rewrite also changed two UNRELATED comments (the agent
  guard's stale-lock clear, about two minutes; the Windows stdin quiet limit, 120 s) and the post-timeout seam note, and
  missed two test comments. All fixed by exact line; no base-branch "two minutes" line is changed now.
- W: an ambiguous first attempt (timeout or cut) followed by a REFUSED retry (the board restarted in between) was
  reported as plain "not sent", and the copy handed back for re-sending, although the first may have landed and the
  restarted board no longer remembers it. Both CLIs now keep the first attempt's "maybe" when the retry proves nothing.
  Arms: Mac 'cutthendie' (msg and post) and Windows timeout-then-refused; red on the previous CLIs.
- WRITTEN DOWN (weakest premise): quiet-since sees only LOGGED rows between the two agents. A reply from the other party
  that is still in flight, or a person's chat message to the agent (a different store), does not break the quiet.
  Both are narrow: the other party would have to answer inside the few seconds of a retry.
- NIT fixed: the #4580 header comment rewrapped.
- DEFERRED: the async test `deliverToPane !== chat.deliver` (it is exactly "not the synchronous deliver", which is what
  the in-flight wait needs); a route-level end-to-end arm (each layer has its own arms: engine fold, route federation,
  both CLIs against stubs).

## Review round 7 (fable): 2 WARNINGs + 2 CONVENTIONs fixed, NITs
- W: an outside party's reply in a federated room is an `external` row, and it did not break the quiet. It does now.
  Arm (with a VALID external row: fromKind + external:true, or record() drops it; my first fixture lacked both and
  tested nothing), red on the previous engine.
- W: on Windows only a TIMED-OUT first attempt kept "maybe"; a RESET first attempt whose retry failed (refused, or
  reset again) still said "Is it running" and handed the copy back. Any failed retry after a non-refused first now
  says "may have been delivered" (exit 3), for msg and post. Arms for reset-then-refused and reset-then-reset, red.
  Found alongside: the refused detector only read cause.code; it now also reads an AggregateError's cause.errors and
  the message (tools.windows-kosmos-cli-570's refused fixture carries the code in the message).
- CONVENTION: two more stale "two minutes" test comments (messages.test.js) fixed.
- NITs fixed: quietSince's predicate renamed inConversation; resetForTests clears IN_FLIGHT_SENDS; the federation
  control differs from the arm only in `duplicate`; a doubled phrase in the weakest premise.
- DEFERRED: an async withFleet (the arms capture board.agents before their first await; noted here as the trap).

## Weakest premise
An agent that MEANS to send the identical text twice within five minutes, to the same place, answering the same
message, with nothing said in that conversation in between (by anyone, the sender included), gets one copy. After round 3 that is narrow: the realistic case is a
nudge repeated into a silent room, and the cost of the other error is a room full of copies.

## Status
- [x] engine + Mac CLI + Windows CLI, red-checked; messages/chat/server 406/406, CLI 231/231, Windows CLI 112/112
- [x] review round 1 fixed; engine+federation 404/404, CLI 231/231, Windows 112/112
- [x] challenge loop CONVERGED at iteration 8 (sonnet): zero NEW after dedup (details in the proof)
- [x] rebased onto origin/main (f80887e31, incl. #4544's agent nudge: it types through chat.deliver, which this change does not touch); focused 234/234 (engine, federation, CLIs, agentnudge) and every CLI + Windows CLI file 327/327
- [x] SHIPS AS ONE PR WITH noproxy-4466 (Splinter agreed 13:26 CDT): both are #4466 follow-ups, stacked, each converged on its own diff; one PR saves an hour-long CI queue cycle. The full suite runs in PR CI (the local queue is deadlocked until #4574). Weakest premise: a revert takes both.

## After convergence: two CI meta-guard reds (2026-09-29 15:3x)
PR #4622's macOS node suite (run 36613470088, head 087bf0149) failed two repo meta-guards my focused runs never
included:
- engine.reachable.test.js: `_sendWithDelivery` / `_sendPostWithDelivery` were exported test seams that nothing excused.
  Both are now EXCUSED by name with the reason (the send and post cores with an injected deliver, so two concurrent
  identical sends can be held in flight; production reaches them through send/sendAsync and post/postAsync).
- fixture-discipline.test.js: four #4580 tests hand-built the sender's card (`{ card: { sessionName } }`). They now use
  the file's own sender seam (`armSender('<name>-discord')` + `fromPane`), so the sender is resolved from the real
  fleet card. Red-checked: with inFlightTwin returning null, both "STILL delivering" tests fail (2/2).
Lesson (mine, again): focused tests are not the suite; the meta-guards run only in the full suite.

# sendsafe-4466: a send the board kept is never reported as failed, and never duplicated (#4580 item 1, #4466)

## The report
#4580 (Josh's Five Families project, 2026-09-29), item 1, hit by four of five model families: a post LANDS but the
sender is told it failed, so it re-sends (one agent posted the same message four times). Same path as #4466: on a
busy board the reply times out or is cut AFTER the board delivered.

## Why a per-request key is not enough
The agent re-RUNS the command, which would carry a new key. So the BOARD has to recognise the same send.

## Changes
1. engine/messages.js (shared by the live routes and the outbox drain): a send identical to one the SAME agent made
   to the SAME place (room, or recipient for a direct message) in the last SEND_DEDUP_WINDOW_MS (2 minutes) is not
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

## Weakest premise
An agent that MEANS to send the identical text twice within two minutes gets one copy. I judge that the right trade:
the realistic case is a short "ok" or "done", and the cost of the other error is a room full of copies.

## Status
- [x] engine + Mac CLI + Windows CLI, red-checked; messages/chat/server 406/406, CLI 231/231, Windows CLI 112/112
- [x] review round 1 fixed; engine+federation 404/404, CLI 231/231, Windows 112/112
- [ ] challenge loop (focused tests per iteration), rebase after #4539 + noproxy, full suite once, PR

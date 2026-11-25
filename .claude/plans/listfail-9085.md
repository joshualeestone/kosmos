# listfail-9085: a roster that cannot be read must not 404 a message to a running agent (kosmos#9085, the Kosmos half)

## What happened
On a Windows box `claude agents --json` crashed about once a minute from 08:19 to 13:32 (a Bun segfault, upstream).
win32roster.make keeps the last good list for HOLD_MS (15 s) after a failed read, then returns null. The roster then
refuses, server.js knownAgent (through claimantFor and status.paneRoster) reads false, and
POST /api/agent/<name>/thread answered 404 "no agent by that name". Messages to running agents arrived 4 h late.

## Decision (after blind review 1 rejected the first design)
The DM send gate answers an UNREADABLE roster as unknown: 409 with `because: 'unreadable'`, `retry: true` and "we
could not check which agents are running, so nothing was sent. Try again in a moment.", plus a board log line
([kosmos#9085] ... answered 409 unreadable, not 404) carrying the Windows reader's own reason. A 4xx, not a 503
(review 2): the board page and the iPhone read a 5xx on a send, and on a button press, as "it may have gone", which is
false here; the #8652 starting refusal is a 409 for the same reason. The iPhone shows a 4xx's own sentence. A roster that reads and does not
list the name is still 404 "no agent by that name". The sender keeps the message and retries; the 409 says why.

Decided in ONE roster read (review 5): a throw from the read is "could not look"; a name claimantFrom cannot key
(store.safeKey throws) is only "not ours" (review 4). On Windows, a failing Claude read with a codex agent keeping the
roster readable (win32roster refuses only when no codex row exists) makes an absent name unknown too: the gate asks
win32roster's cachedRun.problem() (review 5).

## Rejected
- The first design (commit edcc3a5a7b) listed a supervised agent inside win32roster.make when the read failed.
  Review 1: a partial roster reads as complete to every consumer that acts on absence (remove, restart's fromDead,
  create's clash check), so an unlisted agent would read "not running" with nobody having looked. Reverted.
- A send-only card built from the supervisor's presence (win32roster.supervisedPane + status.paneRosterFrom).
  paneRosterFrom gives a bare {sessionName, session, isNamedOurs}. The fields chat.deliver needs (target,
  isAgentPane, reachedByChannel) are only built inside status.snapshot's per-pane closure, which has side effects
  (sweeps, transitions). Taking that out of snapshot is its own card, kosmos#9087: delivering DURING an outage.
- A longer lastGood hold: it would keep listing agents stopped since the last good read.

## Weakest premise
That the chat listener retries a 409 'unreadable' as it retried the 404 (218 retries on 11-25). It lives outside this repo, and
I have not read it. If it gives up on a 409, this change still makes the reason honest but could lose a retry; the
follow-up card (#9087) says to check it.

## Known gap, not this card
Three other routes that type into an agent still answer an unreadable roster with a bare 404 "no agent by that
name": /api/agent/<n>/handoff-restart/ask, /api/agent/<n>/compact and /clear, and /handoff-restart/pickup (server.js,
each `if (!knownAgent(name))`). Listed on #9087.

## Tests
server.dm-listfail-9085.test.js: a failing source gives 409 unreadable with retry and the log line; a failing Claude
read behind a roster kept readable by a codex agent gives 409 unreadable with the reason logged. CONTROLS: a roster
that reads without the name is 404 (and with the Claude read healthy); an unkeyable name on a readable roster is
400/404, never unreadable; a listed agent is not refused at the gate. With the unreadable branch switched off,
the first test goes red.

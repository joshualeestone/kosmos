# listfail-9085: a roster that cannot be read must not 404 a message to a running agent (kosmos#9085, the Kosmos half)

## What happened
On a Windows box `claude agents --json` crashed about once a minute from 08:19 to 13:32 (a Bun segfault, upstream).
win32roster.make keeps the last good list for HOLD_MS (15 s) after a failed read, then returns null. The roster then
refuses, server.js knownAgent (through claimantFor and status.paneRoster) reads false, and
POST /api/agent/<name>/thread answered 404 "no agent by that name". Messages to running agents arrived 4 h late.

## Decision (after blind review 1 rejected the first design)
The DM send gate answers an UNREADABLE roster as unknown: 503 with `because: 'unreadable'` and "we could not check
which agents are running, so nothing was sent. Try again in a moment.", plus a board log line
([kosmos#9085] ... answered 503, not 404) carrying the Windows reader's own reason. A roster that reads and does not
list the name is still 404 "no agent by that name". The sender keeps the message and retries; the 503 says why.

## Rejected
- The first design (commit edcc3a5a7b) listed a supervised agent inside win32roster.make when the read failed.
  Review 1: a partial roster reads as complete to every consumer that acts on absence (remove, restart's fromDead,
  create's clash check), so an unlisted agent would read "not running" with nobody having looked. Reverted.
- A send-only card built from the supervisor's presence (win32roster.supervisedPane + status.paneRosterFrom).
  paneRosterFrom gives a bare {sessionName, session, isNamedOurs}. The fields chat.deliver needs (target,
  isAgentPane, reachedByChannel) are only built inside status.snapshot's per-pane closure, which has side effects
  (sweeps, transitions). Taking that out of snapshot is its own card: delivering DURING an outage. Follow-up filed.
- A longer lastGood hold: it would keep listing agents stopped since the last good read.

## Weakest premise
That the chat listener retries a 503 as it retried the 404 (218 retries on 11-25). It lives outside this repo, and
I have not read it. If it gives up on a 5xx, this change still makes the reason honest but could lose a retry; the
follow-up card says to check it.

## Tests
server.dm-listfail-9085.test.js: a failing source gives 503 unreadable and the log line; CONTROLS: a roster that reads
without the name is 404, and one that lists the agent is not refused at the gate. With the 503 branch switched off,
the first test goes red.

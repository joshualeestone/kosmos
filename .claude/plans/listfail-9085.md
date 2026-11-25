# listfail-9085: a failed `claude agents --json` read must not 404 a message to a running agent (kosmos#9085, the Kosmos half)

## What happened
On a Windows box `claude agents --json` crashed about once a minute from 08:19 to 13:32 (a Bun segfault, upstream).
win32roster.make keeps the last good list for HOLD_MS (15 s) after a failed read, then returns null. With null, the
roster refuses, server.js knownAgent (through claimantFor and status.paneRoster) reads false, and
POST /api/agent/<name>/thread answers 404 "no agent by that name". Messages to running agents arrived 4 h late.

## Decision
When the Claude read has failed past the hold, win32roster still emits a row for each Kosmos-owned Claude agent whose
supervisor is up by its own presence: win32streamstate.liveNames (the supervisor's presence pipe, or a live pid in its
state file, the same signal create.runningJobs uses since #8410). This is the codex pattern (win32codexlive) applied
to Claude. Delivery then goes through the supervisor's named pipe (chat.js deliverThroughChannel), and that pipe
answers for itself when the supervisor is gone. A switch onto the fallback, and the way back, is written to each
agent's supervisor log, with the read's own reason.

## Rejected
- A longer lastGood hold. It would keep listing agents stopped since the last good read, with nothing that knows.
- A 503 in place of the 404. That is more honest, but it still delivers nothing for as long as the read fails.

## Weakest premise
The card's state is not drawn from this path: win32capture still finds no live row for the agent, so the card reads
unknown or remembered (#5949). A send to a card in an unknown state goes through chat.deliver's own gates. I read
deliverThroughChannel and the reachedByChannel mark, but I did not run a delivery on Windows.

## Tests
engine/win32roster.listfail-9085.test.js drives the real status.js roster with a failing reader. Its first and fourth
tests go red with the fallback switched off.

## Not this card
The Bun crash itself (Homer's half): an upstream report.

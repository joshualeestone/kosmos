# kosmos#8658: an agent's message, and a message during a crash relaunch, get #8652's starting wait

## Finished looks like
On Windows, `kosmos msg` from one agent to an agent that was just created or restored is delivered after a short
wait, or answered "still starting, nothing was sent"; a message sent while a crashed agent is being relaunched is
waited for the same way; a name that is really missing answers exactly as before, at once.

## Change
1. server.js `POST /api/msg`: for a sender its agent token identified, with words the send would take, if the
   recipient has no roster card and `startingAgent(to)` (from #8652) is true, wait with `awaitRosterRow(to)` and
   re-read the roster; if the row never shows, answer `could_not` "NAME is still starting, so nothing was sent. Try
   again in a moment." and keep it as a refused send (`messages.logRefusedSend`, now exported), as every other
   attributed refusal is. Same 200/`could_not` shape the route uses for every refusal.
2. server.js `startingAgent`: besides a record row written in the last minute, an agent that has a record row and
   whose supervisor state file (engine/win32streamstate.js, written the moment a run starts, a crash relaunch
   included) was written in the last minute counts as starting. New `win32streamstate.writtenAt(name)`.

## Rejected
- Re-stamping the ownership row on a resume (iteration 1 of this branch): a Restart forgets that row on purpose, and
  the re-stamp from the supervisor's process could race the forget and bring it back. The state file is written on
  every start anyway and is not the ownership authority.
- Waiting for an unidentified sender (pane path with no token): it would tell an unknown caller that a name is a
  just-started agent, and hold its request. `kosmos msg` on Windows sends a token; the Mac has no record, so no wait.
- Changing `kosmos msg`'s client to retry: the server knows the agent is starting, the client does not.

## Weakest premise
That a recent state-file write means "starting" only while the roster cannot see the agent: a running agent writes it
on every state change, but the check runs only when the agent has no roster card. A crash-looping agent stays
"starting" while it loops, so a message to it waits the 6 s and then says so.

Time budget: 6 s wait plus the Windows delivery's own 8 s timeout is near the Windows CLI's 15 s request timeout
(tools/windows/kosmos-cli.js); past it the CLI says the message may have been delivered and its retry is deduplicated.

## Tests
- server.msg-starting-8658.test.js: placed once the row appears; control with the wait off (not delivered); never
  appears (still starting, bounded); missing name and running agent unchanged and immediate. On the old server.js the
  two starting arms fail and the rest pass.
- Same file: a relaunch (old record row, fresh state file) waits and is placed; old row and old state file does not
  wait; a state file with no record row is not ours; a sender with no token never waits or learns anything; words
  the send would refuse keep their own refusal; the starting refusal is kept as a refused send.

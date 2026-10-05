# linklost-5333: a person is told when a running agent has lost its link to Kosmos (kosmos#5333, slice 2)

Slice 1 (agentid-5333, PR #5336) tells the AGENT how to recover when its token is refused. This slice tells the
PERSON: a running agent whose run token is no longer on file cannot read their messages or answer them, and until now
nothing on the board said so ("a message from the person can sit unanswered indefinitely", the report).

## Finished looks like
- Each agent card carries `linkLost`: true only for a session Kosmos launched (ours by name) that carries its run's
  token instance (@kosmos_token_instance, stamped by the supervisor) and this board's token file for the agent is there
  without that run's token (a retire, or the run replaced). A missing file (a revoke, a wiped store, or another board's
  store) is 'unknown' and never flagged: a second board would otherwise call every healthy agent lost. Paneless false.
- sendertoken.instanceState(name, instance): 'held', 'gone' (its file readable, the run's token absent), or 'unknown'
  (no file, unreadable, unparseable, old shape, or no instance); only 'gone' is lost.
- The agent's page shows, under its state, once linkLost has been true on two polls in a row (past a restart's
  moment): "<Name> has lost its link to Kosmos, so it cannot answer you in Kosmos. Restart it to fix this: "Write a handoff,
  then restart" keeps what it was doing." with a Restart button that opens the shared restart confirm for that agent.
  ("Answer", not "read": a message still reaches it, typed into its window; what fails is everything it sends back.)
  Not for an agent being removed (its token is revoked on purpose), and not beside "Start this agent" (stopped) or
  "Sign in again" (auth_failed). "In Kosmos": a -discord agent still answers through its own bridge.
  Gone again once the token is on file.
- engine/status.linklost-5333.test.js (instanceState, the card field, a wiped store, controls) and an arm in
  render-agent-pill-3958.js (Chromium and WebKit: the notice, its Restart, and the control both ways).

## Decided
- Read per snapshot, per agent: one small file read for an agent whose session carries an instance, none otherwise.
- The tmux column is hex-only, as minted; the fleet fixture fills it empty by default, so no existing fleet changes.
- Not on the grid card in this slice: the agent page is where the remedy (Restart) is; the grid's state words are a
  separate design question.
- Not telling the running agent itself here: slice 1's CLI hint reaches it on its next verb.

- Any token revoke other than a removal (a rename, a handoff-restart's retire landing before its session closes)
  shows this notice by design if it lasts past two polls: the agent really cannot answer, and Restart is its remedy.
- Two polls in a row, each counted once (a new card object), within six polls of each other (30 s): a slow answer or
  a throttled hidden tab still shows it; a visit long ago never counts.

## Weakest premise
- A second board on another data root that shares the tmux server and once minted for the same bare name has a file
  for that agent without the main board's run, and would show the notice for a healthy agent. A board that never
  minted for it reads unknown. Accepted: a developer setup, and the notice states a true fact about THAT board.
- A supervisor minting into a store this board does not read leaves no file here: unknown, silent. The reporter's
  case (#5333) may have been exactly that; slice 1's CLI hint is what reaches the agent then.
- Detection relies on retire leaving an empty list (sendertoken.retire, this slice) rather than deleting the file;
  revoke (remove, rename, recreate) still deletes, and removals are suppressed anyway.

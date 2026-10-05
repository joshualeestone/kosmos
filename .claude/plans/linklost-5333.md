# linklost-5333: a person is told when a running agent has lost its link to Kosmos (kosmos#5333, slice 2)

Slice 1 (agentid-5333, PR #5336) tells the AGENT how to recover when its token is refused. This slice tells the
PERSON: a running agent whose run token is no longer on file cannot read their messages or answer them, and until now
nothing on the board said so ("a message from the person can sit unanswered indefinitely", the report).

## Finished looks like
- Each agent card carries `linkLost`: true only for a session Kosmos launched (ours by name) that carries its run's
  token instance (@kosmos_token_instance, stamped by the supervisor) whose token the store this board reads no longer
  holds. Whatever removed it (a retire, a revoke, a wiped store), this sees it. Paneless cards answer false.
- sendertoken.instanceState(name, instance): 'held', 'gone' (readable and absent, or no file at all), or 'unknown'
  (unreadable or unparseable, or no instance); only 'gone' is lost. An unreadable store never reads as lost.
- The agent's page shows, under its state, while linkLost is true: "<Name> has lost its link to Kosmos, so it cannot
  read your messages or answer you. Restart it to fix this: "Write a handoff, then restart" keeps what it was doing."
  with a Restart button that opens the shared restart confirm for that agent. Gone again once the token is on file.
- engine/status.linklost-5333.test.js (instanceState, the card field, a wiped store, controls) and an arm in
  render-agent-pill-3958.js (Chromium and WebKit: the notice, its Restart, and the control both ways).

## Decided
- Read per snapshot, per agent: one small file read for an agent whose session carries an instance, none otherwise.
- The tmux column is hex-only, as minted; the fleet fixture fills it empty by default, so no existing fleet changes.
- Not on the grid card in this slice: the agent page is where the remedy (Restart) is; the grid's state words are a
  separate design question.
- Not telling the running agent itself here: slice 1's CLI hint reaches it on its next verb.

## Weakest premise
That the board's own store is the one the supervisor minted into. If the cause on the reporter's machine was a
supervisor minting into a DIFFERENT store, this notice would fire for every agent (correctly: none can be matched),
which is exactly the signal the person needed, but it would not say why.

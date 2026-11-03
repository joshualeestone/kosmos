# kosmos#7840: the iPhone Profile says why it has no instructions or skills

## Measured first (this Mac's live board, 0.7.84, 04:4x CST 11-03)
- The phone asks by `sessionName` from /api/status (BoardLogic parseAgents), which for a long-running fleet agent is
  the board name with `-discord` stripped (`pigeonpete`; the raw tmux session `pigeonpete-discord` is a separate
  field). By that name both routes answer 200 for a fleet agent: instructions `{exists:true, editable:true, text}`,
  skills `{ok:true, skills:[...]}`. Only the raw session name fails (404 "no agent by that name" / "there is no agent
  by that name on this computer"), and the phone never sends it. So the fleet-agent explanation on the card does not
  hold for what the phone sends.
- The relay tunnel admits by device and does not filter paths; neither GET needs a remote step-up; the phone's
  transport (throughMac) has no size cap or timeout of its own.
- What Josh's board answered at 04:11 is on his Mac, which no instrument here reads: not recovered.

## The defect that is certain
The phone dropped every answer that was not a 200 it could parse, and showed one fixed sentence ("We cannot read
this right now.") for no answer, a refusal, an error and an unreadable body alike. The board's own reason (its
`because` or `error`) never reached the person, so neither the person nor anyone debugging could tell which case it was.

## Change
- ios/Kosmos/AgentInfoLogic.swift: `instructionsRead` / `skillsRead` answer `.got(value)` or `.reason(words)`:
  no answer reads "We could not reach your computer just now. Pull down to try again." (the page's own words for its
  computer); an answer carries the board's `because`, else its `error`, through `Board.sentence`, else "We cannot read
  this right now." (no status number). `profileNext` decides what a section shows after a read: an answer replaces what
  was shown; no answer keeps a value already shown and gives its reason only when there is nothing.
- ios/Kosmos/AgentInfoView.swift: each section shows its value or its own reason, through `profileNext`.
- ios/LogicTests/agentinfo/main.swift: an ordinary agent's answers (the board's shapes) show real instructions and
  skills; each failure kind shows its reason; what the screen shows after each kind of read.

## Rejected
- Changing the board to resolve a raw `-discord` session to the agent: the phone does not send it (measured).

## Weakest premise
That the next failure, whatever its cause, will be explained by the board's own words. A failure at the relay before
the board answers reads as "did not answer", which is true but does not say where.

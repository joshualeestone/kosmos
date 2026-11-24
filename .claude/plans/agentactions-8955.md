# agentactions-8955: restart and remove an agent natively from the iPhone agent page (kosmos#8955)

## Goal
Part of #8952 (Josh 11-23: iPhone taps that drop into the blue web board). The agent page's AI Settings sent the
person to the board to restart or remove an agent. Both are now on the phone, each behind its own confirmation, and
the board row says only what is still there, and that it is a web page.

## Design (decided, reversible)
- Mirror the board (web/index.html), never invent rules or words:
  - Restart: POST /api/agent/<n>/restart (rst-go). Took only on outcome "restarted" (restartTook); otherwise the
    engine's because or error plus both step lists (restartFailureLine).
  - The dialog: "Restart <name>?", the cost line from restartCost on /api/status commitments (an earned clear only
    when state clear and an empty list; a malformed record is unknown), "Restart <name>", "Leave it running".
  - After it took: restartReadyWait (30 s, every 2 s, ready only after seeing it not ready, ready = boardCanSeeIt
    and not restarting), then the automatic hello to /thread; "said hello" only when the delivery was placed, a held
    hello says why (wakeHeldLine; the timed forms use their untimed sentence, which the board also shows).
  - Remove: GET /api/agent/<n>/removal for the engine's hint, question, reassurance, Loses, Keeps; DELETE without
    ?force. A 5xx, unparsed or shut-out read is "could not reach", never a fact about the agent (loadRemoval);
    partial is not success (rm-go).
- Not offered on the phone, and the page says where they are: "Write a handoff, then restart", the setup-and-restart
  offer for a hand-linked window (canWriteJob), and "Remove from my board anyway" for an untied agent.
- After a removal the page stays, with "Removed. <name> has left your board." It does not promise putting it back,
  because a jobless agent cannot be (engine/remove.js plan), and the phone does not know which kind it removed.
  Rejected: popping the page and the chat in code, which goes through #8055's link-close detection and could record
  a person's close as "closed away".
- Commitments live on Board.Agent (BoardLogic.swift), since every LogicTests runner compiles that file.

## Tests
- ios/LogicTests/run-agentinfo.sh: 270 (79 new), with guards that the board's page still holds each mirrored
  sentence and rule. Mutants: any 200 counted as restarted; ready without seeing the gap: each red.
- Every LogicTests runner green on the final tree.
- App build for the iOS Simulator.
- KosmosUITests/AgentActionsUITests (TEST_RUNNER_KOSMOS_UI_PLUS=1): both dialogs open with their words and close by
  their outside (iOS 26+ popovers draw no cancel button); four screenshots.

## Weakest premise
That a person on the phone reads the plain "We cannot tell what X is part way through" line as enough warning: the
board shows the same words, but on a wider dialog with the list as bullets.

## Not in this branch
Seeing a real restart and removal from a phone against a real board, after a TestFlight build (Mona Lisa).

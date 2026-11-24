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
    when state clear and an empty list; a malformed record is unknown), then rst-cost's line true of every restart
    (they come back with nothing in their memory), "Restart <name>", "Leave it running". A restart superseded by a
    newer one from another page lets go of this page's hold.
  - The removal plan is read on open and on a pull to refresh (the board reads it on open only); a 401 or 403 says
    the phone was not let in.
  - After it took: restartReadyWait (30 s, every 2 s, its own /api/status read, ready only after seeing it not ready,
    ready = boardCanSeeIt and not restarting; one token per agent, outliving the page, as RESTART_HELLO_SEQ), then
    the automatic hello to /thread; "said hello" only when the delivery was placed, a held hello says why
    (wakeHeldLine, in its order: sign-in before limit; where the board names a reset time the phone leaves it out).
  - Remove: GET /api/agent/<n>/removal for the engine's hint, question, reassurance, Loses, Keeps; DELETE without
    ?force. A 5xx, unparsed or shut-out read is "could not reach", never a fact about the agent (loadRemoval);
    partial is not success (rm-go).
- Not offered on the phone, all three named in the board-row footer: "Write a handoff, then restart", "Remove from my
  board anyway" for an untied agent (the Remove section also says to use the board), and the board's "Set up and
  restart" offer for a hand-linked window with no launch job (canWriteJob): the phone sends a plain restart and shows
  the engine's own refusal. A plan read that lands while a removal is under way is dropped.
- After a removal the page stays, with "Removed. <name> has left your board." It does not promise putting it back,
  because a jobless agent cannot be (engine/remove.js plan), and the phone does not know which kind it removed.
  Rejected: popping the page and the chat in code, which goes through #8055's link-close detection and could record
  a person's close as "closed away".
- While a restart or removal runs, or once the agent is removed, every other control on the page is held (Save, the
  provider switch, the fresh start), and a switch, save or fresh start under way holds Restart and Remove.
- Each new dialog sits on the button that opens it, not on the page beside its other dialogs.
- Left as is, deliberately: the engine's Loses and Keeps are shown as sent (the board passes them through cloudWords,
  which the phone's other screens do not use either), and the source-count checks in the agentinfo suite are
  tripwires on how the page holds its controls, beside the behaviour checks.
- Commitments live on Board.Agent (BoardLogic.swift), since every LogicTests runner compiles that file.

## Tests
- ios/LogicTests/run-agentinfo.sh: 289 (98 new), with guards that the board's page still holds each mirrored
  sentence and rule. Mutants: any 200 counted as restarted; ready without seeing the gap; the limit check before sign-in: each red.
- Every LogicTests runner green on the final tree.
- App build for the iOS Simulator.
- KosmosUITests/AgentActionsUITests (TEST_RUNNER_KOSMOS_UI_PLUS=1): both dialogs open with their words and close by
  their outside (iOS 26+ popovers draw no cancel button); four screenshots.

## Weakest premise
That a person on the phone reads the plain "We cannot tell what X is part way through" line as enough warning: the
board shows the same words, but on a wider dialog with the list as bullets.

## Not in this branch
Seeing a real restart and removal from a phone against a real board, after a TestFlight build (Mona Lisa).

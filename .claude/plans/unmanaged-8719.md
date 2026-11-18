# unmanaged-8719: agents started outside Kosmos (part 1: say why, mark it, refuse with the reason)

Card: kosmos#8719 (priority, from a person's agent's feedback 11-18; Splinter assigned 17:26 CST). Plan posted on the
card. This branch is part 1 (asks 1, 4, 5). Part 2 (asks 2, 3: reclaim from the board, adopt re-bind) is a later branch.

## Finished means (part 1)
An agent whose window Kosmos did not start (card isNamedOurs false) carries a visible "Not started by Kosmos" label on
its tile and list row; its pill's hover and screen-reader text, and its own page, say why Kosmos will not message it
and what makes that possible; a message the person sends to it is refused 409 with that reason (board and iPhone show
the error text), not 404 "no agent by that name".

## Cause (from code, see the card)
Kosmos ties a window to an agent by a tmux session option set at launch (@kosmos_agent == session name,
launchidentity.paneSessionIsOurs). A hand-started window has none: delivery refuses (correct), the board shows the
screen-read state with no reason, the direct-chat route 404s via knownAgent.

## Changes
- web/index.html: stateReason's first branch for isNamedOurs === false (a literal, since tests lift it alone);
  untiedFlagHtml on the tile's model row and the list row's model cell, with an .auntied style; the detail panel's
  #d-untied sentence names Kosmos's launch mark, keeps the -discord spelling, and says what makes it reachable.
- server.js: the agent thread route answers 409 { because: 'untied' } with UNTIED_SEND_WORDS when the name's card is
  on the board but not ours (and the agent is not starting); a name with no card still 404s.
- Tests: web.untied-8719.test.js (reason, label, detail sentence, each with a control); server.dm-starting-8652's
  stranger case now expects 409 untied (still refused, still no wait), plus a new case with a 404 control.

- Review 1: the chat-open refusal ('borrowed', still 404 and still keyed by `because` on the board) now carries
  UNTIED_READ_WORDS, since the iPhone shows its text; the page's #d-untied says only what it adds to #d-task's reason;
  the sentence states the condition ("until Kosmos starts it"), not a route that the hand-started window blocks today.
- Known, not changed: between the supervisor's new-session and its set-option @kosmos_agent (milliseconds), a poll could
  read a Kosmos agent as untied; the card was anonymous in that gap before this change too.

## Decided / rejected
- The tile carries a short label, not the sentence: Josh ruled sentences off tiles (#6716). The sentence is the pill's
  hover, screen-reader text and the agent page, where every other reason lives.
- The pill keeps its screen-read state (Idle/Working). Rejected: a new state for untied, which would ripple through
  filters, counts and the iPhone; the label and reason carry it.
- Not touched: what Kosmos will type into (the guard stays exactly as it is).

## Weakest premise
"Kosmos can message it once it is started from Kosmos" assumes a person can start it from Kosmos (Look for agents /
Connect, which refuse while a window holds the name, so they must stop it first). Part 2's reclaim replaces this with
a one-step action and will change the sentence.

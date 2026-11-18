# unmanaged-8719: agents started outside Kosmos (part 1: say why, mark it, refuse with the reason)

Card: kosmos#8719 (priority, from a person's agent's feedback 11-18; Splinter assigned 17:26 CST). Plan posted on the
card. This branch is part 1 (asks 1, 4, 5). Part 2 (asks 2, 3: reclaim from the board, adopt re-bind) is a later branch.

## Finished means (part 1)
An agent whose window Kosmos cannot tie to it (card isNamedOurs false: no Kosmos launch mark) carries a visible "Not
linked to Kosmos" label on its tile and list row; its pill's hover and screen-reader text, and its own page, say why Kosmos does not message it; a message the person sends to it is refused 409 with that reason (the iPhone and API callers
show the error text; the board's composer is already closed for such a name), not 404 "no agent by that name".

## Cause (from code, see the card)
Kosmos ties a window to an agent by a tmux session option set at launch (@kosmos_agent == session name,
launchidentity.paneSessionIsOurs). A hand-started window has none: delivery refuses (correct), the board shows the
screen-read state with no reason, the direct-chat route 404s via knownAgent.

## Changes
- web/index.html: stateReason's first branch for isNamedOurs === false (a literal, since tests lift it alone);
  untiedFlagHtml on the tile's model row and the list row's model cell (.auntied; it wraps in the list cell, which is
  one ellipsed line at desktop and clipped it); the detail panel's #d-untied line is self-contained ("Kosmos cannot
  confirm it started this window, so it does not change its picture, role or instructions from here").
- server.js: the agent thread route answers 409 { because: 'untied' } with untiedSendWords when the name's card is
  on the board but not ours (and the agent is not starting); a name with no card still 404s.
- Tests: web.untied-8719.test.js (reason, label, detail sentence, each with a control); server.dm-starting-8652's
  stranger case now expects 409 untied (still refused, still no wait), plus a new case with a 404 control.

- Review 1: the chat-open refusal ('borrowed', still 404 and still keyed by `because` on the board) now carries
  untiedReadWords, since the iPhone shows its text. (Its remedy clause was later removed, review 6.)
- Review 2: #d-untied stands alone (#d-task hides on a question; the picture button reads it as its description).
- Review 3: every sentence says what is checked ("Kosmos cannot confirm it started this window"), never where the window
  came from: a session Kosmos started and then renamed fails the same check (delete-leftover.js, #8640). Label "Not
  linked to Kosmos", not "Not started by Kosmos", for the same reason.
- Known, not changed: between the supervisor's new-session and its set-option @kosmos_agent (milliseconds), a poll could
  read a Kosmos agent as untied; the card was anonymous in that gap before this change too.

- Review 4-7: the untied reason leads; for auth_failed or rate_limited one plain clause says what the screen shows. No
  ordinary reason is borrowed (review 7: they promise Kosmos actions, a retry, a restart, a delivery).

- Review 6: no sentence promises a route ("until Kosmos starts it" was raised three times: the hand-started window
  blocks Look for agents and Connect). The words state only the fact; the remedy is part 2's reclaim action. The send's
  409 uses nameRefusal's own test (isNamedOurs !== true), so read and send agree.

## Decided / rejected
- The tile carries a short label, not the sentence: Josh ruled sentences off tiles (#6716). The sentence is the pill's
  hover, screen-reader text and the agent page, where every other reason lives.
- The pill keeps its screen-read state (Idle/Working). Rejected: a new state for untied, which would ripple through
  filters, counts and the iPhone; the label and reason carry it.
- Not touched: what Kosmos will type into (the guard stays exactly as it is).

## Weakest premise
Until part 2 ships, the board says why and offers no one-step remedy: the person still has to stop the window and start
the agent from Kosmos themselves. Part 1 is honest about that rather than promising a route.

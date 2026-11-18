# nomodel-8667: no model recorded says so and links AI Settings (kosmos#8667)

## Goal
An agent with no model recorded (and a launch record, so not "Made before Kosmos recorded this") said a bare
"Unknown Model". It now says "No model recorded: set it in AI Settings", and on a card or list row "AI Settings" is
a link to that agent's AI Settings.

## Decisions
- **Words in modelLine, link at the draw sites.** modelLine stays plain text (tests lift it alone and it must call
  nothing new); `modelLineHtml(a, line)` turns the one no-model line into HTML with the link. Used by the card's
  `.amodel` and the list row's `lmodelCell`. Every other line is the escaped text as before.
- **The link is a real address**, #7280's `?tab=detail&agent=<name>&sec=model`, so a new-tab click works. A plain click
  is caught in the board click handler before the card's own open and its answer route, as the star is, and opens
  `openDetail(name, 'model')` in place (scrolled to it on a phone). A modified click is left to the browser.
  Reachable from the grid's cards and the list view's rows. My Agents hides the model cell (.myagents-list), so it
  never shows the link (review 3; the browser check pins that as a control).
- **On the list row the whole sentence is the link** (with it in full as a title): the cell is one line cut by an
  ellipsis, so the visible part must be the link.
- **Inside AI Settings the line is short, "No model recorded"**: the Runs on box (runsOnLine), the Switch-model menu's
  placeholder, and the iPhone's AI Settings segment (Board.aiSettingsModelLine). Elsewhere it is the full sentence.
- **The phone's logic mirrors the board's words** (ios/LogicTests/agentinfo checks them against the page). The one
  place the phone shows the line, its AI Settings segment, shows the short form.
- **No shared constant for the sentence**: modelLine must stay liftable alone (tests lift it without the rest of the
  page), so it cannot reference a page constant. modelLineHtml, runsOnLine and the Switch menu compare the literal
  (one exact line takes the link or the short form). tileModelLine and lmodelCell compare literals too, as #8662
  (merged first; this branch is rebased on it) does: a call to modelLine would say the sign-out on a signed-out
  board. engine/clilists.js (#8665, also merged first) carries the same words, held to the page by its parity
  matrix, which now varies isNamedOurs. Unit tests pin the link, both short forms on an owned agent (Runs on and the
  iPhone segment), and the earlier-model borrow; the Switch menu placeholder is pinned by its source line only.
- **The CLI says the card's words**, "set it in AI Settings" included, because #8665's rule is that `kosmos agent list`
  names the model the way the card does; AI Settings is on the board.
- Rejected: changing the server's `neverRecorded` split (#149/#150), out of scope.

## Where the line shows (review 8)
A running agent's card and list row. A not-running card and row draw no model line at all (only the machine flag, if
any), as before this change, so a stopped agent with no model shows neither the line nor the link; its page's Runs on
box says "No model recorded". The card's "done when" is checked on a running agent.

## Only for an agent Kosmos started (review 7)
The full sentence and the link need `isNamedOurs === true`, the model menu's own test (paintModelPicker's `ours`):
for an agent Kosmos did not start, AI Settings refuses to change the model, so the line says only "No model
recorded". An absent flag reads as not ours, as the menu reads it. The iPhone mirrors this (AgentDetails.isNamedOurs,
false when absent).

## Weakest premise
That "no model recorded" with a launch record is always fixable in AI Settings. An agent whose runner picks its own
model never reaches this line (codex, gemini, grok, antigravity, muse and the vendor accounts each return their own
words first), so the line only appears for Claude-runner agents, where AI Settings does set the model.

## Tests
web.nomodel-8667.test.js (words, link markup, encoding and escaping, controls for every other line, the tile's
earlier-model borrow, the card wiring and the click route order), web.made-before.test.js and server.test.js pins
moved to the new words, every ios/LogicTests runner.

## Done when (card)
On a real board an agent with no recorded model shows the new line with a working link; an agent with a model and a
"Made before" agent unchanged. Needs a release to observe on this Mac's board: parked needs-release after merge.

# permit-8952: a permission request no longer opens the whole web board on the iPhone (kosmos#8952, slice 1)

Source: Josh on his iPhone, 2026-11-23 20:18 CST. An agent's chat said "Angel asked you something. Answer on your
computer's board ›"; the tap opened the whole web board in a navy sheet, showing the raw terminal prompt
("Do you want to proceed? 1. Yes 2. No ↑ 37 more lines Esc to cancel · Tab to amend").

## Done when (this PR)
In an agent's chat on the iPhone, a question or permission with no native buttons opens nothing: it says, in plain
words, that the agent is waiting and to answer on the computer (while it is the one being asked), or only what was
asked (once past). A permission prompt with a "↑ N more lines" scroll line between its options and its footer reads its
options as the real prompt does, so the board and the phone get the same buttons whenever the #6054 gate allows them.

## Why tonight's had no buttons (measured)
- The phone answers permissions natively already (ChatChoices.swift PermissionCard, #7016) when the Mac sends `choices`.
- Angel's was Claude Code's safety check on a long chained command; it reached the phone as a reported needs-you
  (board log 02:17:29Z), and a reported row never carries buttons.
- Read from the screen it would also have had none: since #6054 review 3 a box whose top scrolled away gets no buttons
  (nobody may approve a command the board cannot show whole). And claudePermissionPrompt returned null when a
  two-space "↑ 37 more lines" sat between the options and the footer (three spaces: glued onto the No label).

## Changes
1. engine/status.js: CLAUDE_SCROLL_HINT (`↑/↓ N more line(s)`) is skipped in claudePermissionPrompt's option walk.
   permissionAnswerable is untouched (the #6054 gate).
2. ios BoardLogic.swift: Board.askingNow(row, in:, needsYou:) (the newest question/permission row while the agent
   needs the person) and Board.askedLine(way, now:). ChatView: a question/permission WayThroughRow has no action and
   says the askedLine; files and unsent words keep their link. WayThroughRow's action is optional.

## Decided
- The link is removed, not relabelled: with no `choices` the board has no buttons either, so it only showed the raw
  window text Josh called "a blue alternate version of the app".
- Words: "<name> needs your permission. Answer it on your computer." / "<name> asked you something. Answer it on your
  computer." while asked; "<name> asked for your permission." / "<name> asked you something." once past.

## Not in this PR (next slices, on the card)
- A native card with a working No and "Yes needs your computer" when the box cannot be verified (needs a deny-only path
  through the #6054 press route).
- Verifying a cut-off box against the agent's transcript, so Yes works on the phone too.
- Part 2: the other web-board taps (Files/8952-web-board-taps.md, 31 in-app, 4 notification routes).

## Tests
- status.permscroll-8952.test.js: the real 2.1.296 Bash capture with the scroll line at 1, 2, 3 spaces, up and down,
  singular: options identical to the real prompt; CONTROL other lines still refused; the #6054 gate unchanged.
  Mutation-checked (removing the skip fails 2 of 3).
- ios/LogicTests/main.swift: askingNow (newest, older, not needing you, a file row) and askedLine (words, no board,
  no chevron, no terminal words). Every run-*.sh green; the app builds for the simulator.

## Weakest premise
That "needs you" plus newest question row means the row is the one being asked. A reported safety check that timed
out leaves the agent no longer needing the person, so the row reads as past ("asked for your permission"), which is
true by then.

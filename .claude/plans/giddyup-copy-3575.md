# Plan: #3575, setup final screen keeps Giddy Up, reworded to starting Kosmos, lands on the dashboard

## Ask (Josh, #admin 2026-09-24 07:49 and 07:51 CDT, quoted on the card)
- KEEP the "Giddy Up" button ("several people ... laughed and thought that was cute and fun").
- Change the page's message so it is about starting to use Kosmos, not about creating a first agent.
- Giddy Up lands on the agent dashboard, not the create-agent screen.
- Draft the copy ourselves; Josh swaps it if he wants.

## Where
`web/index.html` `frPaintFleet()`: the forced #2497 block is the only reachable ending of first-run
step 9 (the adopt/scan arms below it are deliberately unreachable). It set the title
"Create your first agent.", body "Let's get started." + the #2497 import pointer, and
`frActions({ label: 'Giddy Up', go: () => frFinish(openCreate) })`.

## Change
- Title: "You're ready to start using Kosmos."
- Body: "Let's get started. Giddy Up takes you to your Agents dashboard, home base for everything you
  do in Kosmos." ("Let's get started." kept: Josh's own phrase for this screen in the first message.)
- Import pointer: Import is no longer "the next screen", so it names the real path from the
  dashboard: "On the dashboard, choose New agent, then pick the Import option." New agent is the
  boardbar tile (#new-agent) or the consolidated rail's + (#rail-agents-new), present on an empty
  AND a populated board.
- Action: `frFinish(() => showTab('agents'))`, the same landing the adopt fork already uses.
- Button label unchanged.

## Rejected
- Quoting the Import option's full label ("Import an agent you already have") in the pointer: it
  contains "already have", which the server.test.js #2497 guard rejects as adopt-screen copy.
  Weakening that guard to fit the copy was the wrong trade, so the copy names "the Import option".
- Routing through frForkActions: it honors FR.path and would render "Take me to my agents" on an
  adopt machine, which #2497 deliberately stopped.

## Weakest premise
The pointer relies on a "New agent" control being visible on the dashboard Giddy Up lands on, in
whichever layout the person has. First draft named the empty state's "Create your first agent"
button instead, which does not exist on an adopt machine's populated board (challenge-loop
iteration 1 caught it). click-first-run now asserts a New agent control on both the populated
(section 1) and empty (section 4) board, so a layout change that drops it goes red.

## Tests
- Unit: web.firstrun-panecount-9screen, web.found-every-path-1493, server.test.js heading/landing
  assertions moved to the new copy, with negative assertions that the ending no longer opens Create
  Agent or says Import is on the next screen. Control: the updated tests fail 7/7 against origin/main's
  index.html.
- Browser checks: click-first-run (lands on Agents tab, #panel-create hidden, New agent present on
  populated and empty boards and opens create), render-first-run, render-firstrun-wizard-flow,
  render-adopt-1531, render-found-count, render-found-undo, render-firstrun-scan-on-grant-1652,
  render-import-add-inplace-2419 (new heading). Run the page checks on the COMMITTED branch: the
  driver freezes HEAD, so an uncommitted edit is not what it tests.
- Served-build verification (Mac + Windows fresh profile) after the release carrying this.

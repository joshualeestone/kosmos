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
- Import pointer: Import is no longer "the next screen", so it names the real path from the empty
  dashboard: "On the dashboard, choose Create your first agent, then pick the Import option."
- Action: `frFinish(() => showTab('agents'))`, the same landing the adopt fork already uses.
- Button label unchanged.

## Rejected
- Quoting the Import option's full label ("Import an agent you already have") in the pointer: it
  contains "already have", which the server.test.js #2497 guard rejects as adopt-screen copy.
  Weakening that guard to fit the copy was the wrong trade, so the copy names "the Import option".
- Routing through frForkActions: it honors FR.path and would render "Take me to my agents" on an
  adopt machine, which #2497 deliberately stopped.

## Weakest premise
The pointer tells the person to press "Create your first agent" on the dashboard. That button is the
EMPTY-board state. First run never imports (#2497) and the #3034 setup-assistant seed is gated off,
so a new user's board is empty today. If the #3034 seed is turned on, the board is no longer empty at
this moment and the pointer must change with it. click-first-run.js asserts the button is there after
Giddy Up, so that change would go red rather than drift.

## Tests
- Unit: web.firstrun-panecount-9screen, web.found-every-path-1493, server.test.js heading/landing
  assertions moved to the new copy, with negative assertions that the ending no longer opens Create
  Agent or says Import is on the next screen. Control: the updated tests fail 7/7 against origin/main's
  index.html.
- Browser checks: click-first-run (lands on Agents tab, #panel-create hidden, empty-state button
  present and opens create), render-first-run and render-firstrun-wizard-flow (new heading).
- Served-build verification (Mac + Windows fresh profile) after the release carrying this.

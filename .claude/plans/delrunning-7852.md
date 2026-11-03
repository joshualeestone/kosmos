# delrunning-7852: an agent page whose delete is running says so

## Finished looks like
While a Windows "Delete what is left" of an agent runs (the Recycle Bin move can take minutes, #7835), that agent's
page, opened or reloaded meanwhile, shows its delete block with the board's sentence ("A delete of what is left of this
agent is running now; ...") and no delete button, instead of hiding the block as if nothing were left. Once the delete
ends, the next read shows the block as usual (or hides it when nothing is left).

## Split
PigeonPete's #7856 did the other half of #7852 (a dropped DELETE request asks the plan again and shows its words).
This half is the plan flag (agreed in Fleet Builders, m2598 to m2600).

## Change
- planAsync's two refusals while a delete of the name runs carry `running: true`.
- loadLeftover: a plan with `running` shows the block, the board's words capitalised as a sentence, and hides the
  delete button; every other read shows the button again.
- Tests: the flag during a delete and not after (engine); the page branch order and the button (web). Each red on its
  mutant.

## Rejected
- A sentence of the page's own: the block's words come from the engine (house rule in web.delete-leftover.test.js).
- A timer of its own: the agent page's five-second poll is there already; it now re-reads the plan while the block
  says running (it read it only on a non-poll repaint, so "running" would have stayed after the delete ended).

## Weakest premise
That the five-second poll runs while the agent page is open (it does on the detail page; nowhere else shows the block).
Windows only (the flag is set where the hold is, which is Windows only).

## Review round 1
- The poll re-reads the plan while the block says running (DEL_SHOWS_RUNNING), so it changes when the delete ends.
- #7856's no-answer path (deleteNoAnswerShow, and the dialog-gone arm of the click handler) keeps the block for a
  running answer instead of taking it away, so the two halves of #7852 agree.
- Tests run loadLeftover and deleteNoAnswerShow on a stubbed DOM (state, not text): each red on its mutant (the
  missing return, the poll re-read, the running arm).

## Review round 2
- The flag is the agent's name (DEL_RUNNING_FOR), so a switch to another agent hides the first one's running block
  before the new agent's answer comes, and the poll asks only for the agent whose delete runs.
- One paint (paintLeftoverRunning) for every path: loadLeftover, the no-answer dialog and the dialog-gone arm; it
  clears the plan and hides the button at once (the no-answer paths had left the button live until the next poll).
- An unreadable answer while the block shows running changes nothing; the next poll asks again.
- Tests: the unreadable answer, the switch, and the dialog path's button and plan; each red on its mutant.

## Review round 3
- BLOCKER fixed: a delete that takes the folder and job takes the agent off the list, so the poll no longer reached
  loadRemoval and "running" stayed for good after a successful delete. The poll's no-card arm now asks once more for
  the agent whose block says running; the answer (nothing left) takes the block away.
- paintLeftoverRunning bumps DEL_TOKEN as deleteForgetPlan does (an older read in flight cannot bring the button back),
  and clears DEL_PLAN only when it is this agent's; loadLeftover leaves DEL_PLAN alone while a dialog is open for another
  agent (the poll reads here now).
- Weakest premise now: the no-card poll arm is checked by source text only (the poll function is not run in a test).

## Review round 4
- A running answer takes the agent's plan away whichever page is on screen (a dialog opened from the removed list
  could turn Delete on again by typing the name).
- fetchLeftoverPlan marks a plan it made from the route's 400 or 500 (`failed: true`); while the block says running, a
  failed request changes nothing, as an unreadable one does. #7856's shape test records the mark.
- Still checked by source text only: the poll's two re-read sites (the poll function is not run in a test).

## Review round 5
- The agent page's "Delete its files" opens DEL_PLAN only when it is that agent's (loadLeftover can now leave a removed-
  list dialog's plan in place; the hazard predates the branch, the branch widened it).
- The running sentence gets a full stop only when the board's words lack one; the poll comment is one sentence.
- Left for PigeonPete (on #7852): #7856's no-answer dialog treats a failed re-read (the route's 400 or 500) as the board
  refusing in its words, by design; the `failed` mark now lets it tell the two apart if wanted.
- Known limit: a board that never answers again keeps "running now" on screen (each failed or unreadable read leaves it).
- (Round 1's DEL_SHOWS_RUNNING became DEL_RUNNING_FOR at round 2.)

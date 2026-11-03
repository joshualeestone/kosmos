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
- Polling until the delete ends: the agent page already re-reads the plan as it repaints.

## Weakest premise
That the page re-reads the plan soon enough after the delete ends; until then the block keeps saying it is running.
Windows only (the flag is set where the hold is, which is Windows only).

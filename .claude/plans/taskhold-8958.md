# taskhold-8958: Put on hold and Take off hold on the iPhone's task page (kosmos#8958 slice B2)

## Goal
Slice B2 of kosmos#8958 (plan on the card, comment 7127094136): the board's tk-hold button, natively. Stacked on B1
(taskacts-8958); rebased onto main once B1 merges.

## Change
- TaskPageLogic: taskHoldRequest (POST .../hold {onHold}), the board's words (holdTitle, and the refusal and pre-read
  lines), holdNextLine (the unhold route's `next`, with the board's " To choose who, assign it now." cut: the phone has
  no part picker yet). The hold hints that said "on your computer's board" say "here", as the board's do, now that the
  page takes a hold off.
- TaskPageModel.toggleHold: as the board's click. Putting on hold reads the task first (a screen hold sets exactly what
  it sends and would replace an agent's hold not yet shown) and sends nothing if it is already on hold, gone, or could
  not be read. Taking off posts at once. Then the page and activity are read; an unhold's sentence is said.
- TaskPageView: the button under the hold hint on an open task, 44 pt, off while a press is out (Mark as done too).
- server.ios-routes-6838.test.js: the hold route declared.

## Rejected
- The hold form (Wait for, Until, Why, Save): large, and its "Choose who" needs the part picker. It stays on the board's
  page, through the info button.

## Tests
- run-taskpage.sh: the request and body both ways, the words, the next line with and without the assign ask; the
  model: pre-read then post, already held sends nothing, Take off posts at once and says next, a refusal, a stale press.
- TaskPageActionsUITests checks Put on hold is on the sample's open task.

## Weakest premise
Cutting the assign ask leaves "so it waits for a person." with no way to choose who on the phone; the info button is
that way, unlabelled for it.

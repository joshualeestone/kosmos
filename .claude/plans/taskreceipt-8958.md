# taskreceipt-8958: a closed task's receipt, on the iPhone's task page (kosmos#8958 slice B4)

## Goal
Slice B4 of kosmos#8958: the board's change receipt (tk-receipt, #5153, #6842) natively, under a closed task's activity.
Stacked on B3b (taskreview-8958); rebased onto main once A, B1, B2, B3 and B3b merge.

## Call
- The phone shows all of the board's receipt: put back or handed on, and per agent its files, commands, tokens, cost,
  pull requests, and the not-available and no-activity lines, in the board's words.
- The cost: the receipt route adds `cost: { usd, unpriced }` to each agent it could read, from engine/usageprice.js (the
  engine's price table since #5532), worked out at each request and never kept in the stored receipt, so a price change
  shows at once. A board older than this sends none, and the phone then leaves the cost out.
- Rejected: copying the price table into the app (two copies that drift). Rejected: serving finished words (the web page
  builds its own from its own table, so one computer would hold two copies of one sentence).
- Corrected while planning: my earlier note on the card said nothing outside the web page has the price table. It does.
- Undo (#5153 slice 4) stays on the board: it changes files on the computer, and is off unless Settings' switch is on.
- Weakest premise: the cost words (rounding, "at API prices") are written on the page and on the phone. LogicTests pin
  the phone's against the page's own outputs.

## Change
- engine/usageprice.js modelsCost(models): dollars over the priced models (null when none is) and the sorted ids with no
  published price, as the page's usageApiCost.
- engine/receipt.js withCost(receipt): a copy with each read agent's cost. server.js: the task receipt route sends it.
- TaskPageLogic: TaskPage.receiptKey (the board's key: closed, and the close time, the task's own or its newest part's)
  and closedUnrun; taskReceiptRequest, parseReceipt, and the words (abbreviated tokens, dollars, the JS toFixed rounding).
- TaskPageModel.syncReceipt: run by every read of the task, asked when the key changes; off the tick (a first read of long
  transcripts can take seconds); one read at a time, a superseded one cancelled; only the newest ask draws; a failed read
  is asked again after 30 s. stopReceipt: leaving the page or the app cancels the read in the air, with no failure recorded.
- TaskPageView: the receipt between the activity and the message box; files open and close per agent, and close when
  another receipt is drawn (one read again and found the same keeps them, where the board closes them).
- The request waits 120 s: the Mac answers only once the whole receipt is worked out (a round 1 finding; that a request's
  own timeout overrides the session's 15 s was measured on macOS).

## Left as they are (round 2)
- Values the engine cannot send (a fractional pull request number, a file that is not text, true for a count) are dropped
  or read as numbers where the page prints them. A negative amount is not rounded as the page would.
- A pull request's spoken link is its short name; the board's also says it opens in the browser.

## Tests
- engine/usageprice.test.js, engine/receipt-5153.test.js, server.receipt-5153.test.js; ios/LogicTests/taskpage;
  TaskPageActionsUITests (the receipt of a sample task marked done). Guards mutated red before they are trusted.

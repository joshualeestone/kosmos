# movepolish-6231: account move page polish (#6231 items 1-4)

Card: joshualeestone/kosmos#6231, items 1 to 4 (split by Splinter 09:57: items 5-6 and 9-12 Renet, 7-8 Windows with #6183).
Built on main after #6214 merged as PR #6238. Page only (web/index.html), plus its unit test and browser check.

## Finished looks like
- A Restart Kosmos press refused during an account move titles the toast with the move at every width.
- Once a stop is pressed (from the row or beside a refused restart), the row's Move button shows no count that jumps ahead.
- One put-back agent reads "It stays on ...", two or more keep "They".
- The stop button the Move press inserts has an accessible name and takes focus when focus has not gone elsewhere.

## Steps (all done)
1. Item 1: engineRestartClick computes `moveHeld` once and passes the move sentence to said(), so it is the title at every width and the one announced.
2. Item 2: acctMarkStopping / acctMoveCountShow; the Move button reads "Moving…" while stopping; a refused stop restores the count unless another stop worked (ACCT_STOP_OK). offerStopMove marks the row too, and a row stop answers an open offer through offer.stopped.
3. Item 3: moveAccountAgents rewrites only the stop's own engine sentences to the singular when one agent shares the reason. Page-side on purpose: engine/accountmove.js is on Renet's open branches (movenotes-6231).
4. Item 4: ACCT_STOP_NAME / acctStopLabel ("Stop the move to another account", removed while "Stopping…"); acctStopTakesFocus decides focus.

## Described-by (item 4's question)
The stop button has no aria-describedby. The Move button's describedby points at the restart note (what moving does), which says nothing about stopping, so the stop is left without one.

## Known limits
- A timed-out stop restores the count and the button so the person can try again, though the stop may have landed.
- Clicking plain text after the Move press leaves focus on the page, which is not told apart from no movement.
- A person's own (non-follow-up) repaint drops focus from the list, as for every control in it.

## Tests
- web.account-stopmove-6214.test.js (13 tests; each fix shown red with it removed).
- docs/browser-checks/render-acct-stopmove-6214.js: four #6231 arms, red on origin/main's page, green on the branch, Chromium and WebKit.

# The kosmos#8958 stack: review record (slices A, B1, B2, B3, B3b, B4)

One PR carries all six slices, rebased onto origin/main at 13:25 CST 2026-11-24, because each slice alone conflicted on one shared line of ios/tools/ui-sample.sh and each conflict costs a macOS CI run. That line is now left alone: the classes added here sit on their own lines.

Reviews, each slice by fresh blind agents before it was stacked: A 9 rounds and B1 8 (records in unsentdraft-8958-pre-challenge.md and taskacts-8958-pre-challenge.md), B2 4, B3 8, B3b 8, B4 5 (converged). No BLOCKER is open on any slice. B3 and B3b stopped at the 8-round rule.

Validation, full suite through the machine queue, on each slice as it stood then (before the final rebase): A and B1 (in their records), B3 passed 11:09 CST (hash 654572bdee47), B3b passed 13:13 CST (hash e36555fadef3, with B1, B2 and B3 under it). B4 and the rebased stack: every ios/LogicTests runner, the iOS 16 typecheck and the 411 tests in the root and engine files that name ios/, the receipt or the prices pass; the full suite on the rebased stack is this PR's CI, and a local full run is queued. UI: TaskPageActionsUITests 4 of 4 on the B3b tree (iPhone 16e, iOS 27); the B4 receipt check is first run by the queued local UI run and by CI.

B4 mutations: 27 phone and 5 board guards broken on copies, then 16 more after rounds 3 and 4. Every one turned its tests red after four tests were strengthened.

## B4 ledger

Iteration 1 (opus, 12:18): BLOCKER 0, WARNING 2, CONVENTION 1, NIT 4. All 7 FIXED.
1 W TaskPageLogic taskReceiptRequest 15 s timeout -> 120 s (override of session timeout measured on macOS)
2 W TaskPageView receiptFilesOpen outlives its receipt -> cleared on model.receipt change
3 C TaskPageView:8 header comment false -> fixed
4 NIT sample closedAt moved every read -> kept
5 NIT replaced/unrun at ask time -> read at landing, tested
6 NIT two unguarded: !gone (tested, red), receiptFailed=nil on open (line removed, board keeps it)
7 NIT sample comment -> fixed
Also found by me before round 1 ended: server.ios-routes-6838 did not know the route -> declared.
Iteration 2 (sonnet, 12:21): BLOCKER 0, WARNING 0, CONVENTION 1, NIT 5.
8 C TaskPageView comment false for an identical receipt -> comment and plan FIXED
9 NIT UI test link fallback -> requires a link; spoken short name LEFT (plan)
10-13 NIT malformed or negative values -> LEFT (plan), the engine cannot send them
Iteration 3 (opus, 12:46): BLOCKER 0, WARNING 1, CONVENTION 0, NIT 3. All FIXED.
14 W receipt request never cancelled -> superseded, put-back, leaving the page or app cancel it (tested)
15 NIT synced only from tick/press/refresh -> every read syncs
16 NIT a read the phone cut short held back 30 s -> stopReceipt records no failure
17 NIT quiet open tick redraw unpinned -> tested
Iteration 4 (sonnet, 13:00): BLOCKER 0, WARNING 1, CONVENTION 0, NIT 3.
18 W syncReceipt asked with the page not in front -> gated on shouldReadTask, tested (3 mutations red)
19 NIT fractional tokens under 1000 LEFT (plan) 20 NIT agent name not a heading, lines not one element LEFT (the board's is neither) 21 NIT UI link assertion unrun -> the queued UI run answers it
Iteration 5 (opus, 13:11): BLOCKER 0, WARNING 0, CONVENTION 0, NIT 1. CONVERGED.
22 NIT words test read the machine's locale -> en-US pinned, passes under de_DE

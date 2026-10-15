# movetests-6231: #6231 items 5 and 6, the stop-the-move offers and route proved by behaviour

## Stacking
Built on origin/stopmove-6214 (#6214, Sonya Blade, in review, no PR yet): the code under test exists only there.
This branch adds two NEW test files and edits nothing of #6214's, so each of its review rounds rebases under it
without conflict. The PR opens once #6214 merges. Said on #6231 (10:00 CDT).

## Item 5: web.movestop-offers-6231.test.js
Runs the shipped page code, not its spelling: `worldswSwitch` (as web.world-switch-agents-1704.test.js runs it) and
the Update dialog's `uc-go` click listener (lifted whole, clicked), each answered 409 with `moveStoppable: true`, and
asserts `offerStopMove` is called on the line that says the refusal. Controls: a 409 without moveStoppable, a 500,
and the already-current answer offer nothing.

## Item 6: server.movestop-6231.test.js
Boots the real board in a sandbox and drives its routes. The engine's busy / stop / boardBusyBecause are set per test
(the move itself is engine/accountmove-stop-6214.test.js's), so what is proved is the board's wiring:
- POST /api/agents/account-moves/stop answers the real engine's 409 when no move runs, and passes the engine's status
  and body through when it does;
- Update, Roll back and a Kosmos switch refused while a move runs say `moveStoppable: true`, and do not without one.
  Update and Roll back refuse earlier for their own reasons (nothing published, nothing kept, a platform refusal), so
  those are set aside by patching engine/update's available / selfInstallRefusal / rollbackOffer for the test.

## Decided
- Restart Kosmos (/api/engine/restart) is not driven here: it answers "already current" before the move check unless
  the board's code is stale on disk, which a test cannot arrange without rewriting a loaded file. Its offer stays
  pinned by #6214's browser check and source match.
- Rejected: matching more source text (the card asks for behaviour).

## Measured
- Both files pass (4/4 each). Mutations: removing the page's two offerStopMove calls reds item 5's two positive tests
  (controls stay green); removing `...moveStoppableNote()` from server.js reds the Update/Roll back and switch tests;
  a stop route that ignores the engine's answer reds both stop tests.

## Weakest premise
That patching the engine module's exports reaches the board: true while server.js calls `accountmove.busy()` and
`updates.available()` through the module object, as it does today; a destructured import would make these tests
measure the real engine instead (the positive arms would then fail, not pass silently).

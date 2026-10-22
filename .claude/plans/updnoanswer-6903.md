# updnoanswer-6903: the Update dialog says what happened when a press is not started

Card: kosmos#6903 (Josh, 2026-10-22 10:46 CDT: the dialog showed only "we could not start the update").

## Cause, as far as the logs here reach
- Josh's mini is unreachable (ssh timed out), so his board log for 10:46 is not covered by any instrument we hold.
- The bare sentence had three sources the screen could not tell apart:
  1. no answer at all (fetch threw): the board was paused or restarting, most likely for an automatic update of
     0.7.63, which began serving on staging at 10:43;
  2. a throw inside `/api/update` (or `/api/update/rollback`): no catch in the route and no process-level
     unhandledRejection handler, so the board died and the press got no answer;
  3. the route's own 500 from `beginInstall()`, which used the very same words and logged nothing.

## Decided
- Wrap both update routes in try/catch. A throw answers 500 with "Kosmos could not start the update just now. Try
  again in a minute." (roll back likewise), logs `FAIL update press: <cause>`, and the board keeps serving.
- Log every non-200 answer to a press with the sentence the person saw, so the next report needs nobody asked.
- The page names the two cases with no sentence from the route: no answer ("Kosmos did not answer, so this page cannot
  tell whether the update started ... Wait a minute, then reload this page.") and an answer without a reason ("... it
  answered <status> with no reason. Try again in a minute."). The route's own sentence still wins. The dialog is never
  stranded: Update stays pressable.

## Review round 1
- The no-answer sentence claimed the update "did not start", which the page cannot know (an install can start and
  then stop the board before the answer leaves). It now says the page cannot tell.
- In Roll back mode it said "install this update"; the Roll back sentence has no install clause, and the browser
  check now drives Roll back too, through the page's own setUpdConfirmMode.
- A throw AFTER the installer started (reading its start stamp) would have answered 500 "could not start" for an
  install that was running. startedStamp() logs it and answers 200 without the stamp. Test arm plus mutant (an
  unguarded read): red.
- The throw log names the kind of press; the sentences are one constant per kind (UPDATE_PRESS_FAILED).
- Not changed: the test cannot itself see the pre-fix failure (an unhandledRejection the runner turns red); the
  mutant run recorded above is the evidence.

## Review round 2
- The already-installing branch of both routes still read the stamp unguarded, so a throw there refused an install
  that was running. Both now use startedStamp(). Test arm (a second press joins the running install, 200, already,
  no second installer) plus mutant (the old read in the Update route): red.
- Not changed: `detail` (a raw error message) reaches the board log on a 500. That is the point of the log; the
  dialog never shows it.

## Review round 3 (NITs only; fixed, so one more round follows)
- The browser check proves both stubs catch a POST before any click, so a press can never reach the real route on
  this installed-layout board and start an install. The retired-leg comment no longer says Update is never pressed.
- The page comment said "often" for a cause that was never measured; it says "perhaps".
- The installer failing to start (cause 3, the 500 that logged nothing) now has a test arm pinning its log line.
- Left as it was in round 3, reversed in round 4 (below): a generic throw's raw message went back as `detail`.

## Review round 4
- A generic throw's raw message (which can carry paths) no longer goes back in the 500 body; it is in the log line
  only. Test asserts the answer carries no `detail`. The beginInstall 500 keeps its `detail`, as it had before this
  change.
- Not changed: every stale 409 ("no update to install") is now logged. That is the record the card asked for.
- Not changed: the stub proof sends a POST that the stub aborts. The stubs are registered before it, and a GET would
  not prove a POST is caught (the stub passes non-POSTs through).

## Review round 5
- beginInstall set its single-flight flag before anything that can throw, and only the platform refusal released it.
  A synchronous throw after it (a spawn, the wiring, an injected runner) left every later press answered "already
  updating" for an install that was not running, and the new sentence invites exactly that retry. beginInstall now
  wraps beginInstallOnce and releases the flag on any throw it caused. Test: the real engine with a throwing runner
  answers 500 and alreadyInstalling() is false after it.
- Two source pins read the old `sendJson(res, 409, ...)` spelling inside these routes: update-pause-6620.test.js
  (the pause refusal) and accountmove-6173.test.js (the move refusal in both routes). Re-pinned to `say(409, ...)`.
  My focused runs missed them; the full node suite runs before this branch is pushed.
- The outer catch re-throws the live-execution gate's test-process throw (isGateThrowInTest), as the board's other
  catches do, so a gate hit in these routes stays loud in a test.
- Not changed (NITs): a Roll back stamp-throw arm (the Update arms pin the shared helper); a 401 or 403 answered with
  no reason (the auth layer answers with an error sentence); the beginInstall 500 keeps its `detail`.

## Rejected
- A process-level unhandledRejection handler for the whole board: much wider than this card, and it would change how
  every other route fails. Out of scope; the two routes that start installs are guarded where they are.
- Showing `detail` (the raw error) in the dialog: it can carry paths and means nothing to the person. It is logged.
- An automatic reload offer on no answer: a reload while the board is down shows a browser error page, which is worse.

## Weakest premise
- That Josh's case was a no-answer during an automatic install. Not measured on his machine. The fix covers all three
  sources either way, and the logging makes the next one diagnosable.

## Tests
- server.test.js `#6903:` a throw in either route answers 500 with the sentence, logs the cause, the board still serves
  /api/status; a refusal is logged with its reason; a good press logs none. Mutant (old route): press never answered,
  unhandledRejection: red.
- docs/browser-checks/render-update-toast.js: presses Update against a stubbed route (abort, 502 with no body, and the
  route's own 500 as control); reads the words and checks the dialog is not stranded. Mutant (old page): red,
  "no answer said: we could not start the update".
- Full node suite (tools/run-tests.sh) on b04fbad56e: 23284 tests, 1 fail, the third source pin on the same rename:
  accountmove-stop-6214.test.js counts the four move refusals by their `sendJson(res, 409` spelling. The regex now
  takes either spelling and still requires four; the file passes 20/20.

## Review round 6
- Round 5's release fired on ANY throw, including one after an installer had launched (the child's wiring), which
  would let a second press start a second installer racing the first; and it left the attempt record open
  (endedAt null), so the page could read an install as running. Now a module flag `installLaunched` is set the moment
  something is launched (the injected runner returns, the /bin/sh spawn returns, or the win32 path is entered, where
  launch is not visible here). The flag is released, and the attempt ended with "Kosmos could not start the
  installer", only when nothing launched. Tests: a runner that throws ends the attempt; a runner whose wiring throws
  keeps the flag. Mutant (the runner's launch mark removed): red.
- Correction to round 5's note: the gate re-throw covers throws from the route's other statements. The inner
  beginInstall catch still answers 500 for a gate throw from inside beginInstall, as it did before this branch.

## Review round 7
- The release path set no automatic-install backoff, so an automatic start that threw would be retried on every look
  (the stranded flag used to block that). It now sets autoFailedAt for an automatic start, as every other failure
  path does. Test: an automatic start that throws is not retried by the next look. Mutant (the backoff removed): red.
- The launched-then-threw arm wrote an in-flight marker under the shared /tmp/fake-kosmos-home, which later readers
  would seed as an interrupted install. It now uses its own temp root, removed in finally (and the marker it left
  was removed).
- win32: a synchronous throw from beginWindowsInstall happens before any launch (the helper starts inside its
  promise chain, read in the source), so the flag is released then; installLaunched is set once it returns.
- noteAttemptEnd inside the release is guarded, so a second throw cannot replace the first.
- The beginInstall and beginRollback 500s no longer carry `detail` either: the cause is logged as `FAIL ... press:`.
- Comments corrected: the logging helper logs refusals (non-200) and throws; the stub proof finds a miss on its one
  probe rather than preventing it.
- Known, not changed: a throw AFTER an installer launched answers 500 "could not start", while an install runs; a
  retry then joins it (200, already). Rare (the wiring), and the honest outcome of keeping the flag.

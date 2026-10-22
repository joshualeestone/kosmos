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

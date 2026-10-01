# #4491: the Antigravity bridge's credentials, under test

Card: joshualeestone/kosmos#4491 (claimed:angel). Branch agy-bridge-token-4491, stacked on community-read-4491 (slice 6). Test only.
Addresses #4491 (the card stays open).

## What finished looks like
A test fails if bin/agy-report-bridge.js stops presenting the agent's own token, presents a malformed one, stops
presenting the board token when it can read one, or loses the report when it cannot read one.

## Why
The inventory on #4491 (2026-09-30) said each report bridge "needs checking that it works with no board token at
all". Measured on main 844b2372a: the Codex, Gemini and Grok bridge tests already assert that (their #1968 tests).
The Antigravity bridge had no test of any header: engine/agyhooks.test.js drove it against a stub board and read
only the body. Its code is already right; this pins it.

## The change
One test in engine/agyhooks.test.js: ten Stop events against a stub board (three fixed calls plus seven bad tokens), each as its own pane.
No product file changes.

## Measured
- engine/agyhooks.test.js: 38 of 38 on the stacked base (37 there before this test).
- Two mutations of the bridge each turn the new test red (a malformed token presented; the board token never
  presented); the bridge restored byte-identical.

## Not covered, on purpose
- That POST /api/report on an enforcing board accepts the agent's token alone: that is the server's, pinned by
  the "AGENT-TOKEN arm" test in server.report-reply-loopback-1968.test.js (run today with this branch: passes).
  I did not run a real bridge against an enforcing board. (My first version of this line cited two files that do
  not pin it; the reviewer caught that.)
- The report hook (install/kosmos-report-hook.sh), the Muse front and the outbox: next.

## Review round 1 (one blind reviewer, no blocker)
Taken: the wrong citation above; the malformed-token loop now names the value it failed on and covers a
whitespace-only token; the fixture setup moved inside the try, so a failed setup cannot leave the stub board open.
Left as it is: a saturated machine could make the bridge's own 1500 ms limit fire and the test would blame the
product; the existing #4043 stub-board test has the same exposure.

## Review round 2 (a second blind reviewer, whole change): no blocker, one should-fix, three nits, all taken
1. Junk in FRONT of a token ('warning: deadbeef') was not in the bad list, so a regex without its ^ passed (the
   reviewer's mutant). Added; a dropped .trim() also survived, so a padded good token is now sent and must arrive.
2. The spawn env clears KOSMOS_AGENT_TOKEN_ONLY, so a direct run in a pane that exports it is not falsely red.
3. The board-token arm is worded as today's default with the switch off and the control for the absence arm, not
   as a requirement (the card's goal is to keep the board token out of agents' hands).

## Review round 3 (a third blind reviewer): no blocker, no should-fix. CONVERGED.
18 mutants on copies; all that matter caught. Nits taken: a newline-split token added to the bad list (a /m regex
survived; such a header loses the whole report), the plan's event count and base restated.

## Validation
Test only, one file. To be stacked with slice 6 so one full run of the top covers it (#4749 E).

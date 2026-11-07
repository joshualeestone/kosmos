# kosmos#8191: the slow-request log line breaks tests that parse a board child's stdout as JSON

## Call
tools/run-tests.sh exports KOSMOS_SLOW_REQUEST_MS=86400000 (one day), beside the other test-only exports.
Every board a test boots inherits it, so no "[slow request]" line is written in a test run.

## Rejected
- Setting the variable in each helper's child env: 14 files by one name pattern (`JSON.parse(out)`), 15+ by a wider
  one, and any new test copies a helper without it. The runner covers the whole class, named or not.
- Parsing only the last line in each helper: the same 14+ edits, and it hides any other stdout noise rather than
  stopping the one we know.
- Moving the log off stdout: changes what board.log records for real users (#6721's purpose).

## Weakest premise
A file run by hand with `node --test <file>` does not get the export, so it can still flake on a loaded Mac. The
flake is load-driven and the suite and CI both go through run-tests.sh; I judged that enough.

## Guard
server.slowrequest-runner-8191.test.js: (1) the runner's export exists and is at least an hour; (2) control: a 10 ms
limit puts the line in front of the JSON and the parse throws; (3) under the runner's limit, a request slower than the
5 s default (5.3 s) leaves stdout as JSON. Mutants: export deleted -> (1) and (3) fail; server.js reading a different
name -> (2) fails; runner limit 4000 -> (3) fails on its own. The child has a 60 s timeout so a hang is a fast red.
(3) also asserts the answer came 5 s or more after the request started and was the route's 400 for an empty body (no
account code runs). (4) under tools/run-tests.sh, the test process's own env holds the runner's value (skipped by
hand). Measured under the runner: 4/4; with an `unset KOSMOS_SLOW_REQUEST_MS` after the export, (4) fails.
Trade, stated: no "[slow request]" line appears in any test or CI board log now, so a slow request during a suite
run no longer shows there.
server.slowrequest-6721.test.js sets its own limit before loading server.js, so it is unaffected (ran green).

## Tests run
- new file + 6721 + forget-claude-1659 + forget-openai-1372 + 10 meta tests: 186/186.
- all 14 `JSON.parse(out)` server tests with the export: 144/144.
- bash -n tools/run-tests.sh; tools/test-run-tests-codexhome-2858.sh: ok.

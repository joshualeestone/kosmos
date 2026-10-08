# agyseedflake-5560: the #4417 launch-report test flakes on loaded CI runners (#5560)

`engine/agyseed-4417.test.js` 'the launch event reports idle from the new pane' failed on GitHub-hosted node runs
(main itself at 5cbb3f670, run 37719913706, and two other PRs), always as the only failure; it passes alone.

## What the failing run shows (measured, job 113127146383)
- `assert.equal(r.code, 0)` failed with `null !== 0` after 56 ms. Code null means the child never exited with a code:
  a SIGNAL ended it (review 1 measured on node 26: a refused start gives an
  `error` and a negative code instead). It is NOT the bridge's 1.5 s request timeout (that path exits 0).
- The same run logged `EAGAIN` from another test (`Kosmos board restart could not start: EAGAIN`): the runner was at its
  process limit.
- The helper listened only to `close(code)`, so it could not tell "never ran" from "ran and failed", and it threw away
  stderr.

## Change (test only; the bridge is unchanged)
- `runOnce` records the exit code, the signal, a spawn error and stderr.
- `runBridge` tries again, up to three times with a short wait, only when the RUNNER ended the try (as the code
  stands after review 9): a resource-shortage spawn error (EAGAIN, EMFILE, ENFILE, ENOMEM), an outside SIGKILL or
  SIGTERM, or Node's runtime aborting (a thread-create failure, V8's `Check failed:`, or libuv's `uv__close`
  assertion). A bridge exit code, a bridge crash, ENOENT/EACCES and a hang fail at once.
- The assertion message prints how each try ended.

## Decided
- Retry in the test rather than lengthen anything in the bridge: the bridge's timeout and behaviour are right; the
  runner killing or refusing a child is not the bridge's failure.
- Weakest premise: a child killed AFTER its request reached the stand-in board would, on retry, send a second report,
  and the test asserts exactly one. The failing run died at 56 ms, before a request could plausibly finish; if this
  shape ever shows, the message now says so.

## Tests
- Simulated a killed first try: with the retry the test passes; with the retry removed it fails and names the signal.

## Review 1 (blind, opus)
- FIXED: the report-count message tells "nothing" from "two or more" and prints how each try ended; a retry that
  rescued the run is printed as a test diagnostic, so how often the runner kills a child can be counted; a try that
  never closes is ended after 10 s and reported as a hang (not retried, review 2); the comment
  and this plan say a null code is a signal, not a refused start.
- FIXED: the retry decision has a committed unit test with an injected runner (a killed or refused child is retried,
  one that exited 1 never is, at most three tries); widening it to "any non-zero" reddens it.

## Review 2 (blind, sonnet)
- FIXED: only a try the RUNNER ended is retried (a spawn error, or SIGKILL/SIGTERM); a crash of the bridge's own
  (SIGABRT, SIGSEGV) or a hang past 10 s fails at once (unit test; "retry any null" mutation reddens). No wait after the
  last try; one comment for the rule.
- DUPLICATE: a try killed after its report reached the board gives a second report; the message says so.

## Review 3 (blind, opus)
- FIXED: a SIGABRT whose stderr shows Node's own startup failing for lack of threads or processes (uv_thread_create,
  pthread_create, a CHECK, EAGAIN) is the runner's and is retried; any other SIGABRT is the bridge's and fails. This is
  the likeliest cause of the 56 ms death, which the old helper never recorded.
- STATED: the retry set is a reasoned guess; what this PR surely adds is the signal and stderr in the failure message,
  so the next red names its cause. Stale "never ran" wording fixed; the unit test no longer sleeps.

## Review 4 (blind, sonnet)
- FIXED: a spawn error is the runner's only when it is a resource shortage (EAGAIN, EMFILE, ENFILE, ENOMEM); ENOENT or
  EACCES fails at once (unit test; mutation reddens).
- KEPT: the real runOnce is exercised by the main test's normal path; its signal and hang branches are decided by the
  unit-tested neverRan; a close after the 10 s timer re-resolves a settled promise, which is a no-op.

## Review 5
- runOnce attaches its error listener first and guards stdout/stderr: a spawn refused before stdio exists (EMFILE,
  ENFILE) ends at once on its error instead of throwing on `child.stdout`. Pinned by a fake child with no stdio.
- STARTUP_ABORT matches only Node's own startup lines (uv_thread_create, pthread_create, `Check failed:`), never a bare
  EAGAIN. Pinned by a bridge SIGABRT whose stderr mentions EAGAIN, which is not retried.
- Accepted residual: a retry that rescues the run is only a t.diagnostic line. An intermittent outside kill caused by
  the bridge itself (an OOM kill) could pass green once; a deterministic one still fails all three tries.

## Review 6
- The main test counts only the LAST try's reports (the stand-in board's list is cleared before each try), so a try
  killed after its report landed no longer fails the retry as a double report. NOT pinned by a mutation: it acts only
  on a real outside kill, which this test cannot stage. The count of 1 still catches a bridge that reports twice in one run.
- neverRan renamed endedByRunner (it also covers a child killed after it started).
- Declined: dropping "(review N)" labels from comments (the codebase's convention); a real self-killing child for
  runOnce's signal path (accepted residual, as review 5).

## Review 7
- Replaces review 6's list-clearing (racy: the stand-in records a request on its `end`, which can land after the next
  try began). Each try now sends its own hex launch token (abc123 + try number; the bridge sends only a hex token), and
  only the last try's token is counted. A CONTROL asserts no report arrives under a token no try sent; it went red
  once during the change, when a non-hex token was silently dropped by the bridge. Still unpinned by a mutation: it
  acts only on a real outside kill.
- A hang is never retried, even with a spawn error beside it: `endedByRunner` checks for `timeout` first. Pinned; the
  mutation that removes the check reddens it.
- `Check failed:` is V8's fatal line; Node's own startup abort is caught by the thread-create arms. Stated in the comment.

## The CI abort of 2026-10-08, and a retraction (review 9)
This PR's own diagnostics showed the child dying SIGABRT with "Assertion failed: (fd > STDERR_FILENO), function
uv__close, file core.c, line 646". I first blamed the bridge's process.stdin.destroy() and changed the bridge
(3267a4304), writing the cause as fact in a comment, the commit subject and a test title. Review 9 MEASURED otherwise:
on this Mac, same node and macOS as CI, destroy() leaves fd 0 open with stdin ignored, from /dev/null, and a pipe. So
the mechanism was wrong, and the bridge change is reverted (the bridge is unchanged again).
- What is known: a libuv assertion in a 70 ms child at load 25 on 3 cores; never reproduced locally (1,200 runs).
- Decided: retried as Node's runtime aborting (its own arm in STARTUP_ABORT, pinned; removing it reddens), and every try
  still names it. Weakest premise: that this abort is the runtime's under load, not something the bridge provokes; the
  root cause is on #5576 so the retry does not quietly become the fix.

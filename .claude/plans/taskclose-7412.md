# taskclose-7412: `kosmos task close` takes several task numbers (#7412)

## Why
An outside user closed about 380 finished tasks one command at a time (#7412). The board already closes several at
once, but only from the Tasks screen (`POST /api/tasks/close` refuses an agent with 403), so the CLI could not.

## Call
Both CLIs (install/kosmos, tools/windows/kosmos-cli.js) accept `kosmos task close <project> <n> [<n> ...]` and send one
request per task to the board's own single-task close route, the same request a single close sends, with the agent's
own token. So every rule a single close obeys (who may close, the person's repeat or reviewer lock, history lines)
holds unchanged, and no board change is needed.
- Every word after the first number must be a number; anything else (an option, `--replaced-by` with several, a stray
  word) is refused before anything is sent, in the #4889 wording. `013` is 13; a repeated number is closed once.
- At most the board's own limit for several at once (server.js BULK_CLOSE_MAX, 200), refused before anything is sent.
- A refusal of one task does not stop the others; each is said on its own line ("Could not close task N: reason.").
- A refusal for the whole project (401/403 who is asking, 500/503 the board could not check, 404 no such project,
  400 unreadable name, a redirect or 421) is said once and the rest are not sent.
- A close Kosmos did not answer stops the run. A failure that sends nothing (Mac curl 1-3, 5-7, 26, 96-99,
  130; Windows refused, not connected, not proven) names that task "Not tried". Any other failure (a timeout, a reset,
  anything after the request may have gone) says "may have closed anyway", in the same words on both CLIs. A redirect
  is not the board (#6464): "did not reach Kosmos", not tried. The rest are named "Not tried" (never "still open": the
  CLI never read them).
- One summary line for what closed ("Closed task N" / "Closed tasks N, M").

Rejected: opening the screen-only bulk route to agents (a permission change to an agent-refused route for a CLI
convenience, with its own review surface); one request carrying every number (the same reason).
Weakest premise: per-task requests are fast enough at the 200 limit (a local board answers each in milliseconds; 200
copies of one number run in the cap test's control).
Not done: Ctrl+C mid-run prints no summary of what already closed (accepted; `kosmos task list` shows it).

## Evidence
- cli.task-close-many-7412.test.js, against a real board and the real task engine, both CLIs: several closed in one
  line; one number unchanged (CONTROL); one refused does not stop the rest; a refused first number; repeats and 013;
  every bad word refused before anything closes; --replaced-by with one number unchanged (CONTROL); usage; same refusal
  words on both CLIs; an unanswered close (a proxy that drops the connection) at the first and a later number, with the
  two CLIs' words compared; a refused connection (a proxy that stops listening) named not tried; an agent not on the
  project told once; no such project told once; the board limit and its CONTROL at exactly the limit; a redirect and a
  timeout, each with the two CLIs' words compared; a 503 that stops the run; an answer the CLI cannot read (not said as
  refused).
- Focused set (cli.task-close-many-7412, cli.unknown-flag-4889, tools.windows-kosmos-cli-unknown-flag-4889,
  cli.task-replaced-6923, cli.agent-token-verbs-4491, tools.windows-kosmos-cli-{writes,token-only}-4491,
  tools.windows-kosmos-cli-570): 325/325 after the rebase onto main (855757815f).
- Mutants, each confirmed applied before the run, each turned exactly one test red: curl 7 named as may-have-closed;
  the Windows project-wide stop removed; the Mac limit raised to 1000; the Windows reset wording put back to
  "is it running?"; the Mac 404 project stop removed; the Windows redirect sentence removed; the Windows timeout sent
  to "too busy"; Mac curl 28 named not tried; 503 removed from the Mac and from the Windows stop list.

## Review
- Round 1: one refusal wording on both CLIs for an option-shaped word; 013 is 13; an unanswered first close is one
  failure among several. Fixed.
- Round 2: an unanswered close must be said as a single close says it (it may have closed), and the rest not sent. Fixed.
- Round 3: both CLIs say it; the test asserts it and covers an unanswered first number. Fixed.
- Round 4: no blocker. W: "may have closed" contradicted a refused connection's "nothing was sent"; W: N copies of one
  project-wide refusal; W: no cap. Nits: one line per refused task. All fixed, with tests and mutants.
- Round 5: no blocker. W: "still open" claimed a state never read (now "Not tried"); W: a reset read "is it running?"
  on Windows only (now the Mac's words, compared in the test). Nits taken: a redirect, 421 or 500 stops the run; no
  doubled period; a no-such-project test. Left: Ctrl+C summary (above).
- Round 6: no blocker. W: a redirect read differently on each CLI and Windows said both "check before doing it again"
  and "Not tried" (now one meaning, did not reach Kosmos); W: the Mac named unknown curl failures not tried while
  Windows said may have closed (now an explicit sends-nothing list, everything else may have closed); W: a timeout read
  "too busy" on Windows (now the Mac's words). Each with a parity test and a mutant. Also found: a Mac redirect exited 0.
- Round 7: no blocker. W: curl 5, 26, 27, 43, 99 send nothing and are now on the not-tried list. W: a refused
  connection reads "Is it running?" on Windows: that is ctx.unreachable for every Windows verb, already card #6970;
  noted there, not special-cased here. Nits taken: an empty board reason, a test title. Left: a reset is worded as
  "did not answer in time" (say_unreached's existing write words); exit 1 rather than Windows' maybe() 3 for a
  may-have-closed (a repeated close is harmless).
- Round 8: CONVERGED, no blocker or warning. Nits taken: an unreadable answer is no longer said as "Could not close"
  (the CLI cannot know); curl 27 and 43 can come after sending, so they say may-have-closed; a 503 stand-in-board test
  on both CLIs (mutants: 503 off either stop list, that test red). Loop ends here (8-round cap).

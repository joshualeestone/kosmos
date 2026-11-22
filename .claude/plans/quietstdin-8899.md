# quietstdin-8899: Mac feedback write and note stop on a quiet pipe (kosmos#8899)

## Measured
install/kosmos read the body for `feedback write` and `feedback note` with no words by a bare `$(cat)`, so an open
pipe nobody writes to waited for ever. The Windows CLI (readStandardInput, STDIN_QUIET_LIMIT_MS 3000) and the Mac
--unchanged reader (#8844, _u_quiet 3) already stop once the input ends or has been quiet for 3 seconds.

## Decided
One shared helper, _read_stdin_quiet, for both verbs, with the same 3-second limit. A silent pipe is an empty body,
refused by each verb's existing "Nothing to write" / "Nothing to add" sentence. A body that arrived and then stopped
without ending (or failed part way) is refused with the Windows CLI's own sentence for that verb, saving nothing. A body
piped in whole is saved as before, with trailing line breaks dropped as $(cat) did. A terminal is still read to its end
(Windows does not read a console; on the Mac a person typing a report is not a silent pipe, and changing that is not
this card). Windows is unchanged.

## Tests
cli.feedback-quiet-stdin-8899.test.js (real CLI, real engine, throwaway data): for each verb, an open silent pipe ends
inside the limit and saves nothing; a body that stops part way is refused and saves nothing; CONTROL a body piped in
whole is saved. Putting the bare $(cat) back turned 4 of the first 6 red (both controls stayed green). Related set, 11 files:
165 tests, 0 failed.

Weakest premise: that no caller relies on a slow writer pausing more than 3 seconds mid-report. The --body-file path
is the documented way for such a writer, and the refusal says so.

## Round 1 (opus, blind): no blocker, two should-fix, both taken
- The quiet limit was read from the caller's environment (junk or 0 gave a silent wrong answer); it is now fixed at 3.
- Every non-zero node exit read as "stopped arriving"; now 6 is the cut-short sentence and anything else (a read that
  failed part way, or a reader that could not run) is "could not be read", as the --unchanged reader's exit 7.
- Nit taken: only white space then quiet is an empty body, as on Windows (new test).
- Measured by the reviewer: bytes identical to $(cat) (BOM, CRLF, NUL, \xff\xfe, trailing newlines), a 6.67 MB pipe
  whole, set -euo pipefail safe, wording equal to Windows.
- Left: the error path has no test (it cannot be reached through the real CLI without breaking node for every verb);
  a Mac BOM is kept where Windows strips it (unchanged from $(cat)). Out of scope, filed separately: the other bare
  $(cat) reads (community post, comment, edit, endorse, feedback triage --cards -).

## Round 2 (sonnet, whole branch): nothing above nit. Plan count wording corrected (the perturbation was run on the first 6 tests; the round 1 white-space test is a 7th, related set now 166/0).

## Round 3 (opus, whole branch): one should-fix, taken
- Measured: `( sleep 4; echo report ) | kosmos feedback write` was refused with "pipe it in on stdin", the very thing
  done. Windows does the same, but on the Mac the helper now returns 5 when the pipe stayed open and nothing at all
  arrived, and each verb says "nothing arrived on stdin for 3 seconds" and points to --body-file. A pipe that ENDS
  empty keeps the plain empty-body refusal (new CONTROL, which also checks it does not wait for the limit).
- The helper's 5, 6 and 7 are internal; the verb exits 2 for each.
- Weakest premise, widened: a report from a command slower than 3 seconds to start, or with a pause over 3 seconds,
  is refused with a pointer to --body-file rather than saved. That is the Windows behaviour, said more plainly.

## Round 4 (sonnet, whole branch): nothing above nit. Converged.

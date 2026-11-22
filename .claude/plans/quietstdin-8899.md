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
whole is saved. Putting the bare $(cat) back turns 4 of 6 red (both controls stay green). Related set, 11 files:
165 tests, 0 failed.

Weakest premise: that no caller relies on a slow writer pausing more than 3 seconds mid-report. The --body-file path
is the documented way for such a writer, and the refusal says so.

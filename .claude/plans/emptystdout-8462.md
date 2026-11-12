# emptystdout-8462: "no report yet" from kosmos feedback show goes to stdout

Card: kosmos#8462 (from the 11-12 daily feedback, a Windows seat; given to Mona Lisa by Splinter 10:40).

## Finished looks like
`kosmos feedback show <date>` with no report for that day prints its sentence on stdout and exits 0, on both CLIs (install/kosmos and tools/windows/kosmos-cli.js), so PowerShell does not show an ordinary answer as a red error record. A test asserts it and fails on the current code.

## Shape (decided)
- Both CLIs print `fb.noReportWords(date)` on stdout, not stderr, still exit 0. The help line in each now says "a sentence saying so on stdout, exit 0" (the two stay word for word the same).
- This reverses part of #8260, which put the sentence on stderr so "stdout carried nothing a caller would read as a report". Measured: nothing in the repo parses this command's stdout. Its callers are agents, told by engine/feedbacknudge.js and engine/roles.js to "check with kosmos feedback show", and they read the sentence.
- Rejected: a distinct non-zero exit code (a shell and PowerShell read non-zero as failure, which #8260 fixed). Rejected: only the Windows CLI (the two CLIs would disagree).
- Weakest premise: no script outside this repo uses "empty stdout" to mean "no report". If one does, it now reads the sentence as the report.

## The card's sibling check
Every place either CLI writes to stderr and then exits 0 (a three-line window scan of both files):
- `kosmos feedback show` with no report: fixed here.
- `kosmos room --unanswered` on an older board (kosmos-cli.js, and install/kosmos's twin): a warning that the room shown above is the whole room. Kept on stderr: it is a warning about the output, not an empty answer.
- `kosmos feedback list`'s note on whose reports these are (#8340): kept on stderr on purpose, so stdout stays a plain list of dates for scripts.
Every other "Nothing was ..." / "No ... " line on stderr is a refusal with a non-zero exit, which is right.

## Tests
- cli.feedback-2037.test.js: the sentence on stdout, exactly, and nothing on stderr; the leap-day control on stdout too. Red on main (3 tests).
- tools.windows-kosmos-cli-verbs.test.js and tools.windows-kosmos-cli-570.test.js: the Windows CLI the same. Red on main.
- All 157 cli.* and tools.windows-* files pass (1704 pass, 0 fail, 39 skipped).

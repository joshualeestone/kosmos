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
Every stderr write in both CLIs (`>&2`, `console.error`, `process.stderr.write`, `ctx.err`) was read, not only the ones near an exit 0:
- `kosmos feedback show` with no report: fixed (stdout).
- `kosmos feedback list` (review 1): its kosmos#8340 note on whose reports these are went to stderr on every successful list, and agents are told (engine/feedbacknudge.js) to read it, so under PowerShell it was the same red record. Now all on stdout: the dates, one a line, then a blank line and the note, so a reader taking the dates stops at the blank line. With no report at all, it says so (`fb.noReportsWords()`, shared by both CLIs) instead of printing nothing. Nothing in the repo parses `feedback list` stdout (checked).
- Kept on stderr, as warnings or progress about an answer, not answers: `kosmos room --unanswered` on an older board, the token-refused hint, the "not the installed kosmos" warning, retry and busy lines, and the triage notes. Every "Nothing was ..." / "No ..." line elsewhere is a refusal with a non-zero exit.

## Tests
- cli.feedback-2037.test.js: the sentence on stdout, exactly, and nothing on stderr; the leap-day control on stdout too. Red on main (3 tests).
- tools.windows-kosmos-cli-verbs.test.js and tools.windows-kosmos-cli-570.test.js: the Windows CLI the same. Red on main.
- cli.feedback-2037.test.js also pins feedback list: the dates, a blank line, then the note, all on stdout, and the none-yet sentence; red on main.
- All cli.*, tools.windows-* and engine/feedback* files pass (1940 pass, 0 fail, 39 skipped).

## Review ledger
- R1 opus: 0 B, 1 W (feedback list's note: the same PowerShell red, and agents read it), 1 C (two comments said stderr), NITs (the sweep description; an empty list printed nothing). Fixed.

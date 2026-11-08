# fbnone-8260: "no feedback report yet" is an answer, not an error (kosmos#8260)

## Problem
`kosmos feedback show` (agents are told to check with it before writing today's note) exited 1 when there is simply
no report yet, on both CLIs, so a normal "not yet" read as a failure.

## Change (install/kosmos and tools/windows/kosmos-cli.js, the same on both)
No report for the day: exit 0, nothing on stdout (a caller reading stdout gets no report, never a sentence it could
mistake for one), and "No product-feedback report for <date> yet." on stderr. A malformed date stays exit 2.

## Tests
cli.feedback-2037.test.js, tools.windows-kosmos-cli-verbs.test.js and tools.windows-kosmos-cli-570.test.js pinned exit
1; they now pin exit 0, an empty stdout, and the sentence. cli.unknown-flag-4889.test.js used a non-zero exit to mean
"the refused write saved nothing" (found by the full suite, not by review); it now reads the sentence instead.

## Decided (review round 4)
The sentence stays on stderr on Windows too. Under `2>&1` PowerShell makes it an error record, which a caller with
`$ErrorActionPreference = 'Stop'` would see as terminating despite the exit 0. Kept because the old code wrote the same
line to stderr, so this is not made worse, and because stdout must stay empty for a caller that reads it as the report.
Rejected: the sentence on stdout, as `Nothing recorded on task N yet.` does. Weakest premise: not measured on Windows, no
box here; reasoned from the comment in tools/windows/kosmos.ps1.

The sentence lives in engine/feedback.js (noReportWords) so the two CLIs cannot drift. A report that exists but cannot
be read stays a failure on both CLIs, pinned by a directory at the day's path.

## Not done
The card's Windows/PowerShell side note (assigning a script's output to a variable loses it on a terminating error) is
a PowerShell behaviour, not this verb's; left out on purpose.

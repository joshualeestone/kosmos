# fbnone-8260: "no feedback report yet" is an answer, not an error (kosmos#8260)

## Problem
`kosmos feedback show` (agents are told to check with it before writing today's note) exited 1 when there is simply
no report yet, on both CLIs, so a normal "not yet" read as a failure.

## Change (install/kosmos and tools/windows/kosmos-cli.js, the same on both)
No report for the day: exit 0, nothing on stdout (a caller reading stdout gets no report, never a sentence it could
mistake for one), and "No product-feedback report for <date> yet." on stderr. A malformed date stays exit 2.

## Tests
cli.feedback-2037.test.js, tools.windows-kosmos-cli-verbs.test.js and tools.windows-kosmos-cli-570.test.js pinned exit
1; they now pin exit 0, an empty stdout, and the sentence. 93 tests pass.

## Not done
The card's Windows/PowerShell side note (assigning a script's output to a variable loses it on a terminating error) is
a PowerShell behaviour, not this verb's; left out on purpose.

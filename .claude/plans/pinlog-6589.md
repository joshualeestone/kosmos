# pinlog-6589: an S-7c refusal is recorded on a person's Mac (kosmos#6589 follow-up)

## Problem (found 2026-10-20, while preparing the S-7c real-app check on 0.7.61)
The Mac app's TLS-pin refusal (`tlsPinRefused`) and its "the board did not answer" line wrote only through `logLine`.
`logLine` writes `$KOSMOS_APP_LOG`, else `/tmp/kosmos-app-test/app.log`, and creates no folder. As the code's own #5481
comment says, a person's Mac has no such folder, so on every real install a refusal was recorded NOWHERE: the only trace
was the on-screen alert, which shows at most once a minute per computer. The S-7c plan's "always logged" was false in
production, and no log watch on a real Mac could see a refusal. Measured on Agent1s: the 0.7.61 app sets no
KOSMOS_APP_LOG, and /tmp/kosmos-app-test does not exist.

## Change
- `tlsPinRefused` also calls `logToSystem` (the unified log plus the harness file) with fixed words, one wording per
  reason: "tls-pin: refused a computer: its certificate's key is not the one it vouches for" or "...: its certificate
  could not be checked". No host: #5481 allows only fixed words, states, counts and times in the unified log, and a
  computer's address carries the name a person chose. The harness line with the host stays, so the tests that read it
  are unchanged.
- The "the board did not answer" line does the same, with only the HTTP status (a number) beside the fixed words.
- Read on a Mac with: `log show --last 1d --predicate 'process == "Kosmos"' | grep tls-pin`.

## Test
`native-app.applog-5481.test.js` pins logToSystem's callers. The count goes from 2 to 4, the two new lines are named,
and the caller-content check now also refuses any caller that mentions `host`. Shown red against main's main.swift
(count 2). `native-app.tlspin-6589.test.js` still passes. `swiftc -typecheck` of main.swift: rc 0, no errors.

## Weakest premise
That a refusal reason with no computer named is enough to act on. On a Mac paired with several computers the line
does not say which one, but the alert does, and it is the alert the person sees. A watch only needs to know that a
refusal happened, and when.

## Known effects
- The harness file (tests only) now gets two lines per refusal: the fixed-words one from logToSystem, then the one with
  the host. A count of `tls-pin: refused` in app.log is therefore twice the refusals; in the unified log it is one per
  refusal. The unified log has no once-a-minute limit: N lines there can be one page opening N connections.

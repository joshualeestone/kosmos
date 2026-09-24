# feedguard: make the email pattern linear (kosmos#3608)

## Problem
`engine/feedguard.test.js` "a huge body is held (oversize) and does not hang the
content scan" failed three times on 2026-09-24 on a loaded Mac (2061 to 2600 ms
against a 2000 ms bound), on branches that do not touch feedguard. It read as a
wall-clock flake. A CPU profile of `guard()` on the 5 MB body put 97% of the time
in one regex, the email pattern:

    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/

Unanchored, on a run of local-part characters with no "@", the engine retries
from every position and each attempt scans to the end of the run: quadratic.
On one SCAN_CAP (16384) haystack that is 0.9 to 2 s. `guard()` scans the body and
the serialized object, so the huge-body test paid it twice. The cap bounds it,
so this is a slow post, not a hang, but it is real CPU on every long post and it
is what the flaky test was measuring.

## Change
Anchor the start with a lookbehind so a match can begin only where a run of
local-part characters begins:

    /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/

`test()` results are identical: any match of the old form that starts inside a
run also matches from the start of that run, because the skipped prefix is in the
same character class. Only `test()` is used on PATTERNS, so match position does
not matter.

Every other pattern was timed on adversarial 16 KB inputs (runs of letters,
digits, "a.", "a@", "$1", "1,", mixed): all at or under 1.4 ms. Email was the
only quadratic one (908 ms worst case before, 0.44 ms after).

## Tests
- Linear: the email pattern on four 16384-char no-match inputs completes in
  under 200 ms each. Red (720 ms) with the old regex restored.
- Equivalence: anchored and unanchored agree on fixed cases and on 50000 seeded
  generated strings, with a floor on how many of those match so agreeing on "no"
  everywhere cannot pass. Red when the TLD length is perturbed to {3,}.
- The existing huge-body test is unchanged; it drops from about 290 ms to 40 ms.

## Not changed
- The 2000 ms bound on the huge-body test stays. The cause is gone, so raising
  the bound would only hide a future regression.
- `docs/browser-checks/render-accounts-openai.js` has a similar unanchored email
  regex, but it runs on short page text in a test, not on posts.

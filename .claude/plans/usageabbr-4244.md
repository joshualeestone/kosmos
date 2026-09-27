# usageabbr-4244: Token Usage numbers pick their unit after rounding (kosmos #4244)

Card #4244 (claimed:johnnycage, Liu Kang m1810). `usageAbbr()` in web/index.html (Settings > Token
Usage, 7 call sites, and usageBigTokens below 1B) chose the unit before rounding, so edge values
showed 1000K, 1000.0M and 10.0B.

## Finished looks like
- 999,500-999,999 show 1.0M; 999,950,000-999,999,999 show 1.0B; values that round to 10.0B show 10B.
- Every other value renders exactly as before.
- A unit test on the exact edges, red on main and green here, plus a sweep against the pre-fix
  function proving nothing else changed.

## Decision
Promote only when the display's own rounding reaches the next unit (the same toFixed as the display),
rather than choosing the unit from a rounded value first. The other way would have moved values like
960,000 from "960K" to "1.0M", changing numbers the card says must not change.

## Weakest part
toFixed rounds binary floats, so 9,950,000,000 exactly reads 9.9B (as it did before); the first
value that reads 10B is 9,950,000,001. The test pins both, so the boundary is measured, not assumed.

## State
Built and tested (35/35; the edge test is red on main). Next: review loop, suite, PR, merge on green.

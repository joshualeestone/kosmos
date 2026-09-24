# feedguard: the spelled grouped-currency check in linear time (kosmos#3609)

## Problem
Found by the blind review of #3608. The `financial` pattern
"grouped currency amount (spelled)",

    /\d{1,3}(?:,\d{3})+(?:\.\d+)?\s*(?:USD|EUR|GBP|dollars?|euros?|pounds?)\b/i

is quadratic on a long chain of comma groups with no currency word after it:
from every digit of `9,999,999,...` the engine walks the chain to its end.
Measured: 5.8 ms at 4 KB, 34 ms at 8 KB, 121 ms at 16 KB (the scan cap).
`guard()` scans two haystacks, so one crafted post costs about a quarter second.

A lookbehind anchor, which fixed the email pattern in #3608, does not work here.
`(?<!\d)` still starts at every group after a comma, and `(?<![\d,])` changes
results (`a,123,456 USD` matches today from after the comma).

## Change
The entry becomes a function, `spelledGroupedCurrency`, with the same answers.
It finds each currency word once (the same alternation and `\b`, same `i` flag),
then looks backward:
- skip the whitespace run before the word; the amount must end exactly there,
  because an amount ends in a digit and `\s` never matches a digit;
- a grouped amount ends at f exactly when the five characters before f are
  digit, comma, digit, digit, digit: `D(,DDD)` is the shortest grouped amount
  and every longer one ends the same way, and the start is unanchored so one
  leading digit is always enough;
- or, with a fraction: the digits before the whitespace are the whole fraction
  (they must run to the word), so the '.' is just before that maximal digit run
  and the grouped part must end at the '.'.
Regions looked at before two different currency words cannot overlap, because
a currency word is letters, so the scan is linear.

`\d` without the `u` flag is ASCII 0-9, which the function matches by char code.
`\s` is tested with the same regex class. Every PATTERNS consumer already
handles `fn` entries (contentFindings and the positive-control test).

## Tests
- Linear: five 64 KB inputs (the chain that was quadratic, the chain followed by
  USD, 64 KB of whitespace before USD, 7000 currency words each looked back from
  and rejected, a long fraction-shaped run), each under 200 ms and each with its expected answer.
  Red with the old regex wrapped as the fn: 1395 ms on the chain.
- Equivalence: fixed edge cases plus 50000 structured generated strings (noise,
  a digit-and-separator core, optional fraction, whitespace, a currency-like
  word, a suffix) against a copy of the old regex. Floors: more than 1000 match,
  and more than 200 depend on the fraction arm, so a version without that arm
  cannot pass. The whitespace picks include U+00A0, U+FEFF and U+2028 (and
  fixed cases pin them), so a skip that only knows ASCII space fails. Red with
  the fraction arm removed, and red with the skip reduced to ASCII space.
- The generator: the #3608 test's LCG multiplied as floats; past 2^53 the low
  bits were lost and it cycled after 11,000 to 16,000 values in 50,000 draws.
  Both tests now share `seeded()`, which uses Math.imul, and a test asserts
  50000 distinct values (red with the float multiply back). The #3608 test's
  match count was inflated by repeats (434); without repeats 50000 draws give
  about 200, so it now draws 100000 (about 400) and keeps its floor of 300.

## Not changed
The other three financial patterns were timed on adversarial input in #3608
and are linear (`$`-prefixed forms can only start at the symbol; the
large-amount spelled form has `\b` before a single digit run).

# bcsmfast-5907: the browser-check surface-map test counts every token in one pass (#5907)

Card: joshualeestone/kosmos#5907 (validation queue waits; suites run 30-36 min, not the documented 14-26). Measured
from a queued run on main (comment on the card): the shell stage is 28 min, and `tools/test-browser-check-surface-map.sh`
was its slowest file at 193 s.

## Where the time went
- `split_halves` (the character-by-character awk over the 81k-line page): about 5 s, once.
- `token_web_scan` per declared token: two whole-file `grep -cE` over the code and comment halves, ~0.11 s each, for
  1,071 tokens: about 240 s. Nearly all of the test.

## The change
- `count_plain_tokens`: one awk pass per half counts every PLAIN token (only `[A-Za-z0-9_-]`, the boundary class the
  grep uses) at once. A line splits into maximal runs of that class; a plain token sits between boundaries exactly when
  it is one of those runs, so it is the same match. Each line counts once per token, as `grep -c` counts lines.
- The two halves' counts are joined into one table; `token_counts` looks a plain token up there and falls back to
  `token_web_scan` for any token with another character (so a metacharacter token keeps the grep's escaping).
- The CONTROL arms still call `token_web_scan` directly, so the original matcher stays tested, and a PARITY arm checks
  the one-pass counter against it on the fixture's 11 plain tokens. Mutation: dropping `-` from the counter's class
  reds it, naming each token.

## Proof
- The test's full output (1,083 lines) is byte-identical before and after (`diff` clean).
- Interleaved on the same load: the original 340 s and 205 s, the new one 13 s and 12 s.

## Rejected
- **Rewriting the per-file loop in awk.** It would also remove the per-token lookup process, but changes how PASS/FAIL
  lines are produced; the lookup costs seconds now, not minutes.

## Weakest premise
- That every token in a check's annotation is either plain or rare: a non-plain token still costs two greps. Today none
  is non-plain except the control's `tok.dot`.

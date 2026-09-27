# mask-opening-4112: the guide mask stops withholding replies that name sk-ant-api03- often

Card: #4112.

## Measured (this Mac, Node 26, a probe with N held Anthropic keys and a guide line naming sk-ant-api03- per line)
- main: 200 keys and 20 mentions is WITHHELD (split_search_limit), not only 200 mentions as the card says;
  10 or 50 keys pass. With the budget lifted: 200/20 costs 2.5M units (budget 1.25M), 200/200 26.9M, 3.6 s.
- Where it goes (instrumented copy): the per-run comparison inside each walk. Every mention walks every held key
  whose next character begins some run in reach, and one- or two-letter words ("a", "and") advance a walk, after
  which it compares every variant of every run in reach.

## Change (engine/secretmask.js wordSkippingSpans): output exact, charge never above main's
1. A run's variants are grouped by first character; at position q only the group beginning with f[q] is compared
   and charged (a piece matches at q only if it begins with f[q]).
2. A walk jumps to the next run with a variant beginning with any f[q] for its current positions, through a
   per-character index of run numbers, built only as far forward as walks reach (a reply with no opening builds
   none). Runs passed over were no-ops: reached, best and lastAt do not change on them. The reach bound becomes a
   binary search for the last run in reach (the original break), unchanged in meaning.
- Evidence it is exact: identical output to main on 1,200 randomized split-key replies (358 of 400 masked
  something), and a planted off-by-one in the jump changes 332 of 400. secretmask 90/90, guide-secrets 18/18.
- Result: 200/20 passes (0.23M units, 0.24 s; main 2.4M, withheld); 200/200 is 2.6M units, 2.0 s (main 27.7M,
  3.6 s), still over the budget: withheld.

## Review 1 (opus): WARN fixed
The first version charged each jump (chars + 1), the jump that hits the bound, and each indexed run, so a reply of
runs that all begin with the keys' next character (40 keys sharing sk-ant-api03-X, lines of X0 X1 ... X39) cost 1.3x
to 1.6x main and was WITHHELD where main checked it (fail-closed, not a leak). Now a jump and the index are free
(main built variants uncharged too) and a landed run is charged only for the variants compared, a subset of main's
charge for that run with the same positions: per walk, never above main. Measured: 900 adversarial inputs, 0 above
main, total about 7x lower, identical output. The reviewer's reply is a test that fails on the first version.

## Rejected
- The card's first suggestion, no walk from a bare public head (sk-ant-api03-): the tail after the head is walked
  as its own form only from an opening of 4+ characters, so "sk-ant-api03- Zq8 vLm3p..." (a 3-character first
  chunk) would stop being caught. A security loss for speed.
- Raising the budget to fit 200/200: it is a CPU bound (the comment's 1 to 1.3 s), and 200/200 needs 2 s.
- Memoising walks per opening across mentions: a later mention's walk is not implied by an earlier one's (reach
  is counted from where each walk last moved, and the retry bookkeeping keys on the start).

## Weakest premise
Timings are from a loaded Mac; the unit counts are machine-independent and are what the budget reads.

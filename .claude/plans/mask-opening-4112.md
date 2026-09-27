# mask-opening-4112: the guide mask stops withholding replies that name sk-ant-api03- often

Card: #4112.

## Measured (this Mac, Node 26, a probe with N held Anthropic keys and a guide line naming sk-ant-api03- per line)
- main: 200 keys and 20 mentions is WITHHELD (split_search_limit), not only 200 mentions as the card says;
  10 or 50 keys pass. With the budget lifted: 200/20 costs 2.5M units (budget 1.25M), 200/200 26.9M, 3.6 s.
- Where it goes (instrumented copy): the per-run comparison inside each walk. Every mention walks every held key
  whose next character begins some run in reach, and one- or two-letter words ("a", "and") advance a walk, after
  which it compares every variant of every run in reach.

## Change (engine/secretmask.js wordSkippingSpans): output exact; each step charged at most main's, at least its work
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

## Review 2 (sonnet): BLOCKER fixed
Charging only the compared variants left each step's positions (`at`, which grows with `reached`) free. A key full
of - and _, its head whole and the rest spelled two characters at a time, three times over, ran 2.5 s under a tiny
charge where main exhausted the budget in about 0.3 s (fail-closed became slow, and the reviewer saw it come back
unmasked). Now each step covering runs (s, t], or (s, limit] when nothing in reach can match, is charged
max(at.length, compared variants): at most main's charge for that range (main charged every run in it at.length x
all variants), and at least the step's work (positions built; index lookups are bounded by the alphabet). A range
with no run in reach is not entered at all, as main's loop broke there without charging. Re-measured: 900 inputs,
0 above main (about 3.6x lower), identical output on 1,200 replies; the attack is a test (fails on 86c0620a5, passes
on main and here). Units now: 200 keys, 20 mentions 0.60M (main 2.46M, withheld); 200 mentions 6.5M (main 26.7M).

## Review 3 (opus): WARN fixed, WARN accepted and stated
- FIXED: the index was built from the FIRST walk's start, so a later walk far down a long reply indexed every run
  between (uncharged; 200 KB reply 7.6x main's time). It now indexes from each walk's own start (walks start at a
  non-decreasing r, so skipped runs are never needed). The reach limit is found again only when lastAt moves.
  Measured, same process: 60 KB gap case main 128 ms, previous 174, now 108; 240 KB 389 / 580 / 439.
- ACCEPTED, stated in the budget comment: in text where nearly every run could continue a key, each step costs
  about 2x main's time per unit, so an exhausted search there takes up to about twice the documented bound. Charging
  it would break "never above main's charge" (review 1's regression). Still fails closed.
- Re-verified: identical output 1,600 replies; 900 inputs 0 charged above main; suites 92/92, 18/18.
- No test pins the index start (a timing property); the gap measurement above is the evidence.

## After the rebase onto #4124 (a5907aca4): the accepted 2x was wrong, fixed
#4124 added a separate short-chunk pass (its own SHORT_WALK_BUDGET; it does not call the word walk), and the only
conflict was appended tests. Validation after the rebase then FAILED on #3935's bound test: 1,538ms of CPU against
its 1,500ms guard. Measured: that input exhausts the budget on both main and the branch, and the branch spent about
0.53-0.60 us per unit against main's 0.26-0.28, so the budget bought twice main's work. Review 3's "about 2x per unit,
accepted" was the cause; accepting it was wrong once an existing guard reads CPU.
- Fix: a run landed on is charged at.length x all its variants' cost, exactly main's charge for that run; runs passed
  over stay free; a walk ending at the bound pays at.length. Never above main (landed = main's, skipped = 0), at least
  the work (>= positions and >= compared variants).
- Measured: the bound test's own CPU, 3 runs each, main 537/563/539 ms, branch 667/579/613 (was about 1.7x).
  Units: 900 inputs 0 above main, ratio 0.35; output identical on 1,600; suites 123/123, 18/18. Card (seeded keys):
  20 mentions 0.93M (main 3.17M, withheld) passes; 200 mentions 10.4M (main 34.9M) still withheld.
- A next-run fast path was tried first and did not help (the cost was the charge, not the lookups); it stays because
  it is exact and cheap.

## Review 6 (sonnet): BLOCKER, a real leak, fixed
Review 3's fix indexed from the walk's CURRENT position (`ensureIdx(s, ...)`). Several held forms share one opening and
all walk from the same r; the next-run fast path (added with the charge change) let one walk move far ahead without
indexing, and its next index call then skipped the runs behind it while marking them done. The next form walking from
the same r found nothing in reach: a decoy key made of C's plus a real key split into C-glued pieces came out with all
5 pieces READABLE where main masks them. Review 4's proof covered walks across r, not several walks from one r.
- Fix: index from the walk's OPENING run (`ensureIdx(r, ...)`): contiguous from r+1 for every walk from r; runs below
  r are still never needed (r is non-decreasing), so review 3's gap fix stands.
- Test (#4112 review 6): fails on 534efb054 (pieces readable), passes here and on main.
- New fuzz (scratchpad leak4112/fuzz2.js): shared openings, decoys made of the reply's filler, real keys split into
  filler-glued pieces. Fix: 900 identical to main. Control on 534efb054: 57-59 of 300 differ, 42-46 leak more.
- Re-verified: original fuzz 1,200 identical; charges 0 above main (ratio 0.35); suites 124/124, 18/18; card 20
  mentions checked. #3935 guard CPU now about 1.23x main (807-834 vs 657-678 ms), inside its 1,500 ms bound.

# gated-b8-guard-4464: catch a board-bound check also listed in gated.txt

Card: joshualeestone/kosmos#4464 (filed by Angel from #4457's CI failure). Claimed by Angel, night shift.

## Finished looks like
`tools.browser-checks-wired.test.js` fails, locally and in CI's node suite, whenever a name in
`docs/browser-checks/gated.txt` is also launched anywhere else in `tools/browser-checks.sh`, and
passes on main today.

## Decision
- One new test beside the #3929 gated-list test, reusing the file's own `invokedNames` read: with
  an empty gated list it returns exactly the launches outside the gated loop.
- Strict, no exemption list: on main the overlap is empty (measured: 199 gated, 60 launched
  elsewhere, 0 shared). Rejected an allowlist: nothing needs one, and an allowlist is the
  documented way a guard stops guarding.
- Rejected checking only `b8-board.txt`: the same failure happens for a check on any board.

## Verified
- The test passes on main (11 of 11 in the file).
- Real-world control: adding `render-openai-key-callout-2164` (a $B8 check) to gated.txt, the
  exact #4457 mistake, reds the new test and ONLY the new test (the gap was real).
- In-test controls: the elsewhere read is non-trivial (at least 20 names), and a gated name
  re-launched on $B8 is reported.

## Weakest premise
That every launch outside the gated loop matches `invokedNames`' patterns (a literal `run_one "x"`,
a `for n in ...; do run_one` list, or `node docs/browser-checks/x.js`). A launch through some new
wrapper would be invisible to it, the same limit the file's other tests already carry.

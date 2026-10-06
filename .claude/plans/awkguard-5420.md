# #5420: the kill guard takes over 60 s on Linux for one long line

**Branch:** `awkguard-5420` · **Card:** kosmos#5420 (found by the #4919 Linux lane)

## The defect, measured rather than reasoned

The card guessed mawk. Two probe runs on ubuntu-latest said otherwise:

- Run 37526075658 (the hook under `bash -x`, a timestamp per line): awk is gawk 5.2.1, sed is GNU 4.9,
  grep is GNU 3.11. Total 76 s, and 75.6 s of it was the single call to `_kill_all_reason`. At 1.5 MB the
  input is above the 256 KB line, so awk never runs; the raw JSON goes straight to the greps.
- Run 37528848089 (each pattern of `_kill_all_reason` timed alone and combined, default locale and C):
  the first grep, `shkill|xkill|code|argv` combined, ran over 60 s under `LANG=C.UTF-8`; each of the four
  alone took under 0.1 s, and the combined one took 70 ms under `LC_ALL=C`. Every other grep was under
  0.2 s in either locale.

So the cause is GNU grep's multibyte path on one big alternation over one long line.

## The fix

`LC_ALL=C` on all six greps in `_kill_all_reason`. The hook's two other greps on the raw input already
did this. The patterns are ASCII; bash splits words on ASCII whitespace only, so a byte is the right
unit. The one behaviour change: a Unicode space between `kill` and `-1` no longer matches `[[:space:]]`,
and bash would not run that text as `kill -1` either.

## Decided, not missed

- The 12 s bound in the timing test is not widened (#4919's decision; production times out at 15 s).
- A source pin, not a second timing test: main's CI is Mac-only and BSD grep is fast in either locale,
  so no timing test on main can see a dropped `LC_ALL=C`. The pin counts the greps (six) and requires
  the prefix on each; mutations (one dropped, all dropped) both turn it red.
- Not changed: the awk decode, the 256 KB line, the sed drop. All measured under 0.15 s on Linux.

## Verification

- Mac: report-hook-killguard-4671.test.js 268/268.
- Linux: run 37530775125 on `linux-ci-5420-fix` (the #4919 lane plus only this commit).

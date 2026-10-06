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
did this. The patterns are ASCII. What C changes, in both directions (the first found by blind review 1):

- **Narrower, and fixed here:** in C, `[[:space:]]` is ASCII only, but JavaScript reads U+00A0, U+1680,
  U+2000-200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF as whitespace, so `process.kill(<U+2003>-1, 9)`
  would have passed. The `code` and `argv` arms now use `JW`, `[[:space:]]` plus the UTF-8 bytes of those
  characters (`argv` found by blind review 3: an `execFileSync` or `spawn` argv with such a space passed).
  The test covers twelve of them (every row of the list, plus U+2000, U+2007 and U+2028/2029 inside the
  byte range), with and without jq, and a non-whitespace letter as the control.
- **A side effect, fixed:** with `JW*` matching zero spaces, `NZ` (a signal other than 0) took the first
  byte of a Unicode space as its character and refused a harmless signal 0. `NZ` now never starts with a
  lead byte of a `JW` space (review 3). Tested: signal 0 with such a space before or after it is allowed,
  signal 9 after one is refused.
- **Narrower, accepted:** a Unicode space between a shell `kill` and `-1` no longer matches the shell arms.
  Bash splits words on ASCII whitespace only, so it would not run that text as `kill -1` either.
- **Wider, an improvement:** an invalid UTF-8 byte just before `kill -9 -1` used to defeat the boundary
  class `[^A-Za-z0-9_.-]` (a UTF-8 grep does not match invalid bytes against it); in C it matches, so that
  text is now blocked. Not pinned by a test (it needs a non-UTF-8 payload); recorded here.

## Decided, not missed

- The 12 s bound in the timing test is not widened (#4919's decision; production times out at 15 s).
- A source pin, not a second timing test: main's CI is Mac-only and BSD grep is fast in either locale,
  so no timing test on main can see a dropped `LC_ALL=C`. The pin counts every `grep` token (six) and
  requires the prefix on each; mutations (one dropped, all dropped, a seventh bare grep) all turn it red.
- Not changed: the awk decode, the 256 KB line, the sed drop. All measured under 0.15 s on Linux.

## Verification

- Mac: report-hook-killguard-4671.test.js, every test green (the count is in the proof).
- Linux: run 37530775125 on `linux-ci-5420-fix` (the #4919 lane plus only this commit).

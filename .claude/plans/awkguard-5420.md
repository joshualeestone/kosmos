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

Two changes inside `_kill_all_reason`, and the patterns themselves are main's, unchanged:

1. **The C locale for GNU grep only.** The function asks `grep --version` once; `(GNU grep)` (exactly: BSD
   grep calls itself "GNU compatible") runs the six greps with `LC_ALL=C`, anything else keeps the caller's
   `LC_ALL`. Measured on this Mac, BSD grep is about twice as slow in C (blind review 5: 0.89 s against
   1.56 s at 1.5 MB, worse on non-ASCII text), and C only fixes GNU grep. The hook's two other greps on
   the raw input already ran in C and are untouched.
2. **A fold of JavaScript's wider whitespace, once.** In C, `[[:space:]]` is ASCII only, but JavaScript
   reads U+00A0, U+1680, U+2000-200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF as whitespace,
   so `process.kill(<U+2003>-1, 9)` would have passed under GNU grep. One C-locale `sed` pass turns each of
   them into an ASCII space before any grep runs, so every arm reads them and the list exists once.

**How this design was reached, so nobody rebuilds the earlier ones:** blind reviews 1 to 4 drove a version
that taught each pattern the multi-byte spaces (a `JW` class in the `code` and `argv` arms, and a byte-level
`NZ` so a signal 0 beside such a space stayed allowed). Each review found the next arm or edge it missed (the
`argv` arm, then signal 0, then a lead-byte exclusion that let a copyright sign or katakana pass as a signal).
Review 5 found it also made the Mac guard 2 to 4 times slower and kept the space list in three places. The
fold replaces all of that: `code`, `argv` and `NZ` are main's text again.

**What changes against main:** under GNU grep, a Unicode space between a shell `kill` and `-1` is now read
as a space (the fold), and an invalid UTF-8 byte just before `kill -9 -1` now counts as a boundary (in a
UTF-8 locale grep does not match an invalid byte against `[^A-Za-z0-9_.-]`; in C it does). On a Mac with
BSD grep in a UTF-8 locale, `[[:space:]]` already read most of these spaces, so the fold mostly matters for
U+FEFF there; the invalid-byte change does not apply. The invalid-byte case is not pinned by a test.

**Cost on this Mac** (the hook end to end, jq path): ASCII 1.5 MB 0.47 s on main, 0.58 s here; CJK and
Unicode spaces 4.6 MB 0.91 s on main, 1.10 s here. The difference is the fold.

## Decided, not missed

- The 12 s bound in the timing test is not widened (#4919's decision; production times out at 15 s).
- The flavour probe costs one `grep --version` per guarded call (a few milliseconds). Rejected: caching it
  in a file (a stale cache on a machine whose grep changes would silently pick the slow locale).
- Tests on this Mac: a source pin that every guard grep runs in `LC_ALL="$_lc"`; a fake `grep` first on PATH
  that answers `--version` as GNU or as BSD and records each guard grep's `LC_ALL` (C under GNU, the caller's
  under BSD), with the block decision still real; the Unicode-space tests from earlier rounds (twelve spaces,
  `code` and `argv`, signal 0 allowed beside one, seven non-ASCII signals still blocked), each run also in
  `LC_ALL=C` so this Mac reads them as GNU grep does (in its UTF-8 locale BSD grep already reads 11 of the 12,
  which left the fold unguarded here; review 7). Mutations, each red:
  GNU never picked, C always, the fold removed, a loose `GNU` match that BSD's version line satisfies, and
  the U+00A0 entry alone removed from the fold.
- Not changed: the awk decode, the 256 KB line, the sed drop. All measured under 0.15 s on Linux.

## Verification

- Mac: report-hook-killguard-4671.test.js, every test green (the count is in the proof).
- Linux: the #4919 lane plus only this branch's commits, on `linux-ci-5420-fix`. The first fix passed there
  (run 37530775125: the 1.5 MB test in 1.35 s, failures 118 against the lane's 120 baseline, the drop being
  this test and the probe); the run for the final head is recorded in the proof.

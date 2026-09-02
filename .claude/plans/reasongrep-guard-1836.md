# reasongrep-guard-1836: lift the reason-grep guard onto main + fix the 11 it found

Card: kosmos#1836 (widened in place). Repo: agent-workforce (joshualeestone/kosmos).

## Background

`browser-checks-reason-grep.test.js` was written on the `gate-red-bisect` branch,
which was abandoned (its purpose - unblock the 0.6.21 browser gate - was resolved
by events; findings landed as #1808/#1826/#1835). The guard was preserved on the
pushed branch, but a guard on a dead branch protects nothing. Splinter assigned
the lift.

## What the guard does

Reads the release gate runner's reason-extraction grep out of
`tools/browser-checks.sh` (not a copy - it cannot drift) and asserts that every
finding-emit site in `docs/browser-checks/*.js` prints a line that grep can
quote. The runner grep is `^\s*(FAIL|✖)|Error|Timeout|REFUS|refus`, so a failure
line the gate can name must start (after whitespace) with `FAIL` or `✖`, or carry
Error/Timeout/REFUS. A finding line that does not match reports as
`(no FAIL or error line in its output)` - the gate reds without naming the cause.

## The finding (the guard earned its lift on run 1)

Lifted verbatim onto current main, the guard went RED and named 11 checks
printing unquotable failures - beyond the 2 (#1860) already fixed. The class was
~13 wide; #1860 fixed 2. This is "a blast radius measured from reds is a lower
bound" demonstrated live.

The 11, fixed here with #1860's template (prefix the PRINT site with `  FAIL  ` -
the bytes the grep sees, not the pushed string):
- dash decoration `  - <finding>`: render-busy-line, render-connect-skip,
  render-create-form, render-create-made, render-memory-words, render-role-limit,
  render-role-order, render-special-purpose
- wrong glyph: render-boot-no-flash (`✗` U+2717), render-thread (`✘` U+2718)
- worded prefix (FAIL not at line start): render-fields

All are genuine failure emits (each on an exit-non-zero path). Counters and exit
codes are untouched; the prefix is print-site cosmetic only.

## Decision: the exact-count assertion is an intentional tripwire

`EXPECTED_SITES = 28` is an equality, not a floor. The file argues (and I agree)
that a floor whose slack exceeds the thing it guards is decoration. The equality
goes red the first time anyone adds a legitimate emit site - and that red is the
feature: it forces the new site to be reviewed for quotability and the number
bumped deliberately, rather than a new unquotable emit slipping in under a floor.
Documented at the constant so the next person meets it as an intended tripwire,
not a mystery red.

## Proof

- Guard green on main after the 12 fixes (11 finding-emit sites + render-first-run,
  found on the next review and rewritten to a counted SHAPE-1 site); count holds at
  28, `bad` empty.
- Perturbation, both arms: revert any one fix -> guard reds (bad non-empty);
  add an emit site -> guard reds (count tripwire). Restore -> green.
- `node --check` clean on all 11 changed checks.

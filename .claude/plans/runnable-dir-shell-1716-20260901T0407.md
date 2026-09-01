# Plan: guard the shell installer's executable tests against directories (kosmos#1716)

## Problem

`[ -x "$p" ]` succeeds on a DIRECTORY, so a directory named like a binary reads
as an installed program. The three shipped installer files (`install/kosmos`,
`install/setup.sh`, `install/kosmos-report-hook.sh`) make this decision in ~30
places -- Splinter's corrected count: 27 bare of 29, only 2 already guarded. It
decides real things: is the runtime present (die if not), fresh-install vs
upgrade, whether to tell a person to add a directory to PATH. This is the shell
origin of the class #1592 fixed in JavaScript (`engine/runners.js`'s docblock
cites `setup.sh`'s check_claude_code as where the trap came from). Sibling #1616
is the same class for `fs.existsSync`.

## Approach

Guard every executable test with the same-path form the repo already uses
(`setup.sh:2111/2156`): `[ -f "$p" ] && [ -x "$p" ]`. Audited each site -- all
test paths meant to be runnable BINARIES (node, tmux, kosmos, kosmos-tunnel,
kosmos-app, lsregister), none a legitimate directory-traversal test, so a
directory passing is always a bug.

Forms handled (the class, not one spelling):
- positive `[ -x P ]` -> `[ -f P ] && [ -x P ]`
- negated `[ ! -x P ]` -> `[ ! -f P ] || [ ! -x P ]` (a +x directory reads as
  executable to `[ ! -x ]` too, so De Morgan the positive guard)
- quoted `"$p"` and unquoted `/path`
- nearby `-f` on a DIFFERENT path (kosmos:430, setup.sh:1462, report-hook:93):
  add the same-path -f; the existing one stays
- lsregister run-guards where `-f`/`-u` are command ARGUMENTS, not tests

Precedence preserved in every `|| die` / `|| return 1` / `|| { rm -rf; return 1 }`
/ `|| true` / `|| continue` / if-then context: `A && B || C` = `(A && B) || C`.

## Regression guard

`tools/test-installer-runnable-guard.sh` (wired into `test:shell`): demonstrates
the class (a +x directory passes bare `[ -x ]` but not the guarded form; a real
executable still passes), asserts NO unguarded executable test remains across the
three files (positive/negated, quoted/unquoted), and proves the scan is not
vacuous by planting an unquoted `[ -x ]` and a `[ ! -x ]` and requiring both to be
flagged.

## Test reconciliation

Four JS tests pin the exact installer lines (they assert installer structure/order,
unaffected by the stricter check). The full `yarn test` catches them, and each
pinned string is tightened to the new guarded form, not loosened to always-pass.

## Checklist

- [x] guard every positive `[ -x ]` site, same-path
- [x] guard the negated `[ ! -x ]` sites
- [x] cover unquoted paths
- [x] regression guard + non-vacuous two-form control
- [x] reconcile the 4 pinned JS tests; full suite 3348/3348
- [ ] challenge-loop + proof
- [ ] PR + FLAG before landing (installer = highest blast radius, awake operator)

## Out of scope

- #1616 (fs.existsSync in JS) is a separate card.
- The guard's scan covers `[ -x ]`/`[ ! -x ]`; `test -x` and `[[ -x ]]` spellings
  do not exist in the installer and are a documented residual (iteration 2 NIT).

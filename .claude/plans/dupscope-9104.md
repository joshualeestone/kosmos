# dupscope-9104: one tmpscope require in server.dm-rollover-5841.test.js, not two (#9104 follow-up)

## Why
#9126 (#9104) inserted `require('./test-support/tmpscope')` at line 2 of every suite test file. #9098 (PR #9123),
merged first, had already added its own to server.dm-rollover-5841.test.js at line 15, after the header, with its
#9098 note. Merged, the file loads it twice: harmless at run time (node loads a module once), untidy. Agreed with
PigeonPete (Fleet Builders, 2026-11-26 02:3x): whoever merges second drops theirs.

## Change
- Drop the #9104 line 2. The #9098 line stays and is still first (only 'use strict' and the header comment above it).

## Measured
- test-support.tmpscope-first-9104.test.js: 2 of 2 (the remaining line satisfies the guard).
- server.dm-rollover-5841.test.js: 21 of 21.

## Review round 1 (03:24): CONVERGED, no blocker, no should-fix
- The remaining require (line 14) has only 'use strict', a blank line and the header above it; the first tmpdir/mkdtemp
  is at 19 and the first non-builtin require at 35. Nothing depends on the removed line.
- Control (measured 03:25): with line 14 also removed, the guard fails naming this file ("never requires"); restored
  from a scratch copy, no diff.
- NIT: the branch is 21 commits behind main, none touching these files.

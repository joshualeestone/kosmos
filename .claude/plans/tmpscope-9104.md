# tmpscope-9104: every suite test file that calls tmpdir() requires tmpscope first (kosmos#9104)

## Why
#9098 was one site of a class: a raw `fs.mkdtempSync(path.join(os.tmpdir(), ...))` swept only in `test.after()` leaves its
folder when the process ends early, and a full validation of an unrelated branch goes red on the #4273 leak check.
Earlier single-site fixes: #8225, #7442, #6017, #9098.

## Change
- 1,114 test files (root and engine/, the suite's globs) that mention `tmpdir(` and never required tmpscope get
  `require('./test-support/tmpscope')` (or `../` in engine/) before their first code (after any shebang, leading
  comments and 'use strict'). Measured on origin/main 803efc5d58.
- 2 files that required a helper before tmpscope (server.decline-imports-8039, engine/trust.decline-imports-8039)
  have it moved to the top.
- Guard: test-support.tmpscope-first-9104.test.js. Any suite file that mentions `tmpdir(` must require tmpscope (or
  tmpscope-outside-home) before any tmpdir() call and before any non-builtin require. Two named exemptions with reasons:
  test-support.tmpscope.test.js (tests tmpscope itself) and engine/status.test.js (#5334, tmux socket path length).

## Decisions
- Scope is every file that mentions `tmpdir(`, not only `mkdtemp(path.join(os.tmpdir()` (the card's 843). Wider, and
  requiring tmpscope where it is not needed costs nothing. Rejected: the narrower pattern, which misses
  `const { tmpdir } = require('os')` and helper-built paths.
- engine/status.test.js is exempt rather than converted: its socket tests need the short real temp path. Converting it
  (deriving the real root as the parent of scopeDir()) is a separate change; noted on the card.
- Weakest premise: that no test asserts on the real os.tmpdir() value or a temp path length. The full validation is
  what checks it; a sample of 25 changed files (307 tests) passed.

## Measured
- Guard green on the branch; control (guard over origin/main's test files) red with 1,116 files named, 1,114 + 2.
- Sample: 25 random changed files, 307 tests, 0 fail.

# Plan: kosmos#8596, test-supervisor-codexhome-leak-3430 red on a Mac

## Call
The test is wrong, not the supervisor. The supervisor derives the codex runtime home in node
(`forSession`), which writes the path with single slashes. On a Mac, TMPDIR ends in "/", so the test's
`SB` and every expected path built from it held "//", and its exact `grep -qxF "CODEX_HOME=$RUNTIME_HOME"` missed.
Fix: strip TMPDIR's trailing slash before mktemp, so the expectation is written the way the supervisor writes it.

## Rejected
- Making the supervisor keep "//": it would preserve a caller's spelling for no reason, and node normalizes anyway.
- `pwd -P` on the sandbox: it resolves /var to /private/var, which the supervisor does not.

## Measured
- main 16b0ef8a65, this Mac: rc 1 (the pin check only).
- Fixed: rc 0. Control with a TMPDIR that has no trailing slash: rc 0.
- Mutant (the supervisor's pin line removed): rc 1, 2 FAILs. The fixed test still catches the defect it guards.

## Weakest premise
That nothing else in the suite matches a TMPDIR-built path literally against node-written output. This card fixes the
one measured red; a sweep for the same shape is not part of it.

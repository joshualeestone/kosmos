# fbleak-8225: server.filebrowser-6724.test.js leaves an aw-filebrowser temp dir on a slow host (#8225)

## Done when
- The file requires `./test-support/tmpscope` at its top, so its temp dirs are removed when it exits.
- Its own tests pass, and nothing else in the file changes.
- Main's suite no longer reports `temp: 1 x aw-filebrowser` from the #4273 LEAK check.

## Measured
Main's test run at af9e4b5770 (21:29 CST 11-07): node 0 failed, then the #4273 LEAK check found 1 aw-filebrowser dir and
the job exited 1. The file makes `aw-filebrowser-*` with mkdtemp and removes it only in `test.after`. The CI host ran
unrelated tests 5 to 20 times slower than main's green run at 994aff7679 that evening.

## Decision
One line, as the LEAK message says. The file's own `test.after` cleanup stays (tmpscope removes what is left at exit).
Rejected: an allowlist entry for aw-filebrowser (it would hide a real leak); touching anything else in the file.
Weakest part: why the `test.after` removal did not finish is inferred from the slow host, not measured.

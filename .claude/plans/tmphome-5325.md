# #5325: test and browser-check temp folders are removed when they end

## Measured (Agent1s, 2026-10-05 13:5x, $TMPDIR grouped by prefix, du via find)
- The temp folder held 7.0 GB. The two biggest leaks are unit tests, not the browser check the card names:
  engine/allowance.test.js (`kosmos-allowance-*`, 128 left, 2.6 GB, about 20 MB each: its setup-* copies) and
  engine/projects.test.js (`kosmos-projects-*`, 73 left, 1.8 GB). Every full suite run adds one of each.
- render-update-toast.js's own leftovers are small (45 runs x 5 folders, about 10 MB). Its board home holds only a
  symlink (app -> a frozen repo copy, about 90 MB) and two tiny folders, so a size that follows the link reads about
  200 MB per home; the disk it really held was the data roots, a few MB.

## Change
- engine/allowance.test.js, engine/projects.test.js: `test.after` removes the file's sandbox, only when it is under
  the real temp folder and named with the file's own prefix. Control: the old file leaves one new folder per run
  (128 -> 129); the new one leaves none (before = after).
- docs/browser-checks/render-update-toast.js: every folder it makes (four data roots, the board home, unnamed shots)
  is recorded and removed in a process 'exit' handler, so a pass, a die() and a throw all clean up. rmSync removes the
  home's app symlink, never the repo it points at (measured on a scratch symlink first). SHOT_DIR shots are kept.

## Not in this change (said so the card is not read as covering it)
Other prefixes still leak in smaller amounts (cli.feedback-2037 619 pairs, whatsnew 582, filelock-test 410, ...;
see the card comment for the table). They are a class to sweep later; these three were the disk that mattered.

## Review 1 (sonnet, blind): no BLOCKER, WARNING or CONVENTION
- NITs fixed: the toast check waits (up to 5 s) for its board to stop before the data root goes; SIGINT and SIGTERM
  exit through the same cleanup. NIT left to #5334: projects.test.js also makes clipath, cli path, cli$evil, aw-real
  and aw-link folders beside its sandbox.

## Weakest premise
That `test.after` runs on a failing run too. node:test runs after hooks whether tests pass or fail; a killed run
(SIGKILL) still leaks, which no in-process cleanup can fix.

# msgdir-9279: the message log reader refuses anything that is not a regular file

Card: kosmos#9279 (found in #8378 cluster 4 on the Windows runner).

## Finished looks like
messages.record() answers ok: false for a folder (or any non-regular file) in the log's place on every platform; an
empty regular file and a missing log still read as an empty, readable log; the server.projects #3745 arm runs on
Windows (its skipOnWin32 from PR #9294 removed in this PR once #9294 is on main); the new test runs on the Windows CI
job (ALSO in tools/windows-tests.js), so the folder case is measured on Windows in this PR's own CI.

## Change
- engine/messages.js record(): `if (!st.isFile()) return { ok: false, rows: [], parsed: [] }` after the stat.
- engine/messages.notafile-9279.test.js: a folder arm (the Windows case), a link to /dev/null arm (the Windows shape
  on a Mac: size 0, open succeeds; checked red on main's messages.js), and controls (empty file, no log, a row).
- tools/windows-tests.js: the new file in ALSO.

## Rejected
- Guarding in readBytes (an fstat after open): one more syscall on every read; the stat is already there.

## Weakest premise
Other readers of the log path besides record() (readLog, list) go through record(); not every one was traced. A
folder in the log's place is not a state the product makes; the point is that fail-closed no longer depends on how a
platform opens a folder.

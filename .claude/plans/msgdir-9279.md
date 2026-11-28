# msgdir-9279: the message log reader refuses anything that is not a regular file

Card: kosmos#9279 (found in #8378 cluster 4 on the Windows runner).

## Finished looks like
messages.record() answers ok: false for a folder (or any non-regular file) in the log's place on every platform; an
empty regular file and a missing log still read as an empty, readable log; the server.projects #3745 arm runs on
Windows (the Windows guard PR #9294 put on it, a process.platform branch with a diagnostic, removed here), and so do the two other arms that skipped on Windows for this bug (server.post-inreplyto-3224, server.post-restartcite-8178); the new test runs on the Windows CI
job (ALSO in tools/windows-tests.js), so the folder case is measured on Windows in this PR's own CI.

## Change
- engine/messages.js record(): `if (!st.isFile()) return { ok: false, rows: [], parsed: [] }` after the stat.
- engine/messages.notafile-9279.test.js: a folder arm (the Windows case), a link to /dev/null arm (the Windows shape
  on a Mac: size 0, open succeeds; checked red on main's messages.js), and controls (empty file, no log, a row).
- tools/windows-tests.js: the new file in ALSO; the #3745 sentence left out of the server.projects entry; the
  server.post-inreplyto-3224 and server.post-restartcite-8178 entries removed (their only win32 branch was this skip).
- server.projects.test.js: the #3745 unreadable-record block runs on every platform (de-indented, otherwise unchanged).
- server.post-inreplyto-3224.test.js, server.post-restartcite-8178.test.js: their #9279 skipOnWin32 (and its import)
  removed.
Measured on a Windows runner (never-merge branch angel-9279-never-merge, run 46155962967): all four arms pass there
(post-inreplyto FAIL-CLOSED, restartcite unreadable record, #3745, and the new file 3 pass + the /dev/null arm skipped).

## Rejected
- Guarding in readBytes (an fstat after open): one more syscall on every read; the stat is already there.

## Weakest premise
Other readers of the log path besides record() (readLog, list) go through record(); not every one was traced. A
folder in the log's place is not a state the product makes; the point is that fail-closed no longer depends on how a
platform opens a folder.

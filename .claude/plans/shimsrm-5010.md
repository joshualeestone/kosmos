# shimsrm-5010: the shims test's cleanup outlasts a child that still holds its folder

Card: joshualeestone/kosmos#5010. tools.windows-kosmos-shims-570.test.js went red on Windows CI with EPERM on
fs.rmSync of its temp root (main 1e1236781, PR #5009, PR #5001 at 04:07), in PRs that cannot reach it.

## The call
0. The retry (2) is the fix; the stdin close (1) is defence. Both reds seen were in withOpenStdin tests ("no hang:
   powershell -Command" on #5001 at 04:07, "no hang: powershell -File" on main 1e1236781), where it applies.
1. withOpenStdin destroys the child's stdin pipe once the shell under test exits, so a grandchild of it (the zip's
   runtime\node.exe, which inherited that never-closed stdin) reads end-of-file and exits instead of holding the folder.
2. Every temp-root and data-dir cleanup in the file goes through removeTree: it retries EPERM, EBUSY, ENOTEMPTY and
   EACCES up to 8 tries with a growing pause (250 ms x attempt, about 7 s in all), then throws an error naming the folder
   (with the last code). Any other error is thrown at once. A finally that cleans two folders cleans the second even
   if the first throws.
3. Four cross-platform tests drive removeTree with a stand-in rm (and one real folder), so a Mac shows the retry is
   reached. Controls: four mutants (no retry, flat pause, retry any code, ignore tries) each turn their test red.

## Rejected
- rmSync's own maxRetries: it retries EBUSY/EMFILE/ENFILE/ENOTEMPTY/EPERM, but it cannot be driven by a stand-in,
  so no test can show the retry is reached; the card asked for that control.
- Waiting for the whole process tree to exit: Windows gives no portable "tree gone" signal in node; the stdin close
  removes the likeliest holder and the retry covers the rest.

## Weakest premise
- That the holder is a child of the shell still reading the open stdin. If it is something else (an antivirus scan
  of the fresh node.exe), the stdin close does nothing and the retry is the whole fix; 7 s may still be short.
  Only Windows CI can show it, over several runs.

## Review ledger
- Round 1 (Sonnet, blind, source-only): 0 BLOCKER, 0 WARNING, 3 NIT. Taken: the block split a comment from its
  constant (moved); a root failure skipped the data folder (now nested try/finally). Kept: tries 0 (now ?? anyway).
- Round 1 (Opus, blind, source-only): 0 BLOCKER, 3 WARNING, 4 NIT.
  (1) the stdin close likely does nothing; the retry is the fix: AGREED, stated as item 0 (the two seen reds were
  withOpenStdin tests, so it is aimed right, but it is defence). (2) after 7 s a cleanup EPERM replaces the body's
  assertion: KEPT (pre-existing; a leaked folder must stay red) but the error now names the folder and says it is
  cleanup. (3) the default pause untested: a test added (red with the pause removed). NITs taken: move the block,
  ?? for tries, a comment on the deliberate node.exe removal. NIT kept: resolving on 'exit' not 'close' (older than
  this card; 'close' waits on any holder of stdout, which would change what the no-hang tests time).
  Controls after the fixes: six mutants (no retry, flat pause, retry any code, ignore tries, no default pause, bare
  final error), each red on its own test.
- Round 2 (Opus, blind, source-only): 0 BLOCKER, 0 WARNING, 3 NIT. CONVERGED. Taken: a cleanup that needed more than
  one try now says so on stderr (so a process that outlived its run is seen, not just waited out; the stdin close
  could otherwise hide one); the give-up message says "still busy or denied, <code>" (EACCES can be a read-only
  file, not a holder). Kept: the cleanup error replacing the body's (as round 1).


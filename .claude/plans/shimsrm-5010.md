# shimsrm-5010: the shims test's cleanup outlasts a child that still holds its folder

Card: joshualeestone/kosmos#5010. tools.windows-kosmos-shims-570.test.js went red on Windows CI with EPERM on
fs.rmSync of its temp root (main 1e1236781, PR #5009, PR #5001 at 04:07), in PRs that cannot reach it.

## The call
1. withOpenStdin destroys the child's stdin pipe once the shell under test exits, so a grandchild of it (the zip's
   runtime\node.exe, which inherited that never-closed stdin) reads end-of-file and exits instead of holding the folder.
2. Every temp-root and data-dir cleanup in the file goes through removeTree: it retries EPERM, EBUSY, ENOTEMPTY and
   EACCES up to 8 tries with a growing pause (250 ms x attempt, about 7 s in all), then throws the last error. Any
   other error is thrown at once.
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

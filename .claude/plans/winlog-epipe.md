# winlog-epipe: a dead console no longer stops a routed Windows board

Card: #8373 (reopened). Found by Homer on 11-11: Windows 0.8.03's in-place update rolled back to 0.8.02 because the new board died 74 s after start on an uncaught `Error: write EPIPE` at engine/win32boardlog.js:93, from Server.onListening. A retry took, so it is intermittent.

## Cause
The tee (#8373) copies each write into the log file and then passes it on to the original stdout. Under the in-place update that stdout can be a pipe whose reader has gone. The pass-on's EPIPE arrives as an 'error' event on the stream, which nothing listens for, so node raises it as an uncaught exception. The try/catch around the file copy cannot see it.

## The call
Once a board has routed its log, each console stream gets an error listener, and a pass-on that throws an I/O error (one with a syscall or errno) is caught; a caller's bad argument (a null or non-text chunk, an unknown encoding) still throws, on a healthy console and a dead one. After any error event or such a throw, that stream's console copy is skipped: the file keeps every line, the callback still runs, and the file says once per stream that its console copy stopped.

## Rejected
- Not passing writes on to the console at all on a routed board: a task-started board's console is nowhere by design, but a routed board that does have a console (rare) would lose its output there for no gain.
- An error listener on process.stdout for every board: an unrouted board's console is its only output, and silencing its errors is a different decision.

## Weakest premise
Why 0.8.02 survives the same pipe is not known. The fix does not depend on it, but it means another path to the same EPIPE on an unrouted board is not ruled out.

## Would change my mind
A Windows run that still crashes with this fix. Renet Tilley's engine/win32boardlog-epipe-realpipe.test.js shows a child surviving a destroyed stdout reader on this branch and dying on origin/main's module (a socketpair on a Mac, a pipe on Windows).

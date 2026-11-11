# winlog-8373: the Windows board writes its output to a log file

Card: #8373 (found by the Windows agent probing #8230 on prod 0.8.02). Handed to Baron by Splinter 08:19 CST 11-11.

## The call
On Windows, for the board its logon task started, when neither stream is already a file, the board opens `<LOCALAPPDATA>\Kosmos\logs\board.log` (beside the durable `runtime\` folder, win32anchor.anchorDir; `board-<world>.log` for a named Kosmos) for appending and copies every stdout and stderr write into it by descriptor, stamped as the Mac's file is (engine/win32boardlog.js). The console copy is not stamped. The diagnostics read (engine/diagnostics.readBoardLog) is given that descriptor. An uncaught exception's stack is written to the file too.

## Where, and why there
The Mac keeps `logs/board.log` beside `runtime/` in its KOSMOS_HOME (install/setup.sh StandardOutPath). The Windows durable home is the anchor's base, so the log goes beside its `runtime\`.

## Rejected
- A redirect on the task's command line (`cmd /c ... >> board.log`): cmd would become node's parent, and engine/win32orphan.js stops a task-started board when its host goes, so `/End` would no longer stop the board.
- The app folder (`__dirname/../logs`): on Windows that is the versioned extract root, which an update deletes.
- `win32-logs\board.log`: already the board watchdog's own start and exit lines (engine/win32boardwatch.js), bounded and rotated, under the same name.
- A tee only into the in-memory ring: the ring is lost at exit, which is when the log is most needed.

## Also decided
- One file per Kosmos: the anchor is one for every world, so two boards must not share a file the diagnostics read as their own output.
- Only a board carrying the logon task's marker: a hand-started board has its own console, and a test's child board is not marked. The marker is an environment variable, so a second board started from inside the task board's process tree inherits it; it is not cleared, because server.js reads it later for the exit watch.
- A file over 20 MB at start is moved to `.old` (one copy). The Mac's file is not rotated; a laptop board runs for months.
- Not redacted, as on the Mac. It holds what the board prints, the same text a Mac's board.log holds.

## Not in this
- What only native code writes (a child with inherited stdio): not seen, as stated in the module header.
- Lines written before server.js runs: the logon shim's own (a fallback to the previous version, a missing engine pointer) and the world bootstrap's. They still go nowhere; the shim appending to the same file is a follow-up.
- Rotation while running: the size is checked at each start only.
- The check on a real Windows box ("Done when": trigger one known board line and find it). That needs a build carrying this; Homer checks it after the next Windows build. The card stays open until then.

## Weakest premise
That nothing else on a Windows board already writes to that path. Nothing in the tree names it today (searched `logs\board.log` and `'logs', 'board.log'`); only the Mac and Linux launchers do.

## Would change my mind
A Windows run showing the copy loses or reorders lines against the console host, or a measurable boot delay from the synchronous writes.

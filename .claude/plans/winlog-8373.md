# winlog-8373: the Windows board writes its output to a log file

Card: #8373 (found by the Windows agent probing #8230 on prod 0.8.02). Handed to Baron by Splinter 08:19 CST 11-11.

## The call
On Windows, when the board's stdout is not already a file, the board opens `<LOCALAPPDATA>\Kosmos\logs\board.log` (beside the durable `runtime\` folder, win32anchor.anchorDir) for appending and copies every stdout and stderr write into it by descriptor (engine/win32boardlog.js). The stamp (engine/logstamp.js) and the diagnostics read (engine/diagnostics.readBoardLog) are given that descriptor, so the file is treated as the Mac treats fd 1.

## Where, and why there
The Mac keeps `logs/board.log` beside `runtime/` in its KOSMOS_HOME (install/setup.sh StandardOutPath). The Windows durable home is the anchor's base, so the log goes beside its `runtime\`.

## Rejected
- A redirect on the task's command line (`cmd /c ... >> board.log`): cmd would become node's parent, and engine/win32orphan.js stops a task-started board when its host goes, so `/End` would no longer stop the board.
- The app folder (`__dirname/../logs`): on Windows that is the versioned extract root, which an update deletes.
- `win32-logs\board.log`: already the board watchdog's own start and exit lines (engine/win32boardwatch.js), bounded and rotated, under the same name.
- A tee only into the in-memory ring: the ring is lost at exit, which is when the log is most needed.

## Not in this
- Rotation: the Mac's file is not rotated by the board either.
- The check on a real Windows box ("Done when": trigger one known board line and find it). That needs a build carrying this; Homer checks it after the next Windows build. The card stays open until then.

## Weakest premise
That nothing else on a Windows board already writes to that path. Nothing in the tree names it today (searched `logs\board.log` and `'logs', 'board.log'`); only the Mac and Linux launchers do.

## Would change my mind
A Windows run showing the copy loses or reorders lines against the console host, or a measurable boot delay from the synchronous writes.

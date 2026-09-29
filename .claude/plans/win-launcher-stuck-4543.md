# win-launcher-stuck-4543: opening Kosmos replaces a board that holds its port but does not answer (#4543, Windows half)

Built and tested on the Windows box by Homer (commit 5fd316dba, his description is the commit message). Homer's
GitHub account was suspended 2026-09-29 about 08:23 CDT, so PigeonPete runs the review loop and opens the PR, per
Splinter's relay. The Windows client is not rebuilt or re-verified here (Josh's Windows-box rule); review only.

## What it does (Homer)
Before the hand-off, for a person at the desktop: if the board's port is held and GET /api/status gives no answer at
all within 10 s, and every process holding the port is a Kosmos board, end the Kosmos\board task, end the listener's
process tree if it survives, and run the task again. Any answer (401, 403, 500 included) is a live board and is left
alone; a non-Kosmos listener is left alone; PORT launches never touch the task; --console and no-desktop launches do
not check. LauncherVersion 7.0.0.0; Kosmos.exe rebuilt and signed on the box.

## Review focus
- The kill scope: IsKosmosBoardImage, the TrueForAll over listeners, the second read after the wait.
- The answer rule: only a timeout is stuck.
- That nothing can throw into the launch.
- The tests: tools.win-launcher-stuck-board-4543.test.js (Windows-only probes) and the native-starts list.

## Web half
The page's status check has no time limit, so a stuck board never shows the restart screen; refiled as a separate card
for Mona (the original #4543 is invisible while Homer's account is suspended).

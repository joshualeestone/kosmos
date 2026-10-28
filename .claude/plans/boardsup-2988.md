# #2988: Windows board supervision (an exit-cause line and a watchdog task)

**Posture:** production

## Why
On the Windows box the board died between 22:57 on 10-13 and 00:20 on 10-14 and nothing started it again for about
3.5 days: `Kosmos\board` starts it only at logon, and nothing watches it. There was no record of why it died either,
because the board's output goes to a headless console that is never saved. #7451 (10-28) is a second sighting.

## Design
The measurements and the call are on the card:
https://github.com/joshualeestone/kosmos/issues/2988#issuecomment-6468326726

1. **Exit-cause line** (engine/win32boardwatch.js `recordBoardExits`, armed from server.js only for a task-started
   board, in place of the bare `exitWhenParentGone`, which it now arms itself). Lines in
   `<Kosmos data>\win32-logs\board.log`, through win32supervisorlog (bounded, rotated, secrets redacted), with the data
   root read before any named world (worlds.preWorldEnv) so the board and the watchdog agree on the file:
   - `<iso> board started pid=<pid> parent=<ppid>`
   - `<iso> board exited pid=<pid> code=<code>: <cause>`, the cause being
     `its host process (pid N) was gone` | `a console signal (SIGINT)` (and SIGHUP, SIGBREAK, SIGTERM, each exiting
     128+n) | `an uncaught error (<Name>: <first line>)` (uncaughtExceptionMonitor, only when no uncaughtException
     handler will catch it) | `it exited by itself`.
2. **Watchdog** `Kosmos\board-watchdog`: TimeTrigger, StartBoundary 2020-01-01T00:00:00, Repetition PT1M with
   StopAtDurationEnd false and no Duration, IgnoreNew, InteractiveToken, LeastPrivilege, PT0S, headless conhost, always
   enabled. It runs `board-watchdog.js` beside `board-boot.js` (pointer indirection like BOOT_JS; BOOT_JS untouched),
   which leaves without loading the engine while any journal is not a whole finished record, then calls
   `win32boardwatch.watchdogMain`. Registered/refreshed by `ensureInstalled` exactly when the board task was registered
   or refreshed, inside ensureInstalled's existing two-schtasks-timeouts budget (#2973/#2983); removed first by
   `win32board.remove()`, and by the uninstall (which now knows it by name).
   Gate order, cheapest first; every gate must hold, and only then `/Run`:
   a. `win32apply.boardMayStart` (a connect-only computer, #4382);
   b. no update in flight: `win32apply.readJournal` not unfinished nor unreadable, and `win32update.lockHeldNow` (a new
      read-only export of takeLock's own `readLock` judgement) neither held nor broken;
   c. the port is silent: `win32handoff.probeBoardOnEveryAddress` + `boardMayBeOpen` (only refused is silent);
   d. `win32board.status()`: known, registered, enabled, and not already shown running;
   e. after 5 s, the port is still silent and (b) still holds.
   On `/Run` it writes `<iso> board was not answering; started it. The last exit recorded: <exit line> (at <iso>)` or
   `... started it. No exit was recorded, so it was killed or crashed hard`. Every other run writes nothing.

## Rejected
- A repetition on the board task itself: a LogonTrigger repetition does not fire before the next logon (measured), and
  a TimeTrigger one would run BOOT_JS every minute, including inside an update's stop-swap-start window.
- Task Scheduler RestartOnFailure: keys on a failed start, not a process exit.
- A respawn loop in a wrapper: makes the board a child, which BOOT_JS's header forbids.
- `/End` then `/Run` when the task reads Running but nothing answers: it could end a board that is slow to boot or
  recovering an update. The watchdog leaves that case alone (see weakest point).
- A separate `board.log` name to avoid an agent named `board` sharing the file: kept the card's name; the watchdog
  reads only lines that start with an ISO time and `board`, so an agent's lines are never taken for the board's.

## Weakest point
The "no update in flight" gate. It reads the journal and the lock the way win32apply does (its own readers), and a test
rewrites a real staged journal to every phase in `win32apply.PHASES` and holds the real lock; but nothing here ran a
real update while a watchdog ticked. A stuck unfinished journal also keeps the watchdog off until someone starts the
board by hand, which is the behaviour before this change. Second: a task that reads Running while no board answers
(the 10-17 report) is not fixed by `/Run` (IgnoreNew), so the watchdog does nothing there.

## What would change my mind
A box measurement that `/Run` during an update is harmless (the watchdog could drop gate b), or that the
Running-with-no-board state is common (then an `/End` path with a long grace is worth its risk).

## Rounds
- Round 0 (build)

# agystdin-5576: the agy bridge never lets a socket take fd 0

Card: joshualeestone/kosmos#5576 (agy bridge child aborts in libuv uv__close, fd > STDERR_FILENO, on loaded CI runs).

## What finished looks like
The agy report bridge never runs a network request while fd 0, 1 or 2 is free, so no socket can be numbered 0 to 2 and libuv's uv__close assertion cannot fire on one. The trace test (#5576's instrument) passes on the Linux lane, where it was red.

## Evidence (measured, not reasoned)
Linux lane on main f22f0de85 (run 38033565561), the #5576 trace test, red:
`agy-trace start | 0:chr@5` then `agy-trace fetch begin | 0:EBADF`, then `fetch end ok | 0:sock@...`.
fd 0 was open at start and closed by the fetch; the fetch's socket then took number 0. libuv asserts `fd > STDERR_FILENO` when it closes a handle's fd, which is the abort in the card.
What CLOSED fd 0 on Linux is not measured. destroy() is the only stdin call in between, but a reviewer measured that it does not free fd 0 on macOS (Node 26) or on Linux (Node 24); CI runs Node 26 on Linux. So the destroy -> pause change is defensive, and the guard (holdStdioFds right before the request) is the fix: it holds the fd whoever freed it, as long as the freeing happens before the request.
Why Macs hid it (measured): on a Mac, making process.stdout reopens /dev/null on a closed fd 0, and the bridge writes stdout (its answer) before the request. A test that makes stdout first and then closes fd 0 reproduces the Linux state on a Mac, and goes red without the guard.

## Change
1. readStdin's finish: `pause()` and `unref()` stdin instead of `destroy()`. The process always ends with process.exit, so nothing is kept alive by an open stdin.
2. `holdStdioFds()`: before the request, any of fds 0 to 2 that reads EBADF is filled with the null device (os.devNull), lowest first, so it gets that number; an open that lands on another number is closed again. Best effort, never throws.
   It runs after one turn of the loop (setImmediate, review 2), so a close left pending by the stdin handling has landed.
   PREMISE (weakest in this change, review 3): whatever frees fd 0 has done so by then. The Linux trace showed fd 0 free already at fetch begin, which fits; a close landing while the request opens is not covered.
3. The test helper's retry (engine/agyseed-4417.test.js, endedByRunner): a libuv uv__close abort is no longer retried when its own trace shows fd 0 freed or a socket on fd 0 (this mechanism again, so red). Any other uv__close abort is still retried. Reason (review 3): the only real abort before this, on macOS 2026-10-08, was never traced, and Macs hide this state, so it is not shown to share this cause; retrying it unconditionally would hide a recurrence, not retrying it at all could make CI red on a second, unproven cause.

## Decided, not missed
- Fix in the bridge, not in Node or the test: the bridge is the process that aborts, and the guard holds whoever closed the fd.
- Only the agy bridge destroys stdin (searched bin/*.js); the gemini and grok bridges are unchanged.
- The trace test stays strict (every fd open at fetch begin): it is the regression check, and it is red on Linux without this change.

## Tests
- Unit: holdStdioFds with a stand-in fs: fills an EBADF fd, closes an open that landed elsewhere, leaves other errors alone.
- Real child (any platform): a child closes fd 0, runs the guard, opens a file: the file is not fd 0, and fd 0 is the null device. CONTROL: without the guard the file takes fd 0.
- The real bridge (Stop, stand-in board, trace preload) with fd 0 freed after stdout is made: fetch begin shows fd 0 as the null device and no socket ever on fd 0; red with main's guard call removed (mutation).
- Not covered here: #5765 (the launchprune Linux red found by the same run) is its own card.
- Linux lane run on the branch for the trace test.

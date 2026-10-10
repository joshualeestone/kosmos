# agystdin-5576: the agy bridge never lets a socket take fd 0

Card: joshualeestone/kosmos#5576 (agy bridge child aborts in libuv uv__close, fd > STDERR_FILENO, on loaded CI runs).

## What finished looks like
The agy report bridge never runs a network request while fd 0, 1 or 2 is free, so no socket can be numbered 0 to 2 and libuv's uv__close assertion cannot fire on one. The trace test (#5576's instrument) passes on the Linux lane, where it was red.

## Evidence (measured, not reasoned)
Linux lane on main f22f0de85 (run 38033565561), the #5576 trace test, red:
`agy-trace start | 0:chr@5` then `agy-trace fetch begin | 0:EBADF`, then `fetch end ok | 0:sock@...`.
fd 0 was open at start and closed by the fetch; the fetch's socket then took number 0. Between the two the only thing that touches stdin is readStdin, which calls `process.stdin.destroy()`. libuv asserts `fd > STDERR_FILENO` when it closes a handle's fd, which is the abort in the card. On this Mac, destroy does not free fd 0 (probed with a pipe and with /dev/null), which is why Mac runs rarely show it.

## Change
1. readStdin's finish: `pause()` and `unref()` stdin instead of `destroy()`. The process always ends with process.exit, so nothing is kept alive by an open stdin.
2. `holdStdioFds()`: before the request, any of fds 0 to 2 that reads EBADF is filled with the null device (os.devNull), lowest first, so it gets that number; an open that lands on another number is closed again. Best effort, never throws.

## Decided, not missed
- Fix in the bridge, not in Node or the test: the bridge is the process that aborts, and the guard holds whoever closed the fd.
- Only the agy bridge destroys stdin (searched bin/*.js); the gemini and grok bridges are unchanged.
- The trace test stays strict (every fd open at fetch begin): it is the regression check, and it is red on Linux without this change.

## Tests
- Unit: holdStdioFds with a stand-in fs: fills an EBADF fd, closes an open that landed elsewhere, leaves other errors alone.
- Real child (any platform): a child closes fd 0, runs the guard, opens a file: the file is not fd 0, and fd 0 is the null device. CONTROL: without the guard the file takes fd 0.
- Linux lane run on the branch for the trace test.

# win-delguard-8640: the #8640 delete guard's folder check, on Windows

**Posture:** production

## Finished looks like
1. On Windows, `delete-leftover` refuses an agent while a process works in its folder (its program is inside the
   folder, or its command line names the folder or a path inside it), with the same sentence as on the Mac.
2. A read that cannot be completed (no sentinel, PowerShell failed or timed out) refuses the delete (fails closed).
3. The Mac and Linux path is unchanged; the source is off unless server.js turns it on, on Windows only.

## Why
`status.paneFoldersSteps()` returned `[]` whenever `paneSource` was set. On Windows server.js sets `paneSource` to
`win32roster.make()`, so the folder half of the guard never ran there (read from main, 2026-11-17).

## Decision (Homer, 2026-11-17)
- Chosen: one CIM read of every process (`Win32_Process`: id, name, ExecutablePath, CommandLine) with a sentinel, as a
  step in the same generator, so the board's synchronous read and the delete plan's off-thread read cannot differ.
  Each process gives rows for its program's folder and for every Windows path its command line names. An 8.3 spelling
  is also given in its long form.
- Rejected: reading each process's working folder. Windows does not let one process read another's working folder
  without native code (PEB reads). A tool started from inside the folder with no path in its arguments is not seen.
  That gap is named in the code.
- Rejected: turning the read on by `process.platform`. A test suite on Windows would then read the box's real
  processes. It is an explicit seam, `setWin32FolderSource(true)`, which only server.js sets.
- Where the read runs (review 1): OFF the board's thread for every page and delete. planAsync and delAsync read the
  list once with the async driver (paneFoldersAsync) before anything else, and hand it to every plan in that request
  (the warm plan, the final plan, and delSteps' re-plan), so no plan in them reads synchronously (a test fails if one
  does). Only the synchronous plan()/del() still read on the caller's thread, as the tmux read always did. The read is
  ~0.5 s measured, bounded at 15 s; a timeout refuses the delete. An 8.3 lookup is done once per prefix per read.
- Cost and freshness (review 2): the list is read only when the agent's folder exists (a file check, not a second
  plan, which would read the roster again, kosmos#7835); reads already running are shared, finished ones never reused;
  a delete reads again after the drive probe so its re-plan sees the processes of its own moment. A living agent with a
  folder still costs one shared off-thread read (only the plan knows it is living). Candidates per path are capped
  (64 cuts within 1024 characters).
- Unquoted paths (review 1): where an unquoted path ends cannot be known, so each candidate is also cut at every space,
  `;`, `,` and `'`; an extra candidate can only make the check refuse more (the safe side).
- Weakest part: the working-folder gap above. A Kosmos-started agent is already caught by the roster (by name), so the
  folder check is the second line for tools a person started.
- Would change my mind: a cheap, safe way to read another process's working folder on Windows.

## Validation
- `engine/delete-leftover.win32folders-8640.test.js` (14 tests, including a live process that names the folder, sync
  and async).
- The delete-leftover and status suites plus the policy tests. On a Windows host, 17 tests in
  delete-leftover.offthread-7835, delete-leftover.running-8640, status.config-dir-1523, status.heldq-7915, status.snapshotunheld-7693 and status.tmux-bin fail with
  and without this branch (Mac-shaped paths); Mac CI runs them.
- Measured: the live read takes about 0.5 s on the Windows box (1015 rows).

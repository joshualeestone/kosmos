# builtsha-6330: a built mark can carry the deliverable's fingerprint (#6330 slice 2)

#6330 (daily feedback 2026-10-16) asked for two things in a handoff between agents: the next agent hears that the earlier
step is built (slice 1, merged 34889e24b) and "a built-in way to hand over a finished deliverable with a fixed
fingerprint (for example a checksum), so the next agent can confirm it is checking the exact thing that was delivered".
This is that second part.

## What an agent sees
- `kosmos task built <project-id> <task-number> ["note"] --file <path>`: the CLI hashes the file on this computer (sha256)
  and sends `fingerprint: "sha256:<64 hex>"` with the mark. Mac (install/kosmos, shasum -a 256) and Windows
  (tools/windows/kosmos-cli.js, node crypto) alike. A missing or unreadable file is refused before the board.
- The board stores it on the task as `builtFingerprint` (with the mark: cleared with it, part of "the same mark again").
- The line slice 1 types to the next agents ends with the fingerprint, so they can compare it: `shasum -a 256 <file>`.
- `kosmos task list` shows it on a built task, so an agent who missed the line can still check.

## Rules
- Shape checked on the board: exactly `sha256:` and 64 lowercase hex; anything else is refused (400), never stored.
- Only an agent's mark carries one; the person's mark from the screen sends none, and a clear drops it.
- No board or agent-card UI: Josh's 11:16 ruling (no new visible lines until his clean-up ships). The Tasks page does
  not render it.

## Decided
- **The CLI hashes, the board never reads the file.** Rejected: the board hashing a path it is given (it would read any
  file an agent names, a path is not the deliverable once moved, and agents and the board may not share a folder).
- **sha256 only**, named in the value, so a later algorithm can be added without a format change.

## Weakest premise
That the next agent has the same file to hash. A fingerprint proves sameness only against a copy; if the deliverable is
a folder or a deployed thing, a file's hash does not cover it (folders are out of scope here).

## Tests
- server.builtsha-6330.test.js (6): engine stores, clears, same-mark vs a new fingerprint, refuses four bad shapes; route
  400 on a bad shape (nothing stored), an agent's stored, the screen's ignored (control: the screen mark went through);
  the typed line carries it, a mark without one carries none (control); Mac CLI --file end to end with a real file and
  task list showing it; Mac refusals (missing file, --file with no path, --file with --clear) never mark the task.
- tools.windows-kosmos-cli-570.test.js (+1): the Windows CLI sends the sha256, keeps the path out of the note, a mark
  without --file sends none (control), and the three refusals never reach the board.
- Red-capable: with engine/tasks.js, server.js and both CLIs reverted to origin/main, all 6 server tests fail and
  exactly the new Windows test fails (46/47).
- Not tested: Windows task list printing the fingerprint (the list view is the same two-line shape as the Mac's, which
  is tested end to end).

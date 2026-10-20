# hookhome-6713: a source or worktree board leaves the real home's account hooks alone

Card: kosmos#6713 (follow-up to #6601).

## Finished looks like

A board started from a source checkout or a worktree that adds or reconnects an account in the REAL home leaves that
account's `settings.json` byte for byte as it was (no report hooks, no weekly statusline pointing at its own
throwaway engine), and says why in `prepare`'s result. An installed board still writes them, and so does any board
with its own `AGENT_WORKFORCE_HOME` sandbox. Both are measured.

## Measured first (two real Mac installs, Agent1s and Mortals for two users)

Every installed board runs as `<root>/runtime/bin/node <root>/app/server.js` with root `~/.local/share/kosmos` and its
engine at `<root>/app/engine`. That is the same shape as Windows' `<root>/runtime/node.exe` plus `<root>/app/server.js`.
A source checkout or worktree has neither file two folders up from its engine.

## Changes

- `engine/installroot.js` (new):
  - `installRoot()` returns the install root or null. win32 asks `win32board.bundleRoot`; elsewhere it checks
    `runtime/bin/node` and `app/server.js` two folders up.
  - `leaveAlone(file)` returns why a write must be skipped, or null. It skips only when the board is not installed
    and the file is in the real home: no sandbox, or a sandbox that is the home itself, and the file inside the home.
- `engine/accounts.js` `prepare`: the report-hooks block is skipped under `leaveAlone`, and the result carries
  `hooksBecause`.
- `engine/allowance.js` `ensureStatusLine`: the same gate. That covers both `prepare` and the Settings
  "usage reading" route. `leaveAlone` is injectable.
- `engine/installroot-6713.test.js`: unit checks, a real-filesystem measurement (this worktree is not installed, the
  real install is), a byte-for-byte prepare in a stand-in real home, a sandbox control, and the statusline route
  with a go-ahead control.

## Decisions

- **Gate on "installed AND real home", not on "installed" alone.** Every test, and every sandboxed test board, runs
  from source with its own `AGENT_WORKFORCE_HOME` and must keep wiring its own sandbox. The harm is only to the real
  accounts.
- **Rejected:** gating on a port or data folder (#6601 rejected it too; the harm is the script path), and a pointer
  file check (an update can move the engine before the pointer).
- **Weakest premise:** a second built bundle extracted elsewhere and started as a test board passes `installRoot`,
  as on Windows. A stronger check (the root equals the KOSMOS_HOME setup wrote) can tighten both later.
- **What would change my mind:** an installed Mac board whose engine is not at `<root>/app/engine`, for example a
  future layout change.

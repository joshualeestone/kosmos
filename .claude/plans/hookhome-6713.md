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
    `runtime/bin/node` and `app/server.js` two folders up, with that root being the default `~/.local/share/kosmos`
    (by identity).
  - `leaveAlone(file)` returns why a write must be skipped, or null. It skips only when the board is not installed
    and the file is in the real home (as spelled or where links lead), unless the file really lies inside a sandbox
    that is neither the home nor above it. A real-home file is skipped even while a sandbox elsewhere is set.
- `install/setup.sh` (the hooks loop): skips a target `leaveAlone` names, so the installer's hooks and statusline
  follow one rule. Exits: 0 all wired, 20 all left alone, 21 some left alone and the rest wired, 1 refused, 22 refused
  and some left alone, each with its own line.
- `engine/accounts.js` `prepare`: the report-hooks block is skipped under `leaveAlone`, and the result carries
  `hooksBecause`.
- `engine/allowance.js` `ensureStatusLine`: the same gate. That covers both `prepare` and the Settings
  "usage reading" route. `leaveAlone` is injectable.
- `engine/installroot-6713.test.js`: runs setup.sh's hooks block end to end (a default-place bundle writes the hooks
  and the statusline; one elsewhere exits 20 and leaves the home byte for byte; mixed runs exit 21 or 22) and checks
  each exit's line; plus unit checks, a real-filesystem measurement (this worktree is not installed, the
  real install is), a byte-for-byte prepare in a stand-in real home, a sandbox control, and the statusline route
  with a go-ahead control.

## Decisions

- **Gate on "installed AND real home", not on "installed" alone.** Every test, and every sandboxed test board, runs
  from source with its own `AGENT_WORKFORCE_HOME` and must keep wiring its own sandbox. The harm is only to the real
  accounts.
- **Linux uses the Mac rule.** `install/setup.sh` runs `$KOSMOS_HOME/runtime/bin/node` on every platform it installs on,
  so the layout is the same. This is derived from setup.sh and not measured on a Linux install.
- **The installer says what happened:** when every target is left alone, it says so, instead of the "agents report
  themselves" line.
- **Windows changes too:** `prepare` and `ensureStatusLine` were ungated there. Now a Windows board whose
  `win32board.bundleRoot` is null (a source checkout, or a build in the updater's folder, as for #6601's
  `wireDefaultHooks`) leaves real-home account settings alone.
- **Rejected:** gating on a port or data folder (#6601 rejected it too; the harm is the script path), and a pointer
  file check (an update can move the engine before the pointer).
- **The Mac install signal also requires the default root** `~/.local/share/kosmos`, compared by identity. A full bundle
  under any other KOSMOS_HOME is a test install, as `install/setup.sh` `write_install_config` treats it. A self-host
  install with a custom KOSMOS_HOME therefore gets no account hooks or statusline from Kosmos in the real home, from
  the board or from setup.sh (whose hooks loop now asks the same `leaveAlone`), the stance setup.sh already takes
  for its install config.
- **Folders are compared by identity** (device and inode, like setup.sh's `-ef`), so `/System/Volumes/Data/Users/<u>`
  and a differently cased spelling still name the real home.
- **Follow-up, not done here:** `allowance.stableNode` answers "is this the installed engine" by folder names. Moving it
  onto `installRoot` would change which node it bakes in for a custom-KOSMOS_HOME install, so it is left as it is.
- **Weakest premise:** on Windows a second built bundle extracted elsewhere still passes `win32board.bundleRoot`
  (#6601's gap); on a Mac the default-root check closes it. A stronger check (the root equals the KOSMOS_HOME setup wrote) can tighten both later.
- **What would change my mind:** an installed Mac board whose engine is not at `<root>/app/engine`, for example a
  future layout change.
- **A "sandbox" equal to the home is the real home** (round 16 raised it): `AGENT_WORKFORCE_HOME=$HOME` names the
  person's own folders, so a source board launched that way leaves them alone. A board that wants to wire its own
  folders runs with a sandbox that is not the home (every test board does).
- **The installer fails closed** when the rule it just extracted will not load (round 15), as the board does.

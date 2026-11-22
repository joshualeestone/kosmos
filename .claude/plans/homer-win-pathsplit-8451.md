# homer-win-pathsplit-8451: a PATH= value in a hook line, read the way Git Bash reads it on Windows

**Posture:** production

Card: kosmos#8451, item 1 only. Items 2 (package folder on Windows) and 3 (POSIX `/opt` under Git Bash's own root) stay open on the card for a second change.

## Problem

`engine/startcommands.js` reads hook command lines to name the scripts an agent's next start runs; the Windows token-only guard (#5664) relies on it. A `PATH=` assignment's value is split on `':'`. On Windows, Kosmos expands `~` and `$HOME` to the Windows home (`C:\H`), so `PATH=~/bin:$PATH myhook` splits as `C` and `\H/bin`, naming a junk path `C:\A\C\myhook` (A = the agent folder).

## Measured on the Windows box (2026-11-22)

1. Claude Code 2.1.319 runs hooks in Git Bash: a SessionStart hook printed `BASH_VERSION 5.3.15`, `SHELL /bin/bash.exe`, PATH `:`-separated in `/c/...` form. So `:` is the separator; `path.delimiter` (`;`) would be wrong.
2. In Git Bash, `PATH=C:/x:$PATH cmd` and `PATH="C:\x:$PATH" cmd` both find `cmd` in a folder named `C` where the command runs, not in `C:\x`: a typed drive path is split on its colon.
3. `~` and `$HOME` reach bash as `/c/...`, even when HOME was set as `C:\...`, and the home folder is searched.
4. `cygpath -w`: `/x` is `X:\`, `/c/tools` is `C:\tools`, `/opt/x` is under Git's install folder, `/cc/x` is not a drive.

## Change

- New pure `splitPathValue(value, win, home)` in `engine/startcommands.js`, used by the PATH arm with `process.platform === 'win32'` and `vars.HOME`.
  - Off Windows: `value.split(':')`, unchanged.
  - On Windows: split on `:`, except the drive colon of a piece that starts with the expanded home (case-insensitive). A one-letter first folder (`/c/x`, `/x`) becomes that drive (`C:/x`, `X:`).
- Tests: `engine/startcommands.win32-pathsplit-8451.test.js`. The splitter cases run on every platform with the Windows rule passed explicitly; the end-to-end `pathsOfWords` cases run on Windows only.
- `engine/windows-coupling-audit-1732.test.js`: the inventory row for this file's `split(':')` follows the line to its new place.

## Rejected

- `path.delimiter`: Git Bash splits on `:`, so `;` names folders bash never searches.
- Keeping every drive colon: Git Bash splits a typed drive path (measurement 2), so that would name `C:\x`, which bash does not search, and miss the folder it does.

## Weakest part

The rule depends on Claude Code running hooks in Git Bash on Windows. If it ever moves to a PowerShell or cmd hook runner, the separator rule changes. The probe is kept so it can be re-run (`work/trial-8451/probe`).

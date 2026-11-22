# homer-win-pathsplit-8451: a PATH= value in a hook line, read the way Git Bash reads it on Windows

**Posture:** production

Card: kosmos#8451, item 1 only. Items 2 (package folder on Windows) and 3 (POSIX `/opt` under Git Bash's own root) stay open on the card for a second change.

## Problem

`engine/startcommands.js` reads hook command lines to name the scripts an agent's next start runs; the Windows token-only guard (#5664) relies on it. A `PATH=` assignment's value is split on `':'`. On Windows, Kosmos expands `~` and `$HOME` to the Windows home (`C:\H`), so `PATH=~/bin:$PATH myhook` splits as `C` and `\H/bin`, naming a junk path `C:\A\C\myhook` (A = the agent folder).

## Measured on the Windows box (2026-11-22)

1. Claude Code 2.1.319 runs hooks in Git Bash: a SessionStart hook printed `BASH_VERSION 5.3.15`, `SHELL /bin/bash.exe`, PATH `:`-separated in `/c/...` form. So `:` is the separator; `path.delimiter` (`;`) would be wrong.
2. In Git Bash, `PATH=C:/x:$PATH cmd` and `PATH="C:\x:$PATH" cmd` both find `cmd` in a folder named `C` where the command runs, not in `C:\x`: a typed drive path is split on its colon.
3. `~` and `$HOME` reach bash as `/c/...`, even when HOME was set as `C:\...`, and the home folder is searched. Inside a piece too: `PATH=x$HOME/bin:$PATH cmd` found `cmd` in `x/c/Users/<you>/bin` under the folder the command ran in (challenge review 3).
4. `cygpath -w`: `/x` is `X:\`, `/c/tools` is `C:\tools`, `/opt/x` is under Git's install folder, `/cc/x` is not a drive.
5. Which variables Git Bash converts when it starts (challenge review 4, re-measured): with each set to `D:\...`, bash printed `/d/...` for exactly `HOME`, `TMP`, `TEMP` and `TMPDIR`; `USERPROFILE`, `APPDATA`, `CLAUDE_PROJECT_DIR` and an arbitrary `FOO` stayed `D:\...`.

## Change

- New pure `splitPathValue(value, win, converted)` in `engine/startcommands.js`, used by the PATH arm with `process.platform === 'win32'` and the Windows values of the variables Git Bash converts (`GIT_BASH_CONVERTS`: HOME, TMP, TEMP, TMPDIR).
  - Off Windows: `value.split(':')`, unchanged.
  - On Windows: every plain `:` piece is kept, exactly as before (a one-letter first folder becomes that drive: `/c/x` is `C:/x`, and a bare `/x` is the drive root `X:/`, since a bare `X:` would resolve to the current folder on X:, challenge review 2). IN ADDITION, the value is split a second time with every whole occurrence of the Windows value of each variable Git Bash converts (measurement 5: HOME, TMP, TEMP, TMPDIR; longest first, so a TMP inside the home rewrites as itself), shown here for the home (case-insensitive, either slash, and any occurrence: bash holds `${HOME}.local/bin` as `/c/H.local/bin`, and rewriting a longer name such as `C:\Homer` as `/c/Homer` names the same folder again, so it costs only a duplicate; challenge review 6) rewritten in its Git Bash form (`C:\H` to `/c/H`), and those pieces are named too. That covers the home at the start of a piece (`/c/H/bin` is `C:/H/bin`) and inside one (`x/c/H/bin`, a folder where the command runs; challenge review 3).
  - Why both and not either: this feeds a deny guard, where naming a folder too many is harmless and missing one is a hole. The parser has already expanded `~`/`$HOME` by the time it splits, so it cannot tell them from a variable or literal with the same text. Bash searches the home whole for `~`/`$HOME` (measurement 3) but splits a Windows path from any other variable, such as `CLAUDE_PROJECT_DIR`, which sits under the home on a real box (challenge review 1, measured: bash ran `<cwd>/C/myhook`). Naming both covers both.
- Tests: `engine/startcommands.win32-pathsplit-8451.test.js`. The splitter cases run on every platform with the Windows rule passed explicitly; the end-to-end `pathsOfWords` cases run on Windows only, including the review-1 case (a variable under the home still names `<cwd>\<drive>\myhook`).
- `engine/windows-coupling-audit-1732.test.js` and `engine/win32-separator-guard.test.js`: the allow entries for this file's `split(':')` follow the lines to their new places (two lines now).

## Rejected

- `path.delimiter`: Git Bash splits on `:`, so `;` names folders bash never searches.
- Keeping the home's drive colon INSTEAD of the plain split (the first version): it dropped the folder bash really searches when the text came from a variable other than `~`/`$HOME`, a regression from a harmless extra name to a missed script (challenge review 1).
- Tracking where `~`/`$HOME` were expanded inside `shellWords`: exact, but it changes the tokenizer every arm shares, for a gain (one fewer harmless name) that a deny guard does not need.

## Weakest part

1. The rule depends on Claude Code running hooks in Git Bash on Windows. If it ever moves to a PowerShell or cmd hook runner, the separator rule changes. To re-run the measurement, put this in a scratch folder's `.claude/settings.json` and run `claude -p ok` there; `hookprobe.txt` shows the shell and its PATH:
   `{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"echo \"bash=[$BASH_VERSION] shell=[$SHELL] path=[$PATH]\" > hookprobe.txt"}]}]}}`
2. The converted set (HOME, TMP, TEMP, TMPDIR) is measured on Git for Windows as installed on this box. Every other variable is split as Windows-form, which the plain split covers. If a future Git for Windows converts more variables, they would need adding to `GIT_BASH_CONVERTS`; re-run measurement 5 after a Git upgrade.

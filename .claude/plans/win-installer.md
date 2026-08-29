# Port the Windows installer onto Pete's builder

**Card #570. Agreed with PigeonPete and Splinter: I port, Pete reviews.**

PigeonPete and I built parallel Windows builders without knowing. **His survives
and mine is deleted** -- it filters `*.test.js` (mine shipped 78 test files to
users), stages `app/bin/`, generates CRLF launchers, and reads the port out of
`server.js`. Mine did none of those.

**What travels across is the PowerShell installer only**, with six review
blockers fixed first and without my LF line endings.

## Why the installer is optional and stays optional

`Kosmos.cmd` alone is a complete product: extract, double-click, the board comes
up. The installer adds Start Menu, start at login and a clean uninstall. **If it
fails, or somebody never runs it, the extracted folder still works.** A person is
never left holding only the half that broke.

## The six blockers, fixed before the port rather than after

| # | was | now |
|---|---|---|
| 1 | **the uninstaller named a folder that does not exist**: it said `%LOCALAPPDATA%\AgentWorkforce`, but `dataRootFor('win32')` returns Roaming | **asks the app**: runs the bundled `node.exe` for `store.ROOT` and writes that. One resolver, one answer, cannot drift |
| 2 | `Remove-Item -Recurse -Force` on any folder merely NAMED Kosmos, unguarded, running after the previous install was already deleted | gated on an `app\server.js` sentinel, refuses a reparse point, and every statement through the copy is wrapped |
| 3 | **the uninstaller could not stop the board and said Done anyway**: `taskkill /FI "WINDOWTITLE eq Kosmos*"` matched nothing, because the launcher uses `start ""` and the title is empty | stops by **path**, runs from `%TEMP%` (rmdir cannot remove its own cwd), and gates the message on the directory actually being gone |
| 4 | `$env:APPDATA` read at the call site, so a null threw **outside** the catch and reintroduced the regression the catch was added for | read inside the function |
| 5 | `Resolve-Path` without `-LiteralPath`, so a `Kosmos [1]` folder silently skipped the self-install guard; and the guard tested equality, not containment | `-LiteralPath`, and it refuses when the source is **under** the install dir |
| 6 | the uninstaller **interpolated the path**: `-Encoding ASCII` turned `Müller` into `M?ller`, and a `%` in a username was stripped by cmd | the REMOVAL path derives from `%~dp0`. ⚠️ **The DATA path was still interpolated and this row claimed otherwise** -- a reviewer caught the overclaim. It now goes in a file the `.cmd` reads with `set /p` before the delete, so the path never enters cmd's parser and no encoding of the `.cmd` can damage it |

Also: `LOCALAPPDATA` unset now dies with a sentence rather than "Cannot bind
argument to parameter 'Path'"; TLS 1.2 and proxy credentials are set for the thin
download with **distinct messages** for a proxy, a TLS failure and being offline;
and the engine floor counts real modules rather than test files.

## CRLF is now structural, not remembered

**My parallel builder shipped `.cmd` files as LF**, because they were static files
copied straight across, and Pete's own comment had predicted exactly that: *"This
is written on a Mac, so it is the single most likely thing to be wrong on first
contact."*

The builder now converts on the way in (`awk`, stripping any existing CR first so
it is idempotent), so **a file edited on a Mac cannot reach Windows with Unix line
endings.** Measured on the shipped artifact: 5 of 5 text files 100% CRLF,
including the installer. Control: `server.js` has 0 CRLF lines.

## The check that did not exist

`test:shell` `bash -n`s roughly forty shipped scripts and knew nothing about
PowerShell, so the one file that runs on a stranger's machine and deletes things
had no check at all.

`tools/test-powershell-syntax.sh` now **parses and then renders**, and the second
phase is the one that matters:

```
input    powershell -Command "\$here = \$env:FOO; Write-Output \$here"
parses   OK, 12 tokens
renders  powershell -Command "\ = \; Write-Output \"      <- variables EATEN
```

🛑 **A parse check cannot see an interpolation defect, by construction.** A string
that assembles wrong is syntactically perfect. **So "pwsh would have caught the
backtick bug" is false**, and both Splinter and I believed it until I measured it.

⭐ **The tool found a real bug in the file it was written for, on its first run:**
my fix for that bug had rewritten it *with the same bug*, five times.

Both phases carry a control that runs every time and a floor, and the tool skips
loudly rather than silently when `pwsh` is absent.

## Verified

```
build            exit 0, 59 engine modules, 0 test files, 85 files
Pete's refusals  intact, and the two new installer files added to the required list
CRLF             5/5 shipped text files, 100%.  CONTROL: server.js 0
shipped .ps1     parses (token count varies; the checker prints it) and renders clean
full suite       green
```

## Not verified, and not claimed

**Nothing in this branch has been executed on Windows.** The installer, the
shortcuts, the Startup entry and the uninstaller are unrun. The one previous
Windows run exercised a different builder's artifact, through SSM as LocalSystem,
which cannot answer what a real user's environment looks like.

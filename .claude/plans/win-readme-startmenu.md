# win-readme-startmenu: the Windows zip READ ME opens Kosmos from the Start menu

**Posture:** production

## Problem

The zip's "! READ ME FIRST - Windows will warn you.txt" (written by tools/build-kosmos-windows.sh)
contradicts itself. The install paragraph says "From then on, open Kosmos from the Start menu. You
can delete the zip you downloaded." Two later lines then send the person back to Kosmos.exe:
"To open Kosmos again later, double-click Kosmos.exe again." and "If Kosmos does not open, or the
board says it is not signed in, double-click Kosmos.exe again. ... Always open Kosmos from
Kosmos.exe." That Kosmos.exe is in the extracted zip folder they were just told they could delete.
Raised for site PR #245 (installkosmos.com already says Start menu).

## Done when

1. The built zip's READ ME tells a person to open Kosmos from the Start menu later and when it is
   not signed in, keeps that bookmarks do not stay signed in, and keeps the update-by-hand paragraph
   about the new zip's Kosmos.exe unchanged.
2. Tests pin the new words and pin the old contradictory sentences absent; they fail against the
   old script (negative control).
3. tools/windows/README.md no longer quotes the old READ ME words, and what it claims (a second
   launch signs an open window in again) is still true for a Start menu launch.

## Why the claim stays true

The Start menu shortcut (KosmosLauncher.cs, IShellLink SetPath(exe)) points at the installed
%LOCALAPPDATA%\Programs\Kosmos\Kosmos.exe, measured on this box. The single-window lock and the
Show message are named by board port (BoardWindowName(port)), not by exe path, so a Start menu
launch is the same second launch that triggers SignInAgain via --print-url.

## Out of scope (separate surfaces)

Launcher messages (KosmosLauncher.cs) and board/engine copy that still say "double-click
Kosmos.exe in your Kosmos folder" or "open Kosmos.exe again". Listed in the PR report.

## Status

- [x] READ ME wording changed (tools/build-kosmos-windows.sh)
- [x] tools/windows/README.md line reworded
- [x] tests updated (tools.build-windows-570.test.js, tools.win-launcher-native.test.js)
- [x] negative control: old script fails 2 tests with the new pins
- [x] zip built from the worktree and READ ME printed

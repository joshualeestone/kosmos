# nodecheck-9144: a Windows runtime that crashes on every run is found, said plainly, and repaired (kosmos#9144)

## The fault (Homer, the Windows box, 11-26; Baron's analysis on the card)
runtime\node.exe died on every run (even `node -e 1`, exit 139) while a byte-identical COPY ran clean. Ruled out by
measurement: bytes, signature, Mark of the Web, name and folder, IFEO, Defender. Most likely cause: a damaged page in
Windows' cached IMAGE of that one file; a copy is a new file, so a new image, which is what fixed it. Today the launcher
says "stopped unexpectedly, try again" (wrong: trying again fails the same way), and a board that dies seconds into
each start under its logon task, after the hand-off, is never seen at all.

## Build (Baron's 10:1x design; the calls made here are marked DECIDED)
1. Main, after the runtime and server files are found and before the installer duties (which run node too): one
   `runtime\node.exe -e 0`. Not 0 => offer Repair. DECIDED: a check that does not finish in 30 s says nothing and the
   launch goes on (fail open: this must never stop a working Kosmos); a runtime that will not start at all counts as
   damaged (the board would fail the same way). Not for --window (the main launch already checked) or --uninstall.
2. Repair (RepairRuntime): copy runtime\node.exe to runtime\node-repair.exe (DECIDED: an .exe name, so Windows runs it
   as a program), check its sha256 against the manifest, check the copy runs `-e 0` (strictly 0), rename node.exe to
   node.exe.damaged-<yyyyMMdd-HHmmss>, rename the copy to node.exe, run the check once more. Any step that fails says
   which, removes the copy, and points at a restart (which clears the cached image) or a fresh download.
3. DECIDED: the manifest gets a top-level `runtime_node_sha256` (tools/build-kosmos-windows.sh, from the staged
   runtime\node.exe). Baron's note assumed the manifest already lists every file's sha256; the installed manifest.json
   has only the Node zip's download hash. Builds made before this have no key: the repair then checks only that the
   copy runs.
4. After the hand-off (the board's server.js exits 0 having handed to its logon task, not served here): look for a
   listener on the board's port for up to 90 s (DECIDED: generous, since a false alarm tells a person a working
   Kosmos is broken; a first boot can take a while). Nothing listens => check the runtime again and offer the same
   Repair, worded for "did not start". Only for a person at the desktop.
5. `Kosmos.exe --repair-runtime`: the same repair, for a console run.
6. Messages: one plain sentence of what is wrong, what Repair does, Yes as the default (unlike AskYesNo, which guards
   removals).

## Review 1 (opus): the repair targeted the wrong copy
The file that crashed on the box was the ANCHORED copy, <LOCALAPPDATA>\Kosmos\runtime\node.exe (win32anchor.anchorDir),
which the logon task's board and every agent run, and which ensureAnchored re-copies only when its SIZE differs. The
first build checked and repaired only this folder's runtime\node.exe. Now both are checked; the anchored one is repaired
from this folder's (once that checks out). Also from the review: damaged means it RAN and ended non-zero (a runtime
Windows will not start keeps Windows' reason and is never renamed); No goes on with the launch; the after-hand-off look
speaks only when the anchored runtime fails its check (a slow healthy board says nothing); crash dialogs are off for the
check (SetErrorMode); per-process copy names; one kept damaged copy; a failed swap that leaves no runtime says so; a
sha256 mismatch points at a download, not a restart; the probe keys its fake on the file ID (NTFS tunnelling defeats a
creation-time key).

## Tests
tools.win-launcher-runtime-9144.test.js: the source (the order in Main, fail open on a check that did not finish, the
repair's step order and what each failure leaves, the after-hand-off look only for a hand-off, the flag, the manifest
key from the staged file, no C# 6), plus a Windows-only probe compiled beside the launcher that drives RepairRuntime
against fake runtimes (one that exits 139, one that exits 0, a mismatched sha256). The probe runs on the box (Homer).

## Weakest premise (Baron's, kept)
That a pre-flight `-e 0` catches the fault. Homer's bad copy ran and died at exit, so it should; a fault on a page only
a longer run reaches would pass it, which is what the after-hand-off look is for.

## Out of this card
- The settling test of the cause (run node.exe.bad-1126 after the next natural restart), Homer's.
- Kosmos.exe must be rebuilt and signed on the Windows box from this source before it can ship (#6512's tripwire).

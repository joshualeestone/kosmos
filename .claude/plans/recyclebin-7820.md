# recyclebin-7820: Windows "Delete what is left" uses the Recycle Bin (kosmos#7820)

## Problem
On win32 `TRASH()` resolved to `%USERPROFILE%\.Trash`, which Windows does not have, so `trashCanTake` answered
false and every Windows leftover folder was deleted for good.

## Design (also on the card)
1. `trashCanTake(p, 'win32', measure)` asks one PowerShell probe about the folder's drive (its real path), kept a
   minute per drive: its type and size, the NoRecycleFiles policy, and the volume's NukeOnDelete and MaxCapacity.
   The Recycle Bin is offered only for a FIXED drive with neither setting on and the folder within 90% of the limit
   (5% of the drive when no limit is recorded); a folder too big to count, a UNC path, or any answer that is not the
   probe's JSON: no. Otherwise Windows would delete outright, without asking, under a Recycle Bin promise.
2. The move on win32 runs `Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory(p, OnlyErrorDialogs,
   SendToRecycleBin)` through Windows PowerShell. The path is passed in the `KOSMOS_RECYCLE_PATH` environment
   variable, never in the script or the command line.
3. After the call, Node checks the folder is gone (the script's word alone is not trusted), and the script looks for
   the folder in the Recycle Bin, counting items with its name and original folder before and after the call:
   RECYCLED, GONE (deleted, not in the bin) or UNVERIFIED (the bin could not be read). Each has its own sentence.
4. A Scheduled Task is unregistered, not moved, so (like a systemd unit) it no longer decides whether the folder can
   go to the Recycle Bin. A removed Windows agent leaves a folder plus a disabled task, so this is the main case.
5. Words on win32 say "the Recycle Bin" instead of "the Trash". Mac and Linux are unchanged.
6. Rebased over #7819 and #7825 (an agent's settings and picture go with its files): on win32 those records go to the
   Recycle Bin through the same call (DeleteFile for a file), never into a home-made `.Trash` folder, and a record the
   Recycle Bin did not keep gets the same "could not find" sentence as the folder.

## Rejected
- A native shell-API module: a new binary dependency for one call.
- A home-made `.Trash` folder on Windows: nobody on Windows looks there, and Explorer cannot restore from it.

## Weakest premise
That the PowerShell VisualBasic call, and the Shell.Application Recycle Bin read, behave under the board's process
the same as interactively, and that an item's name in the Recycle Bin is the folder's name. Needs the Windows box:
the card parks needs-device after the PR.

## Known limits (stated, not fixed)
- 'OnlyErrorDialogs' still shows error dialogs; a file held open can raise one nobody sees, and the call waits for
  its timeout (120 s). The folder can then be partly in the Recycle Bin; the outcome says so.
- Both calls are synchronous, as the `fs.rmSync` they replace was, and they run in the board's request handler, so
  the WHOLE board waits with them (every page and request), up to 120 s if a hidden error dialog waits. Making the
  delete asynchronous is a change to the route and the page, left for its own card. The drive probe is limited to 5 s and a failed
  look is kept a minute; the move keeps 120 s, because a shorter limit could stop a large legitimate move partway.
- The drive probe reads the folder's real path, so a link onto another volume is judged by that volume. A `subst`
  drive still reports its backing drive's type; if Windows then deletes outright, the after-the-call count says so.
- The Recycle Bin check counts items matching the folder's name and original folder, before and after. Whether
  Explorer's item name equals the folder name under every setting is unmeasured, so "not found" is worded as
  "could not find, may have been deleted for good", never as certain.

- The drive probe also runs when an agent page asks for the plan (every visit to a leftover agent, kept a minute per
  drive), so a cold PowerShell plus the CIM volume query can hold the board up to 5 s; past that it answers "cannot
  take" for the minute. The cold-start time is part of the Windows-box check.
- If the answer changes between the plan on screen and the delete's re-plan, the refusal carries the new plan and the
  page repaints the dialog from it (with the name box), rather than refusing again.
- A full Recycle Bin can purge an older item with the same name and original folder; the count then stays equal and
  the outcome says "may have deleted them for good" about files that are there. A volume mounted into a folder is
  judged by its drive letter's settings, like `subst`.
- With no Recycle Bin settings recorded for the volume (as on a machine that never changed them), NukeOnDelete is
  taken as Windows' default (off). The after-the-call count still reports a delete that did not land.
- Each Recycle Bin count stops after 15 s and then reads "could not check".

- Each record (settings, picture) is its own PowerShell call with its own two Recycle Bin counts, so the board's worst
  case is several times the folder's 120 s, not one. Moving the calls off the board's thread is kosmos#7835.
- The Recycle Bin count matches an item's name with or without its extension (Explorer hides known extensions by
  default, so a settings file shows without `.json`).

- A path Windows hands back in its long form (`\\?\C:\...`) starts with `\\` and is treated like a network path, so it
  keeps "for good". Safe, but it is a downgrade for a very deep folder.

## Tests
`engine/delete-leftover.win32-recyclebin-7820.test.js`, platform-injected with a stubbed PowerShell runner.

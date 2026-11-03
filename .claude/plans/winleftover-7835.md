# winleftover-7835: Windows "Delete what is left" no longer holds the board

Card: kosmos#7835 (follow-ups from #7820's review). Stacked on April's recyclebin-7820 at 4177a30 (one commit on main
67e19ab, PR pending under the 0.7.85 cut hold); rebased onto main once #7820 merges. First built on her 7d9d4f7
(fa7c2d27a0), re-applied here after her rebase added Recycle Bin moves for the settings and picture records.

## Finished looks like
On Windows the board answers every other request while a leftover's drive is probed (agent page) or its folder is moved
to the Recycle Bin (delete). A probe that gave no answer is kept seconds, not a minute. An error Windows raised after the
folder was already gone reaches the step instead of being dropped.

## Change (engine/delete-leftover.js, server.js)
- `runAsync`: run() without holding the board (same seams: test runner, dry run, live-execution gate). Its live half,
  `execAsync`, has the shape of remove.js's (#6173): SIGKILL at the limit, a last timer that answers even when a
  grandchild holds the pipes (so a delete's hold on its name always ends), stdin closed, no exit code for a process
  killed at its limit; plus this module's env and windowsHide.
- The probe's parts shared (`driveOf`, `keepDrive`, `freshDrive`); `recycleBinCanTake(p, m, probe)` with `probe` false
  answers only from a kept probe; `warmDrive` runs the probe through `runAsync` and keeps it, one probe per drive at a
  time.
- `planAsync(name)`: on win32, a plan without probing finds the folder and the settings and picture records,
  `warmDrive` probes their drives off the board, then the ordinary plan reads the kept answers. While a delete of the
  name runs it answers "a delete is running" (ok false) instead of reading files half-moved. Off win32 it is `plan`.
- `del`'s body is `delSteps`, a generator that hands out only the Windows moves (`yield { recycle }`: the folder's and,
  through `moveRecords`, now also a generator, each record's); `del` performs them in place (unchanged behaviour),
  `delAsync` awaits `recycleAsync`. The drives a delete warmed are pinned (kept as fresh) until it ends, so its own
  re-plan never starts the probe again on the board's thread when a short keep runs out in between. Every other step (community standing first, the job,
  the records, tokens, community account) runs in the board's own thread in the same order, so in-memory state each
  module keeps (sender tokens, liveness, crash history) is cleared where the board reads it.
- `delAsync` refuses a second delete of the same agent while one runs (its steps would interleave now that the move
  does not hold the board), and `deletingName` says so to engine/create.js and to remove.js (restore, remove, restart
  and restartAsync, so Start too), which refuse that agent meanwhile: otherwise the delete's last steps (tokens,
  records, history) would land on a live one. Not in remove.js's busyRefusal, which delete-leftover asks itself. The hold is keyed as create folds a name (slugFor), so every spelling of the agent meets it.
- Item 2: `DRIVE_FAIL_KEEP_MS` 5 s for a probe with no answer; a good answer is still kept a minute.
- Item 4: a `FAILED` line with the folder already gone is the step's `note` ("Windows said: ..."), outcome unverified.
- Routes: GET `/leftover` awaits `planAsync`, DELETE awaits `delAsync`.

## Rejected
- A worker thread running the whole module: del clears other modules' in-memory state (sender tokens among them),
  which in a worker would be cleared in the worker's copy while the board kept the old one.
- Moving the folder before del: del resets the community standing first on purpose (a retry cannot reach it once the
  folder and job are gone).
- The card's "in progress + poll" page: the route now simply answers when the move ends, and the board answers
  everything else meanwhile. Residual: a proxy in front of the board (Kosmos+) may cut a request held over its limit;
  the delete still finishes, and the page shows the result on its next read.
- Item 3 (the Recycle Bin count can read a real recycle as "may have been deleted" if the bin changes between counts):
  decided to keep. A check keyed on something unique needs either the bin's deletion time (the #7820 plan says why
  clocks are not compared) or renaming the folder before the move, which would bring it back from the Recycle Bin under
  a name the person never gave it. The wording it produces is already hedged ("may have"), so it is never a false
  promise.

## Still on the board's own time (not this card's item 1)
The plan itself (the folder measure, the roster reads; twice on Windows, once to find what to probe) and Task
Scheduler's removal of a startup job (schtasks, up to 20 s) still run synchronously in a Windows delete.

Also not covered: an account move that starts while a delete is waiting (delSteps asks remove.moveRefusal once, before
the move). Residual, narrow: an account move holds the agents it restarts, and a leftover is not running.

## Weakest premise
Not run on Windows: the async path is driven from a Mac through the run() seam, as #7820's tests are. A real
`execFile` of PowerShell with a timeout is assumed to behave as execFileSync's does for the answers recycleOutcome reads.

## Tests
engine/delete-leftover.offthread-7835.test.js (13): a 20 ms timer keeps ticking while a late probe and a late move run;
the async delete says what del says; a second delete refused; failed probe kept 5 s, good one 60 s; late error kept; off
win32 the async forms are plan and del; while a delete runs the plan says so and create refuses the name; a move that
throws lets go of the name; the live runner closes stdin and answers at its limit with no exit code; every spelling of
the agent meets the hold and a restore is refused; its settings move off the board with the same answer as del; Start,
Restart and Remove are refused while it runs; a no-answer probe whose keep runs out mid-delete is not asked again
on the board, and the pin ends with the delete. Mutants (stdin
open, create not refused, plan mid-delete, lock not released, sync move, a minute's keep, note dropped) each fail it.
Leftover tests 154 pass; create tests 545 pass; web.delete-leftover's route pin updated to the async calls.

# win32 keep-alive + the durable anchor (#570)

Written 2026-09-07 after a Bun crash lost the working session. The original
four-phase plan was recovered from Slack; this records where it actually stands
and what the keep-alive slice adds to it.

## The four phases, as planned vs. as landed

| Phase | Planned | Actual |
|---|---|---|
| 1 | launch substrate (`engine/win32launch.js`) | landed `6538c46a` |
| 2 | wire it into `create.js` | landed `6b3c6496` |
| 3 | dress rehearsal: 3-4 agents in worktrees, roster shows all, each reports, each stops and restarts | PARTLY DONE -- see below |
| 4 | the flip: `SUPPORTED` gains win32 "because it has earned it" | landed `e3870c49` |

🛑 PHASE 4 LANDED BEFORE PHASE 3. win32 is marked supported on the strength of
the substrate EXISTING, not on a fleet having been run. The two download gates
were split (`platform.js`) so this refuses a download rather than promising
agents, which is why it is a gap and not a lie -- but the earning step is the one
that got skipped, and Phase 3 is still owed.

## What keep-alive adds (not in the original four)

The flip made "a Windows agent does not survive a reboot" untenable, so the slice
after Phase 2 is the launchd analog, split by where each half belongs:

    RunAtLoad ............. engine/win32job.js         (an at-logon Scheduled Task)
    KeepAlive + Throttle .. engine/win32supervisor.js  (the respawn loop, in code)

Both are written and green (15/15). Phase 3 CANNOT be rehearsed until they are
wired, because "each can be stopped and restarted" is exactly the wiring that is
missing: `remove.js` has zero win32 branches and still reaches for `launchctl`.

## The anchor, and why the task cannot point at the app

⚠️ THE LOAD-BEARING DEFECT, and it is not only node. A Scheduled Task is DURABLE;
the Windows bundle is a PORTABLE ZIP the person extracts wherever they like, into
a versioned folder (`kosmos-0.6.24-win-x64`). `taskCommand` used
`process.execPath` for node and `__dirname` for the supervisor -- and BOTH resolve
under that same extract root:

    <extract-root>/runtime/node.exe      <- process.execPath
    <extract-root>/app/engine/           <- __dirname

So an update (extract a new folder, delete the old) leaves every registered task
pointing at a path that no longer exists, and the whole fleet silently fails to
come back at the next logon. Pinning node alone fixes nothing: the supervisor
script dies with it.

🔑 THE FIX IS THE MAC'S OWN PATTERN. `install/setup.sh` copies `bin app runtime`
out of the bundle into a durable KOSMOS_HOME, and kosmos#1139 taught the
supervisor where the engine lives via an `engine-path` POINTER FILE. Windows has
no installer doing the first half, so `engine/win32anchor.js` does both:

    <LOCALAPPDATA>/AgentWorkforce/runtime/
        node.exe            a copy, so the task's interpreter is durable
        engine-path         a pointer to the CURRENT app engine dir
        supervisor-boot.js  a tiny durable shim: read the pointer, run the supervisor

The task command becomes `"<anchored node>" "<anchored boot>" <args>` -- no path
under the extract root survives into the registered task.

⚠️ LOCAL APPDATA, NOT ROAMING, and that is a deliberate split from `store.js`.
The data root roams on purpose (a person's config should follow them to another
machine on a domain). node.exe is 92 MB and machine-specific; putting it in a
roaming profile would be a real harm to a domain user. Config roams, the runtime
does not.

🔑 ONE POINTER FILE, EVERY TASK. The pointer is shared and durable, so refreshing
it once moves every registered agent to the new app -- rather than re-registering
N tasks per update. That is the property that makes this scale to 8-12 agents.

📌 THE REMAINING STALENESS WINDOW, stated rather than hidden: the pointer is
refreshed when a job is installed. If the app moves and NO agent is created
afterwards, the pointer is stale until the next install. Refreshing it at server
start on win32 closes this and is the next follow-up, not this slice.

## Wiring (Splinter's next actions)

1. `create.js` win32 branch: call `win32job.install()` after a successful launch,
   and fix the `because` string -- it currently promises LESS durability than we
   now have ("does NOT come back by itself yet").
2. `remove.js`: win32 branches so stop/delete/restore reach
   `win32job.disable/remove/enable` instead of `launchctl`.
3. Retire the two stale comments (`create.js` "keep-alive is the next slice",
   `platform.js` "does NOT yet survive a reboot") once 1 and 2 are true.

## Fleet note

main is RED on `web.change-dialog.test.js` from #2463 (fix in flight on
`fix-change-dialog-control-drift`). A red gate on this branch is that, not this
work. Do not gate win32 progress on green main until it lands.

---

# CHECKPOINT -- read this first after a crash

⚠️ THIS SECTION IS THE LIVE STATE, not the design. Update it at the END of every
step, before starting the next one. The 2026-09-07 Bun crash cost a session
because four finished files sat uncommitted with nothing on disk saying what they
were for. The rule that prevents a repeat is: FINISH A STEP -> UPDATE THIS ->
COMMIT. A green step that is not committed does not exist.

## How to resume
1. `git log --oneline -8` and `git status --short` -- committed work is the truth.
2. Read the step table below for the first line that is not DONE.
3. Run the suite for this slice (the exact command is under "Running the tests").

## Running the tests
🛑 THERE IS NO node OR bun ON THIS BOX'S PATH. The only interpreters are the ones
bundled inside extracted Kosmos builds. This is very likely why Bun dropped the
session to a bare prompt. Use:

    C:\Users\joshu\build-out\extract\runtime\node.exe --test engine/win32*.test.js

## Steps

| # | Step | State |
|---|---|---|
| 0 | `win32job.js` + `win32supervisor.js` written, 15/15 green | DONE (was uncommitted at the crash) |
| 1 | `win32anchor.js` -- durable node + engine pointer + shim | DONE, 8/8 green |
| 2 | `win32job.install()` anchors before registering | DONE, 18/18 green |
| 3 | `create.js` win32 branch calls `win32job.install()`, `because` fixed | DONE, 6/6 green |
| 4 | `remove.js` win32 branches: stop/delete/restore -> disable/end/enable/start | DONE, 6/6 green |
| 5 | retire the two stale comments (`create.js`, `platform.js`) | DONE |
| 6 | PHASE 3 dress rehearsal: 3-4 agents, roster, stop + restart each | TODO |
| 7 | follow-up: refresh the pointer at server start on win32 | NOT THIS SLICE |

## Open questions owned by Josh (neither blocks the code)
- Windows Memory Diagnostic, for the 2026-09-04 `0x124` CPU machine check. Wanted
  BEFORE sustained multi-agent load, not after.
- A second DIMM. Caps how many agents Phase 3 can rehearse (3-4 now, 6+ with it);
  changes nothing about correctness.

## Asked of Splinter, not yet answered
The account/memory mechanism. Memory lives INSIDE the config dir, so if switching
accounts means switching `CLAUDE_CONFIG_DIR`, memory does not follow -- a
different account is a different `.claude` and an empty memory. Structural, not a
vague risk. Adopt the Mac's spelling rather than inventing a sixth.

## Fleet note
main is RED on `web.change-dialog.test.js` from #2463 (fix in flight on
`fix-change-dialog-control-drift`). A red gate on this branch is that, not this
work.

## Correction: Phase 3 was PARTLY done, not skipped

`engine/platform.js` records a measurement I had written off: "Measured on a real
Windows box 2026-09-07: four agents launched concurrently, all four live on the
board under their RECORDED names, all four credentialed, clean teardown."

So the launch-and-roster half of the dress rehearsal HAPPENED. What is still owed
is the other half of the sentence -- "each can be stopped and restarted" -- which
is precisely what step 4 (`remove.js`) unblocks. Phase 4 flipping before Phase 3
is therefore a smaller overstep than it first looked: what it ran ahead of was
stop/restart, not visibility.

## remove.test.js is PRE-EXISTING RED on Windows (measured, not assumed)

`engine/remove.test.js` builds real agents through launchd- and tmux-shaped
fixtures, so on this box it fails for reasons that have nothing to do with #570:

    parent commit, remove.js untouched .... 11 pass / 50 fail
    with the win32 job dispatch ........... 13 pass / 48 fail

Verified by stashing the change and re-running. The port fixes two and breaks
none. Porting those fixtures is a much larger piece of work than the branch under
test, so the new branches are pinned directly in
`engine/remove.win32-job-570.test.js` instead -- which asserts the DISPATCH from
either platform rather than fighting the fixtures.

📌 FOLLOW-UP WORTH A CARD: remove.test.js's fixtures are the last Mac-only
assumption in this lane. Until they are ported, a Windows box cannot run the
removal suite end to end.

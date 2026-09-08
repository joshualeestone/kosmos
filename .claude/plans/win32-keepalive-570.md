# ⚑ RESUME HERE -- win32 keep-alive (#570)

Last updated 2026-09-08. If a session died, read THIS BLOCK FIRST, then the
checkpoint table further down. Everything below the block is design rationale and
does not need re-reading to continue.

## Where it stands right now

    branch  win32-supported-flip-570   PUSHED through f2a11695
    tests   46/46 green on the win32 slice
    tree    clean

Committed and pushed:

    fc79bb43  win32anchor -- a task must outlive the app that registered it
    d93b00ed  create -- a Windows agent comes back at every login now
    f2a11695  remove -- stop/restore/restart reach the Scheduled Task

## 🛑 THE ONE BLOCKER: this branch is 74 commits behind main

`#2439` (`87b9f8ef`, on main) renamed the store directory `AgentWorkforce` ->
`Kosmos` WITH A DATA MIGRATION, while this branch was in flight. It is the
highest-risk thing about merging, because it moves the tree every agent's data
lives in and this branch's win32 work derives paths from it.

`engine/win32anchor.js` is already prepared: it reads `store.APP` rather than
carrying a copy, with a fallback to the old name that is dead the moment main is
merged, and `win32anchor.test.js` pins the delegation so a re-added copy goes red.
Nothing else on this branch is known to collide -- but 74 commits were not
reviewed one by one, so the merge is real work, not a formality.

🔑 MERGE MAIN BEFORE THE PHASE 3 REHEARSAL. A rehearsal on a 74-behind branch
proves the fleet works in a world that is not the one shipping, and the store
rename in particular would invalidate it.

## The order to do things in, and why

1. **Windows Memory Diagnostic** (Josh, ~30 min, reboots the box). The 2026-09-04
   `0x124` was a CPU machine check that was never followed up. Do this BEFORE
   sustained multi-agent load, not after: discovering bad RAM by way of 10 agents
   behaving strangely costs a day of chasing ghosts in the wrong layer.
2. **Merge `origin/main`** into this branch and get the win32 slice green again.
3. **Phase 3 dress rehearsal** (below).
4. Follow-up card: refresh the engine pointer at server start on win32.
5. Follow-up card: port `remove.test.js`'s launchd/tmux fixtures so a Windows box
   can run the removal suite end to end.

## The Phase 3 rehearsal, written out IN ADVANCE

Written before running it on purpose, so a failure halfway has a map instead of a
memory. Recovered from Slack, the original Phase 3 was: "3-4 agents in worktrees
on this box. Roster shows all of them, each reports, each can be stopped and
restarted."

| # | Step | Passes when |
|---|---|---|
| R1 | create 3 agents in worktrees | three folders, three sessions, no refusals |
| R2 | board roster | all three visible under their RECORDED names |
| R3 | each reports | three agents heartbeating, each credentialed |
| R4 | stop one | `schtasks /Query` shows it DISABLED, and it stays gone |
| R5 | restart it | it comes back, and reports again |
| R6 | remove one | task DELETED, agent gone, Restore offered |
| R7 | restore it | task re-registered and enabled, agent back |
| R8 | **reboot** | all remaining agents return AT LOGIN, unattended |

⚠️ R8 IS THE ONE THAT MATTERS AND THE ONE NEVER YET RUN. Everything before it has
either been measured (four agents launched concurrently, 2026-09-07, recorded in
`platform.js`) or is unit-tested. R8 is the whole point of the keep-alive slice
and it has no test that can stand in for it -- an at-logon task fires at LOGIN, so
somebody has to actually sign in.

## If the rehearsal half-fails: how to clean up

State this box can be left in, and how to clear it by hand:

    # what did we register?
    schtasks /Query /FO LIST | findstr /C:"Kosmos"

    # remove one agent's job (this is what remove.js does for you)
    schtasks /Change /TN "Kosmos\agent-<name>" /DISABLE
    schtasks /End    /TN "Kosmos\agent-<name>"
    schtasks /Delete /F /TN "Kosmos\agent-<name>"

    # the anchor (safe to delete; it is rebuilt on the next job install)
    #   <LOCALAPPDATA>\AgentWorkforce\runtime   before the #2439 merge
    #   <LOCALAPPDATA>\Kosmos\runtime           after it
    # holds node.exe (~92 MB), engine-path, supervisor-boot.js

📌 A HALF-REHEARSED BOX IS NOT DANGEROUS, just untidy: a registered task with no
agent starts a supervisor that finds nothing to adopt and launches one, which is
the designed behaviour. The thing to actually avoid is leaving a task registered
that points at an anchor you deleted -- it fails silently at logon. Delete tasks
BEFORE the anchor, in that order.

## Running the tests on this box

🛑 THERE IS NO node OR bun ON THIS BOX'S PATH -- the only interpreters are inside
extracted Kosmos builds. This is very likely why a Bun call dropped the
2026-09-07 session to a bare prompt and cost hours of uncommitted work.

    C:\Users\joshu\build-out\extract\runtime\node.exe --test engine/win32anchor.test.js engine/win32job.test.js engine/win32supervisor.test.js engine/create.win32-launch-570.test.js engine/remove.win32-job-570.test.js engine/platform.test.js

Expect 46/46. `engine/remove.test.js` is PRE-EXISTING RED here (launchd/tmux
fixtures) -- 13 pass/48 fail is the known-good state, not a regression.

## The working rule that prevents another loss

FINISH A STEP -> UPDATE THE CHECKPOINT TABLE -> COMMIT. The 2026-09-07 crash cost
a session because four finished files sat uncommitted with nothing on disk saying
what they were for. A green step that is not committed does not exist.

---

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
| 6 | merge origin/main (74 behind; #2439 store rename) | DONE -- 89/89 win32 green |
| 7 | PHASE 3 dress rehearsal R1-R8 (see RESUME HERE) | TODO |
| 8 | follow-up: refresh the pointer at server start on win32 | NOT THIS SLICE |
| 9 | follow-up: port remove.test.js fixtures off launchd/tmux | NOT THIS SLICE |

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

## The merge (2026-09-08): what it actually cost

74 commits, and only TWO files were touched on both sides -- `engine/connect.js`
(auto-merged) and `engine/create.js` (one conflict). The conflict was not
mechanical and is worth remembering:

🛑 #1185 ADDED A tmux PREFLIGHT EXACTLY WHERE THE win32 ARM SITS. Resolved with
the win32 branch FIRST and the tmux check below it. A mechanical resolution puts
the check above, which refuses EVERY Windows create with "we could not find the
terminal program Kosmos runs agents in" -- a program the platform does not use.
That is #2304's defect one function over (installedCheck required tmux on every
platform, so a healthy Windows box reported it could not run agents). The
ordering now carries a comment saying so.

🔑 THE #2439 RENAME LANDED FOR FREE, which is the whole argument for delegating
rather than copying. `store.APP` became `Kosmos` and the anchor followed with no
code change: `C:\Users\jo\AppData\Local\Kosmos\runtime`. Two of the anchor's own
TESTS still had the old name written out and went red -- fixed to build the
expected path from `store.APP` too, so the next rename costs nothing again.

Measured after the merge:

    win32 surface (10 files) ......... 89/89 green
    store + connect suites ........... 115 pass / 46 fail
    the SAME suites on clean origin/main  115 pass / 46 fail

The 46 are pre-existing Windows fixture failures, verified by running them in a
scratch worktree at `origin/main` rather than assumed.

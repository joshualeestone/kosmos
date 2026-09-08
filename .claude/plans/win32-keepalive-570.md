# ⚑ RESUME HERE -- win32 keep-alive (#570)

Last updated 2026-09-08. If a session died, read THIS BLOCK FIRST, then the
checkpoint table further down. Everything below the block is design rationale and
does not need re-reading to continue.

## Where it stands right now

    branch  win32-supported-flip-570   PUSHED through 2818532a
    tests   89/89 green on the win32 slice (post-merge)
    tree    clean
    merge   DONE -- level with main as of e1d73fae

R8 PASSED 2026-09-08 on a real reboot: the agent came back at logon with nobody
touching anything. That is the whole point of the slice, and it is now evidence
rather than intent -- see "R8 PASSES" at the bottom of this file.

7b IS DONE TOO: `remove.js` no longer ends an agent by closing a tmux window, so
R4-R7 are runnable for the first time. Next step is running them -- the rehearsal
is now the only thing between this branch and the PR.

## ~~🛑 THE ONE BLOCKER: this branch is 74 commits behind main~~ MERGED 2026-09-08

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

    C:\Users\joshu\build-out\extract\runtime\node.exe --test engine/win32anchor.test.js engine/win32job.test.js engine/win32supervisor.test.js engine/win32launch.test.js engine/win32roster.test.js engine/win32capture.test.js engine/win32create.test.js engine/win32live.test.js engine/win32stop.test.js engine/create.win32-launch-570.test.js engine/remove.win32-job-570.test.js engine/platform.test.js engine/win32-separator-guard.test.js

Expect 121/121. `engine/remove.test.js` is PRE-EXISTING RED here (launchd/tmux
fixtures) -- **12 pass/49 fail** is the known-good state since 7b, not a
regression; the one that moved is explained under "7b DONE" at the bottom.

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
| 7 | PHASE 3 dress rehearsal R1-R8 | R1 and R8 PASS; R6 partial; R2-R5/R7 not run |
| 7a | port createAgentInner's launch block to win32 | DONE -- R1 PASSES on the box |
| 7b | port remove.js's process-ending half off tmux | DONE, 121/121 green -- R4-R7 now runnable |
| 8 | follow-up: refresh the pointer at server start on win32 | NOT THIS SLICE |
| 9 | follow-up: port remove.test.js fixtures off launchd/tmux | NOT THIS SLICE |

## Open questions owned by Josh (neither blocks the code)
- ~~Windows Memory Diagnostic~~ RUN 2026-09-08, "detected no errors" (events 1101
  and 1201). ⚠️ READ THAT NARROWLY: it speaks to the 2026-09-05 `0x1a
  MEMORY_MANAGEMENT`, NOT to the `0x124`, which the logs report as `Processor
  Core` / `Machine Check Exception` / APIC ID 7 -- a CPU-side fault a RAM test
  does not address. If crashes return under multi-agent load, look at
  temperatures and whether XMP is enabled before suspecting the DIMMs again.
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

## R1 BLOCKED (2026-09-08): the create path was never ported

The rehearsal stopped on its first step, and it found what a green unit suite
could not. Running the real thing -- board up, `POST /api/agents` -- surfaced two
defects in sequence:

**1. A THIRD tmux GATE, and this one is the one people hit.** `createAgentInner`'s
preflight loop required tmux on EVERY platform:

    for (const [what, bin] of [[runnerLabel, runnerBin], ['tmux', tmuxBin], ...])

so a Windows create was refused with "we could not find tmux on this computer, so
an agent made now would never start" -- naming a program this platform neither has
nor needs. FIXED, and pinned two ways (a live win32 arm, plus a source pin for the
darwin control, because from Windows the darwin arm refuses earlier at a
launchd-shaped running-agents check).

🛑 THIS IS THE SAME CALL #2304 MADE, FOR THE THIRD TIME. #2304 fixed it in
`machine.installedCheck`; #1185's preflight inside `installJob` was the second
(handled during the main merge by ordering it below the win32 return); this is the
third. THE CLASS IS THE BUG: "tmux is required" is written in three places and
each one had to be found separately, live, on a real box.

**2. `createAgent` HAS NO win32 BRANCH AT ALL -- and this is the real blocker.**
With the gate fixed, the create proceeds and then fails:

    made its folder ................... ok
    wrote its instructions ............ ok
    put the script that starts agents in place  ok
    set it up to keep running ......... ok      <- WROTE A .plist. On Windows.
    started it ........................ FAILED  <- launchctl bootstrap

then rolls itself back cleanly ("we have taken it back off your computer").

🔑 THE SCOPE MISTAKE, NAMED PLAINLY. All of #570's create work went into
`installJob` -- which has NO production caller. It is the adopt/connect entry.
The path a person actually uses is `createAgent` -> `createAgentInner`, which
carries its OWN launchd block (installSupervisor, plistFor, `launchctl
bootstrap`) and no platform branch. Every win32 test in this lane passes while
the button on the board cannot make an agent.

That also means the keep-alive work is not yet reachable from a real create: the
Scheduled Task is registered inside `installJob`, so no created agent gets one.

## 7a -- the next slice, and what it must NOT be

Port `createAgentInner`'s launch block to win32. The win32 arm already exists and
is proven in `installJob`; the work is to reach it from the real path.

⚠️ DO NOT COPY THE win32 ARM INTO createAgentInner. Two copies of the launch
sequence is the defect class this repo has paid for repeatedly (supportdir-2039's
duplicated data-root formula; the three tmux gates above). The two entry points
should share ONE win32 launch+register step.

📌 Verified state at the block: no residue is left by the failed create (folder,
tasks and store all clean afterwards -- checked), so R1 can simply be re-run once
7a lands.

## 2026-09-08, later: R1 PASSES. Two more defects the rehearsal found.

    outcome  created
    atLogin  true
    made its folder ......................... ok
    wrote its instructions .................. ok
    started it .............................. ok
    set it up to start again at every login . ok

Verified against Windows rather than against the return value:

    TaskName:       Kosmos\agent-winreh-2
    Status:         Ready
    Schedule Type:  At logon time
    Run As User:    joshu
    Task To Run:    C:\Users\joshu\AppData\Local\Kosmos\runtime\node.exe
                    "...\Kosmos\runtime\supervisor-boot.js" "winreh-2" ...

🔑 THE TASK POINTS AT THE ANCHOR, not at the extract root. The durability design
is confirmed end to end on a real registration.

### Defect 3: `/SC ONLOGON` REQUIRES ADMINISTRATOR

The single most important finding of the rehearsal, and no test could have found
it -- every schtasks call in the suite is stubbed. Measured unelevated:

    schtasks /Create /SC ONCE     -> SUCCESS
    schtasks /Create /SC MINUTE   -> SUCCESS
    schtasks /Create /SC ONLOGON  -> ERROR: Access is denied.

Task creation is not the problem; that trigger is. `/SC ONLOGON` builds a
LogonTrigger with NO UserId -- "at ANY user's logon" -- which is machine-wide, so
Windows demands elevation. `/RU`, `/IT` and dropping `/RL` were all tried; all
four spellings were denied.

⚠️ THIS WOULD HAVE SHIPPED A KEEP-ALIVE THAT FAILED FOR EVERY ORDINARY USER, at
REGISTRATION, hours before the logon where anyone would look. Kosmos is a desktop
app people run as themselves.

FIXED by registering from an XML definition whose LogonTrigger and Principal both
name the current user -- which needs no elevation and is also the honest shape,
since launchd's RunAtLoad is itself a per-USER agent. Verified unelevated across
all six verbs: create, query, disable, enable, run, end, delete.

### Defect 4: an empty `<UserId>`, caught by its own test

`install` passes the caller's `env` -- which exists so a test can redirect the
ANCHOR to a sandbox, and such an env carries no USERNAME. Read wholesale it
produced `<UserId></UserId>`: a definition schtasks rejects, from a function whose
unit test passed. `taskUser` now falls back to the real environment field by
field, and `install` refuses with a sentence when the user cannot be determined.

Found by the assertion "the trigger names ONE user", which looked like
belt-and-braces when it was written.

## R6 IS PARTIAL: remove.js still closes a tmux window

Removing an agent got the JOB half right (it correctly found no task for an agent
whose registration had failed) and then failed at "closed its window":

    it was not set to start on its own, so there was nothing to turn off  ok
    closed its window                                                     FAILED

On Windows an agent is a spawned process with a hidden console, not a tmux pane,
so the step that ends it is still Mac-shaped. The job-level acts are ported
(win32job.disable/end/enable/start); ENDING THE AGENT PROCESS is not.

📌 NEXT SLICE (7b): port the session-ending half of remove.js. `sessionFor` and
the "closed its window" step are tmux-based. win32 has `win32sessions` (the
ownership record) and the launch returns a pid; that is what a stop should use.

## R8 PASSES (2026-09-08, 18:18): the fleet survives a reboot, unattended

The one step no test could stand in for. The box was restarted for the memory
diagnostic; `winreh-2` was left staged with a live at-logon task, so the reboot
doubled as R8. Nobody typed anything after signing in.

Measured against Windows, not against a return value:

    boot .................. 2026-09-08 18:18:03
    task fired ............ 18:18:46   Last Run Time, Status: Running
    supervisor up ......... 18:18:46   pid 2576
    agent live ............ 18:18:53   pid 12052, status idle, in `claude agents --json`

Seven seconds from logon to a working agent, with no human in the loop.

🔑 THE SUPERVISOR CAME UP FROM THE ANCHOR, which is the durability claim itself.
The registered command Windows actually ran:

    C:\Users\joshu\AppData\Local\Kosmos\runtime\node.exe
    C:\Users\joshu\AppData\Local\Kosmos\runtime\supervisor-boot.js "winreh-2" ...

No path under the extract root appears in it. The shim then resolved
`engine-path` -> `C:\Users\joshu\src\kosmos\engine` and booted the supervisor
from there. So all four untested pieces fired in sequence on the first real
attempt: the task trigger, the durable shim, the pointer indirection, and the
supervisor's launch decision.

⚠️ WHAT R8 DID **NOT** PROVE, stated so nobody reads it as more than it is:

- **The adopt half of adopt-not-replace never ran.** A reboot leaves nothing
  alive, so the supervisor took the launch branch. Adoption is still only
  unit-tested -- it is exercised by restarting the SUPERVISOR against a live
  agent, not by restarting the box.
- **One agent, not a fleet.** R8 was a single agent. The 8-12 target adds logon
  contention -- N supervisors and N `claude` processes starting inside the same
  few seconds -- which nothing here measures.
- **The 30s respawn throttle was not exercised**, because nothing crashed.

📌 R2-R5 and R7 remain unrun, and 7b is what unblocks them: every one of those
steps is a stop or a restart, and stopping still reaches for tmux.

## 7b DONE (2026-09-08): stopping an agent no longer reaches for tmux

`remove.js` ended an agent with `tmux kill-session`, which is what left R6 half
failing and made the Restart button unreachable on Windows. Ported.

    engine/win32stop.js   NEW -- taskkill /PID <pid> /T /F, plus the look-again
    engine/win32live.js   NEW -- the ONE ownership join (see below)
    engine/remove.js      sessionOps(platform), one dispatch, TWO call sites

🛑 THE FILE HAD TWO COPIES OF THE KILL, and that is the finding worth keeping.
`removeInner` and `restartInner` each carried their own `kill-session` +
look-again pair. Porting only the one R6 exercised would have left the Restart
button Mac-only and passing its unit tests -- the same shape as the three tmux
gates. `sessionOps` is now the single dispatch, exported so a Mac can assert the
win32 arm.

🔑 THE OWNERSHIP JOIN WAS ABOUT TO BE WRITTEN A THIRD TIME. `win32roster` (emit
the board's rows) and `win32capture` (read each row's state) each resolved
recorded-name -> sessionId -> live session, the second under a comment promising
it stayed "BYTE-IDENTICAL" to the first -- a promise no test held. A stop needs
the same resolution to find a pid, so that would have been copy three, in the
module that KILLS A PROCESS. Extracted to `win32live.byName`, and the promise is
now a test that runs both and asserts the key sets are equal.

### Defect 5: the ownership record outlived the session it described

On the Mac the tmux `@kosmos_agent` option dies WITH the session, so an ownership
claim cannot survive the thing it names. Here the record is a FILE. Restart ends
one session and lets the supervisor start another under the same name, so without
forgetting, two sessionIds carry one name and the join picks between them
silently. `win32capture` had already written this hazard down and correctly said
it was unreachable "until the win32 create/restart flow is wired" -- 7a wired
create, 7b wires restart, so it became reachable in this slice. `win32stop.end`
forgets the session it ended.

### The new kill is behind #1598's gate

`taskkill /F /T` is `tmux kill-session` on this platform, and #1598's header names
that verb as exactly what it exists to keep away from an operator's live fleet. A
brand-new module that shells a forced tree kill was not going to be the one hole
in a fail-closed design, so it opts in the same way `remove.js` does.

### Measured, not assumed

    win32 surface (13 files) ......... 121/121 green
    delete-leftover / disconnect-agent  identical to HEAD (8/1 and 2/4)
    remove.test.js ................... 12 pass / 49 fail  <- WAS 13/48

⚠️ THE remove.test.js BASELINE MOVED BY ONE, and it is not a Mac regression. The
test is `a partial about an agent with no startup job does not claim one was
turned off`. Its fixture is tmux-shaped: it stubs a kill that succeeds over a
session that survives, and expects PARTIAL. On a WINDOWS box that test now
correctly takes the win32 arm, which asks the real machine whether anything named
`jobless-partial` is running, is truthfully told no, and reports REMOVED. On a Mac
the darwin arm is byte-identical to the code it replaced and the test still
passes. The dispatch it depends on is pinned directly in
`remove.win32-job-570.test.js` (both arms, from either platform), which is this
lane's standing answer to a Mac-only fixture.

📌 So `remove.test.js`'s known-good state on this box is now **12 pass / 49 fail**.
The porting card (step 9) is what actually fixes it.

### Verified live against the running agent (read-only)

The join was run against this box with `winreh-2` up, and it shows the property
the design turns on:

    winreh-2 -> { sessionId: ab6c422a-..., pid: 12052, liveName: "winreh-2-2f" }

The RECORDED name and the LIVE name are different strings, joined through the
UUID. And the operator's own Claude session (`joshu-4c`, pid 7900) is absent from
the map -- fail-closed ownership, confirmed on a real machine rather than a
fixture. Nothing was killed: this was `resolve`, not `end`.

📌 R4-R7 ARE NOW RUNNABLE AND HAVE NOT BEEN RUN. The kill path has unit tests and
a live read, but no live KILL has happened yet. That is the rehearsal, and it is
the last thing owed before the PR.

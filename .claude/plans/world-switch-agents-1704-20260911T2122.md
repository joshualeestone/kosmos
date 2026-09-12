# Plan: world-switch-agents-1704 (PR3 of the named-world agents plan)

Parent plan: `.claude/plans/world-agents-1704-20260911T2145.md`, section 4 and the PR3
entry in section 8. Josh's decisions 2 and 5 govern: the switch dialog ASKS EACH TIME
(pause this Kosmos's agents, or keep them running), and his modal wording stays, with
only the minimal choice added.

## What

1. `POST /api/worlds/active {id, agents: 'pause'|'keep'}`.
   - An absent `agents` means `keep`, which is today's behaviour, so an older page
     that does not send it behaves exactly as before.
   - Any other value is a 400 with a sentence.
   - The response adds `agents`, `paused: [names]`, `notPaused: [{name, because}]`.
2. The route order is: validate the id, then PAUSE (a real switch with `pause` only),
   then `setActiveWorld`, then respond, then self-restart as today. If
   `setActiveWorld` throws, the agents just paused are resumed and the classified
   error is returned.
3. `engine/worldstarts.js` (new) owns the record, the pause, and the resume.
4. `server.js` calls `worldstarts.drainAtBoot` once the real board is listening
   (after `allowLiveExecution()`), in the `require.main` block.
5. The switch modal gets a two-option radio group, and `worldswSwitchGo` posts the
   choice.
6. The browser check `render-worldswitch-2238.js` asserts the labels, the missing
   default, the enable logic and the posted body.
7. The stale route comment in server.js describes the pause/keep flow.

## Decisions (where the parent plan left latitude)

- **Where the record lives.** It is `<store.ROOT>/world-starts.json`. `store.ROOT` is
  the BOOTED world's store. At pause time that is the world being left, and at boot
  time it is the world being opened, so one path serves both halves with no
  cross-world path arithmetic. Written atomically (temp file plus rename).
  Shape: `{entries:[{name, why:'paused', at, because?}]}`.
- **Which agents are paused.** These are the `safeRoster()` cards (removed agents are
  already off it).
  - A card is paused only when it is tied to its name (`isNamedOurs`), its name is
    safe to act on (`remove.unsafeToActOn`), and Kosmos has a launch job for it
    (`remove.jobFor`). Every other card goes to `notPaused` with a sentence, and it
    keeps running.
  - A tied agent that has a job but no running session is paused too (disabled and
    recorded). Its logon trigger (RunAtLoad on a Mac) would otherwise start it while
    another Kosmos is showing.
- **The pause reuses remove.js.** For each agent, in order:
  - `jobOps(platform).disable`;
  - then `stopNow`;
  - then `sessionOps(platform).end(session)`, when a session is running;
  - then `disruption.begin(name, 'restart')`, the record `restartInner` writes, so the
    board shows restarting rather than gone for the moments before its own restart.

  There is no `recordRemoval`, so the agent is never marked removed. Nothing new is
  exported from remove.js: `jobOps`, `sessionOps`, `jobFor`, `unsafeToActOn` and
  `isRemoved` are already exported.
- **Write-ahead.** The entries are written before any stop, and a failed write pauses
  nothing (every name goes to `notPaused`).
- **Partial failure.**
  - If `disable` fails, nothing changed for that agent: its entry comes out and it goes
    to `notPaused`.
  - If `disable` worked and the stop or the session end failed, the agent is still
    running but disabled. The pause undoes the disable (`enable`). If that works, the
    entry comes out.
  - If the undo also fails, the entry is KEPT with a `because`, so the next boot of this
    Kosmos re-enables it. Dropping it would leave an agent that never starts at login
    again.
  - In every one of these cases the agent is reported in `notPaused`.
- **The live-execution gate.**
  - `pauseForSwitch` and the resume check `liveExecutionAllowed()` before touching
    anything, because `win32job.run` is not gated itself.
  - When the gate is off, they call `refuseOrWarn`. That warns on stderr in production.
    In a test process it throws, and the throw is converted into a refusal carrying its
    message, never a faked success.
  - They write nothing and stop nothing. A refused pause reports every name in
    `notPaused` and the switch still proceeds; the agents keep running, which is the
    keep-running outcome that PR2 makes safe.
- **Rollback.** When `setActiveWorld` throws after a pause, the route calls
  `worldstarts.resumeNames(paused)`, which is the resume path restricted to those
  names, and returns the classified error.
- **A no-op switch resumes this world's paused agents.** A pause-switch on a board that
  cannot self-restart, followed by a switch back to the world it is still serving,
  would otherwise leave that world's agents stopped with no boot coming. The board is
  serving that world, so it counts as "opened again". The call returns at once when
  there are no paused entries, so it costs nothing on every other no-op switch.
- **The #2849 interaction (`namedWorldSpawnRefusal`).** Resuming an agent re-enables a
  launch job in the world being booted, which is a spawn by another route.
  - `drainAtBoot({spawnRefusal})` takes the refusal as a function, and server.js
    passes `namedWorldSpawnRefusal` itself. That is ONE derivation of "may agents
    start here", pinned by a source test.
  - While it refuses, every entry is held with the refusal's sentence as its
    `because`. The entries are not dropped, so they resume at the first boot after
    the guard is lifted.
  - The same refusal gates the no-op resume and the rollback resume.
- **Resume, per entry.**
  - A removed agent (`remove.isRemoved`) is skipped and its entry cleared: the
    removal owns it now, and restore re-enables it.
  - Otherwise it is `enable` then `startNow`, and a success clears the entry.
  - A failure keeps the entry with `because`, to be retried at the next boot. That
    covers a missing job, which may be an unreadable Task Scheduler rather than a
    deleted task.
- **Test seam.** `worldstarts.setPlatformForTests(p)` lets the route test drive the Mac
  arm through `remove.setRunner` on any host. It is EXCUSED in engine.reachable with
  a reason.
- **UI.**
  - Josh's `<h2>` and the name-appending are unchanged.
  - Under it sits a `<fieldset>` with a visually hidden `<legend>`, and two
    `<label>`-wrapped radios: "Pause this Kosmos's agents" and "Keep them running".
  - Neither radio is preselected, and "Restart Kosmos" stays disabled until one is
    chosen. Opening the modal resets both.
  - Cancel keeps its initial focus.
  - `notPaused` becomes one terse sentence that prefixes the `#worldsw-restart`
    status line.

## Tests (each red without its fix)

- Route (`server.world-switch-agents-1704.test.js`):
  - a junk `agents` is a 400, and an absent one means keep (no stop commands);
  - a pause happens only on a real switch, not a no-op;
  - the record exists before the first stop command;
  - `notPaused` on a failing stop;
  - rollback resume when `setActiveWorld` throws (the registry lock);
  - refusal when live execution is off.
- Engine (`engine/worldstarts.test.js`):
  - the record's format and atomic write;
  - the drain skips removed agents, keeps failures and clears successes;
  - the drain holds entries while the spawn refusal refuses;
  - both platform arms' command shapes, Windows (`/Change /DISABLE`, `/End`,
    `/ENABLE`, `/Run`) and Mac (`launchctl disable`, `bootout`, `enable`,
    `bootstrap`, with code 5 read as already loaded), all through the existing stubs.
- Web (`web.world-switch-agents-1704.test.js`): the radios, no default, the button
  enable logic, the payload, and the notPaused sentence, run against the shipped
  functions.
- The browser check scenario J; the existing scenarios pick a radio before confirming.
- Root inventories: engine.reachable (EXCUSED seam), one-derivation (the drain is
  handed `namedWorldSpawnRefusal`), fixture-discipline, server.worldenv-order,
  platform-gate-wiring (`allowLiveExecution` still called once), and
  web.modal-way-out-1316.

## Weakest parts

- **The Mac arm is untested live.** The launchctl `disable`/`bootout` at pause and
  `enable`/`bootstrap` at resume are driven only through `remove.setRunner` stubs from
  this Windows box. A resume racing launchd (bootstrap code 5, already loaded) is
  accepted as success, as at remove.js:427. Angel needs to check it on a live Mac.
- **The #2849 hold is not reachable end to end on a real board yet.** Named-world
  agents are refused creation today, so a paused named-world agent can only exist
  after PR4's import or after the guard is lifted.
- **The browser check could not be run here,** because Playwright is not installed on
  this box. CI's browser-checks job runs it.

## Review log

### Round 1 (2026-09-11): four bugs, one test gap, one nit, all fixed

1. **BUG: on a Mac, a pause from a named Kosmos stopped the DEFAULT Kosmos's agents
   for good.** Mac identity was not world-keyed at the time (PR1m, since merged as
   #2874), so a named board's roster and `jobFor` saw Kosmos 1's agents. The
   record then landed in the named world's store, where #2849 held it forever.
   - Fix: when `namedWorldSpawnRefusal()` is non-null (the ONE rule, reused), the
     route pauses nothing, lists every card in `notPaused`, and still switches.
   - The code comment says to revisit this when #2849 is lifted.
   - Test: route R1-1.
2. **BUG: a `com.<name>.discord` job that another tool wrote (`ours: false`) was
   paused.**
   - Fix: `!job || job.ours === false` goes to `notPaused`.
   - Test: engine R1-2.
3. **BUG: the resume used the fail-open `isRemoved`.**
   - Fix: it now calls `remove.removedNames()` once per pass. When that returns
     `!ok`, every target is held with a `because` and nothing is started.
   - Test: engine R1-3.
4. **BUG: a job that was already switched off was recorded, and the resume turned
   it back on.**
   - Choice: SKIP it (`notPaused`, "was already switched off") rather than record
     it as `wasEnabled:false`, which would be an entry that nothing acts on.
   - The check is `win32job.status(name).enabled` on Windows and one
     `create.disabledJobs()` probe per pause on a Mac. Both fail soft to "not off",
     which is the behaviour before this fix.
   - An agent THIS Kosmos already paused is also switched off. It stays reported as
     paused and its entry is untouched, so a second pause-switch on a board that
     cannot restart itself does not lose it.
   - Tests: engine R1-4, one each for Windows, Mac, and the already-paused case.
5. **TEST GAP: the resume on a switch to the booted world had no route test.**
   - Added route R1-5: the resume itself, and the #2849 hold.
   - Corrected the comment: the page never sends this switch in its normal flow; a
     direct API call reaches it, and so does a page after a switch on a board that
     cannot restart itself.
6. **NIT: comments over-claimed "Restarting".**
   - `DISRUPTION_CAUSE` and the record-write fallback comment now say where the
     label is false: up to `WINDOW_MS` on a board that cannot restart itself, and
     briefly over a still-running agent resumed from a stale entry.
   - A pause-specific cause is left to a separate card.

### Round 2 (2026-09-11): all six round-1 fixes confirmed; one bug and one test gap, both fixed

1. **BUG: the round-1 fast path ("switched off and already on record") treated an
   entry held for retry as a confirmed pause.** How it happened:
   - An agent's stop failed, and the undo of its disable failed too. Its entry was
     kept with a `because`, and the agent was switched off but still running.
   - A later pause from the same Kosmos found the job switched off and reported the
     agent paused.
   - That dropped the diagnostic, and nothing tried to stop the agent again.

   Fix: an entry carrying a `because` is held for retry. It skips the switched-off
   check altogether, and `alreadyPaused` counts only entries without one. Dropping
   it from `alreadyPaused` alone was not enough: the new test showed it then fell
   into "already switched off", which still skipped the stop. So a held entry now
   takes the normal path.
   - The write-ahead rewrites its entry without the old `because`.
   - A successful stop leaves it paused and clean.
   - A failed stop whose undo works drops the entry.
   - A failed stop whose undo also fails gets the `because` back.
   - (Added in round 3.) A failed DISABLE restores the earlier entry, `because`
     and all. The job is still switched off from the earlier failed undo, so
     dropping the entry would leave it off at every login.
2. **TEST GAP.** Added engine test R2, which runs three pauses in a row:
   - the stop and the undo fail, so the entry is held;
   - the stop fails again: the agent is NOT reported paused, a fresh bootout is sent,
     and the `because` is kept;
   - the stop succeeds: the agent is reported paused, and the `because` is cleared.

   The test fails without the fix.

### Round 3 (2026-09-11, a full fresh pass): two bugs, one test gap, one nit, all fixed

1. **BUG: a held entry was DROPPED when its fresh `disable` failed,** so its job
   stayed switched off for good and the diagnostic was lost. For a held entry, a
   failed disable changed nothing: the job is already off.
   - Fix: restore the earlier entry with its `because`. This is the fourth outcome
     listed under round 2.
   - Tests: engine R3 on both the Mac and Windows arms.
2. **BUG: the rollback started agents THIS request did not stop.** `paused` also
   names agents an earlier pause-switch stopped (the round-1 fast path). Rolling
   all of them back after a 409 would undo a pause the person asked for twice.
   - Fix: `pauseForSwitch` also returns `stoppedNow` (only what this call stopped),
     and the route rolls back only those. The rollback comment is corrected.
   - Tests:
     - route R3: a seeded entry, its job switched off, the registry lock held, then
       a pause-switch. No enable or bootstrap is sent, and the entry is kept.
     - engine R3: `stoppedNow` excludes the fast-path agent.
3. **TEST GAP: R2 covered only the Mac.** Added the Windows R2 sequence
   (`winDisabled`, the held entry skipping `win32job.status`), and the fourth
   outcome on both arms (item 1).
4. **NIT: a pause from a named Kosmos with an unreadable roster returned an empty
   `notPaused` and said nothing.**
   - Fix: `roster === null` is now the same 503 on both branches.
   - Test: route R3, using `fleet.blind()`.

### Round 4 (sonnet): NO NEW FINDINGS beyond one NIT, which is fixed. Converged.

- It verified all four round-3 fixes:
  - a held entry is restored when a fresh disable fails, on both arms;
  - the rollback resumes only `stoppedNow`, and `stoppedNow` never reaches the
    HTTP response;
  - the Windows R2 sequence;
  - the unconditional 503 for an unreadable roster.
- It traced every entry-state transition, the registry-lock rollback with a
  fast-path entry, and the response contract. It ran the inventories (reachable,
  one-derivation, platform-gate-wiring, modal-way-out, worldenv-order,
  fixture-discipline) green.
- [NIT] The R3 route test's assertion message said "the earlier pause entry was
  dropped", while the assertion proves it was KEPT. The message now states what
  the test proves.

# win32-agent-job-read

P0 from the Mac/Windows parity audit (2026-09-12): "Windows agents can't change
model, provider or account" (#31) and "Trust & Restart skips its trust step on
Windows" (#32). Both come from the same place.

## Root cause (verified in code, origin/main cfaa273e)

`create.readJob(name, worldId)` (engine/create.js ~849) reads ONLY the launchd
plist at `plistPath(name)`. A Windows agent has no plist; its launch facts ride
the Scheduled Task argv (`win32job.taskExec`, parsed by `win32argv.specFromArgv`).
So on win32 `readJob` returns null for every agent, and:

- `setModel` and `setProvider` refuse with "X was not started by Kosmos, so we
  cannot change what it runs on." (false: Kosmos started it, through its task).
- `setAccount` refuses with "we could not read how X is started".
- `POST /api/agent/:name/trust-and-restart` (server.js ~4471) skips the trust
  write ("this agent has no Kosmos launch job") and restarts anyway.

Also rooted in the same null, and fixed by the same read:
- `accountForAgent` (server.js ~964) answers null, so a Windows card never names its account.
- `status.readCodexSession` answers found:false for every Windows codex agent.
- The two account rename/disconnect guards (server.js ~5994, ~6494) read a null
  job, then `jobMissing` says the task exists, so they go "incomplete" and refuse.
- `remove.js` never forgets a removed Windows codex agent's folder trust (~1154).
- `recordedRunner` falls back to the profile instead of the task.

## Design

1. **readJob gets a win32 arm** (`platform` param, defaulting to
   `process.platform`, the `jobPresence` / `publicView(s, platform)` shape). It reads
   the agent's task through `win32job`, never a new schtasks caller, and maps the
   spec to the same `{ claude, tmux, model, configDir, runner }` shape (tmux null on
   Windows). World-keyed: `readJob(name, worldId)` reads `agent-<name>+<world>`.
   A verdict helper keeps "no task" apart from "could not read the task", so the
   setters can say which.
2. **One cache, widened, not a second one.** Several readJob callers run on the
   five-second poll (accountForAgent, readCodexSession). An uncached win32 arm
   would spawn one `schtasks /Query /XML` per agent per poll, the #2717 defect. The
   existing `CONFIG_DIR_CACHE` is widened to remember the whole task-spec answer.
   `configDirFor` becomes a projection of it. The busting rules are unchanged
   (install and remove forget it, setRunner clears it, a failed read is never
   cached).
3. **One job writer for the setters.** The four plist rewrites (setAccount,
   setCodexAccount, setProvider, setModel) go through one `rewriteAgentJob`. On
   darwin it writes the plist exactly as today, with the same error message. On
   win32 it re-registers the task through `win32RegisterJob` (win32AgentSpec, then
   win32job.install, `/Create /F`). The route's existing `removal.restart`
   (`/End` then `/Run`) then starts the new definition.
4. **Convention 3.** The win32 re-register is a live act, so it runs only when
   `win32job.commandsAreReal()` is true: a runner seam is installed, or
   `liveExecutionAllowed()` is true. Otherwise it calls `refuseOrWarn` and refuses.
   `win32job.run` also never spawns schtasks in a `--test` process with no runner.
   On a Mac that is behaviour-equivalent (ENOENT was already ok:false). On a
   Windows box it keeps a plist-seeding Mac test from reaching the live Task
   Scheduler once readJob follows the platform.
5. **Trust & Restart.** The trust step moves out of the route into
   `create.trustAgentFolder(name, { platform })`, which reads the job through the
   same readJob. The route calls it; the win32 arm is testable from any host.
6. **Messages name the real fault** on win32: no task registered vs a task we
   could not read (with schtasks's reason) vs a re-register that failed (with its
   reason) vs not authorized to change startup tasks. The Mac messages stay
   byte-identical.

## Tests

New `engine/create.win32-job-read.test.js` (sandboxed roots before any require,
every win32job seam stubbed, never the real schtasks, never the real anchor):
- the readJob win32 arm on the default world and on a named world (task name
  `Kosmos\agent-<name>+<world>`), plus absent and unreadable.
- the cache: a second read does not spawn again, and a re-register forgets it.
- setModel, setAccount (claude and codex), and setProvider on win32 reach
  `/Create /F` with the new argv (the XML read inside the stubbed runner), with
  the account and model carried or dropped exactly as the Mac arm does.
- the win32 refusal sentences.
- `trustAgentFolder` on win32 writes the trust entry.
- the Mac arm unchanged: the darwin readJob shape, and setModel writing the plist
  with zero schtasks calls.
- the win32job test-process guard, with child_process stubbed so a reverted
  guard still cannot reach the real schtasks.

Revert controls are done by hand edit, never git checkout. Then the touched
suites run, plus engine.reachable, one-derivation, fixture-discipline,
platform-gate-wiring, win32-separator-guard, create and win32job. The full suite is
compared by name against a clean origin/main (this box has about 820 baseline
Mac-assumption failures).

## As built (additions found while verifying)

- **Injected platforms now reach readJob.** readJob follows the platform, so two
  callers that already take one had to pass it on:
  - `remove.restoreBlockedByMissingAccountDir`: its Mac arm called `readJob(clean)`.
  - `worldimport.launchSpecOf`: its Mac arm did the same. Its separate uncached
    `win32job.taskSpec` arm was a second derivation of the job read, so it now makes
    the one `create.readJob(name, sourceWorldId, platform)` call.
  A Mac-injected test on a Windows host was reading that host's Task Scheduler
  through both.
- **No schtasks from a board a test spawns.** Several server suites stand up a real
  board with `node -e`. That child has no `--test` flag, so the first guard missed
  it, and on this box it queried `/XML` for fixture task names. `win32job.run` now also
  refuses when `NODE_TEST_CONTEXT` is set. Only node's test runner sets it; a probe
  measured it inherited by `-e`, stdin, and spread-env children.
- **Measured on origin/main before this branch.** The suite on this box attempts
  4337 real schtasks calls, including `/Create /F`, `/End` and `/Delete` for
  `Kosmos\agent-ct-*` from `create.trust-configdir-1629.test.js`. A preload blocked
  them for the comparison. The branch guard stops them at the source. The 10
  `Kosmos\board` queries from `engine/win32board.js`'s own runner remain, unchanged
  from main.
- **Expected Windows-host differences.** Tests that seed a plist and then read it
  through a caller with no platform parameter now read the Scheduled Task on a
  Windows host: `accountForAgent`, `status.readCodexSession`, `recordedRunner`. Mac CI
  is unaffected.

## Review log

### Round 1 (opus): not converged, with 1 SAFETY, 1 BUG and NITs. Coordinator decisions applied.

Before this round the coordinator rebased the branch onto origin/main 9ceed247
(66079834). All 8 patches were byte-identical.

**SAFETY: a setter re-enabled a REMOVED agent's Scheduled Task.** Remove (and a
#1704 pause) disables the task. The setters re-register with `/Create /F`, and
`taskXml` always wrote `<Enabled>true</Enabled>`. The model, provider and account
routes do not check `isRemoved`, so the task came back enabled and started at the
next logon. On the Mac a plist rewrite leaves `launchctl disable` in force.
- Fix: `rewriteAgentJob`'s win32 arm reads the task's state first
  (`win32job.presence`), and passes it as `enabled` through `win32AgentSpec` into
  `taskXml`, so the one definition keeps the switch. There is no follow-up
  `/DISABLE`.
- A state that cannot be read refuses the change. So does a task that is already
  gone when the state is queried, while its definition is still remembered. A task
  deleted AFTER that query is recreated by `/Create /F`, which this does not detect.
- Residual race, accepted: another process can change the same task in the
  milliseconds between the state read and `/Create`. The board is the only writer of
  its own world's tasks, so this needs a second board or a hand edit landing in that
  window.
- Creation passes nothing, so its task stays enabled.
- A #1704 paused task is disabled the same way (`worldstarts.jobIsSwitchedOff` reads
  the same state), so it is covered.
- Tests: every setter keeps a disabled task disabled and an enabled one enabled; an
  unreadable state refuses with no `/Create`; `taskXml` honours `enabled: false`, and
  writes true when told nothing. Controls C12, C13, C15 and C16 went red.

**BUG: a Windows codex account change did not reach the codex process.**
`win32launch.childEnv` only ever set `CLAUDE_CONFIG_DIR`, so a codex agent moved to a
named OpenAI home was told "runs on X now" and kept reading `~/.codex`.
- Fix: the key per runner is stated once in the leaf `win32argv.accountEnvVar`, which
  `create.plistFor` now uses (Mac output unchanged). `childEnv` sets `CODEX_HOME` for a
  codex agent with a recorded named home. Both launch call sites pass `s.runner`.
- A default-home codex agent gets no CODEX_HOME written and keeps inheriting as
  before. `CLAUDE_CONFIG_DIR` handling is unchanged for every runner.
- Tests: `childEnv` per runner and home; the key matches the plist's; a codex account
  change round-trips through the registered task into `launchStreaming`'s spawn env.
  Control C14 went red.
- **Live agents affected at their next restart:** ONLY Windows codex agents whose task
  records a named codex home (argument four set). They now get `CODEX_HOME` = that
  home, which is the home they were meant to run on. Default-home codex agents and all
  Claude agents start with exactly the environment they had.
  - One sharp edge: a codex agent whose recorded named home has since been DELETED
    now gets `CODEX_HOME` pointing at a missing folder. Before, it silently used
    `~/.codex`. The probable outcome is that codex refuses to start. That is
    unverified, because there is no codex binary on this box.

**NITs:** reworded the plist-only comments so they name the platform-following job
read: the `setProvider` header item 2, server.js's runner comments (the ninth argument,
two places), and remove.js's `create.readJob(clean)` bullet.

**Verification, round 1.** All runs used the schtasks preload, with APPDATA and
LOCALAPPDATA pointed at scratch.
- Named suites: the reviewer's pattern plus win32launch and win32supervisor, as
  explicit files. Baseline is a git archive of 9ceed247.
  - Baseline: 51 files, 891 tests, 153 fail.
  - Branch: 52 files, 921 tests, 167 fail.
  - By name: 15 new, all of them the known Windows-host set (#2250 recordedRunner;
    the status codex readers #2257, #2413, #2803 and #2906; codex observed recording).
    None is new since round 0.
  - One name fixed: "no file is tracked under a path an unset variable produced".
    The archive baseline has no .git.
  - schtasks attempts blocked: 268 on the baseline, 0 on the branch.
- Unit: the new file plus win32launch, win32job, worldimport and win32supervisor, 184 of 184.
- Revert controls: C1-C3 and C5-C16 went red with byte-exact restores. C4's target line
  was rewritten by the spawned-board guard, which C11 now covers.

### Round 2 (opus): not converged, with 1 BUG, 2 TEST-GAPs, a mild CONVENTION and 2 NITs. Coordinator decisions applied.

Before this round the branch was rebased onto origin/main 04e23b70 (#2971 plus the
v0661 bump), with no conflicts.

**BUG: the switch was read from LIST text.** `presence` decides "disabled" with
`/disabled/i` over the whole localized `/FO LIST` output, including the TaskName and
HostName lines, and round 1 put that on a write path. Probed: an ENABLED
`agent-disabled-bot` read as off, so a setter registered it switched off. On a
non-English Windows a removed agent read as on.
- Fix: a new `win32job.taskEnabled` reads `<Settings><Enabled>` from a fresh,
  uncached `/Query /XML`. That read is shared with the spec parse through one
  `readTaskXml`; there is no second query or decode.
- An absent `<Enabled>` is `TASK_ENABLED_DEFAULT = true`. Microsoft's schema declares
  `settingsType/Enabled` `type="boolean" default="true"`, and the comment cites it.
- Not found gives the existing "no longer in Task Scheduler" refusal. Any error,
  missing Settings, or a non-boolean Enabled refuses (fail closed).
- Callers of the enabled flag, audited:
  - `create.rewriteAgentJob` (the setters): a write decision. Moved to `taskEnabled`.
  - `worldstarts.jobIsSwitchedOff` (a Kosmos switch's pause): a live decision. A
    switched-off agent read as on is paused and recorded, and the resume switches it
    back on. Moved to `taskEnabled`; a failed look is still "not off", as before.
  - No other agent-task caller reads `presence`/`status`'s `enabled`. `presence` now
    says at the code that its `enabled` is display-only.
  - Same class, different module, not changed: `win32board.status()` runs its own
    `/disabled/i` over the BOARD task's LIST output (a machine name containing
    "disabled", or a non-English status). Its readers, `boardrestart.win32CanRestart`
    and `win32board`'s ensure and stop, decide about the board's own task. Named here
    as a follow-up for the board lane.
- Tests: (a) an enabled `disabled-bot` stays enabled, with a control that the LIST
  reader misreads it; (b) the per-setter disabled/enabled arms now run on XML; (c) no
  `<Enabled>` counts as enabled; (d) German LIST text, where a switched-off task
  stays off, with a control that the LIST reader calls it on; (e) an XML read error
  refuses with no `/Create`. `taskEnabled` also refuses a definition with no Settings
  or a non-boolean Enabled. worldstarts has a German-status pause arm.

**TEST-GAPs.**
- The "no longer in Task Scheduler" refusal now has an arm: the definition answers,
  then the state read finds no task. It asserts REFUSED and zero `/Create`.
- The detached `win32launch.launch()` is reached only by `win32supervisor.supervise()`,
  which has no production caller; production runs `superviseStreaming` ->
  `launchStreaming`. It now has an arm anyway: a codex home reaches its spawn env.

**CONVENTION.** `accountEnvVar` moved to a neutral leaf, `engine/accountenv.js`, which
`create.plistFor`, `win32launch.childEnv` and the test require. `win32argv.js` is back
to argv only. No inventory enumerates engine modules by name; `engine.reachable` is
green.

**NITs.** The "vanished" bullet now says exactly what it catches. The live-agents
note now covers a deleted named codex home. The residual race is recorded.

**Verification, round 2.** All runs used the schtasks preload, with APPDATA and
LOCALAPPDATA pointed at scratch.
- Named suites (`run-r2.ps1`, explicit files), with the baseline a git archive of
  04e23b70:
  - Baseline: 52 files, 932 tests, 153 fail.
  - Branch: 53 files, 969 tests, 167 fail.
  - By name: 15 new, the same accepted Windows-host set as round 1, and nothing more.
  - One name fixed: "no file is tracked under a path an unset variable produced". The
    archive has no .git.
  - schtasks attempts blocked: 268 on the baseline, 0 on the branch.
- Unit (the new file, win32job, win32launch, worldstarts, worldimport, win32supervisor,
  engine.reachable): 233 of 233.
- Revert controls, byte-exact restores, all red:
  - C17: the setter back on `presence` (a, d and the vanished arm red).
  - C18: the absent-Enabled default flipped (c red).
  - C19: the vanished refusal removed.
  - C20: the world pause back on `status` (the German pause arm red).
  - C1-C3 and C5-C16 still red. C4 skipped (its target line was rewritten in round 0;
    C11 covers the guard).

## Out of scope, noted

- `remove.restart`'s "was not started by Kosmos" on win32 when schtasks cannot
  answer (jobFor folds unknown into absent). Different reader (`win32job.status`).
- win32job's other write actions (disable/end/start/remove) have no live gate of their
  own. That is existing behaviour, not widened here.

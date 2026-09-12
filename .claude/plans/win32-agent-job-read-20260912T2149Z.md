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

## Out of scope, noted

- `remove.restart`'s "was not started by Kosmos" on win32 when schtasks cannot
  answer (jobFor folds unknown into absent). Different reader (`win32job.status`).
- win32job's other write actions (disable/end/start/remove) have no live gate of their
  own. That is existing behaviour, not widened here.

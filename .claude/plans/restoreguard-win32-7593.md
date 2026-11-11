# restoreguard-win32-7593: a Windows agent in a Restored world starts with git hooks and fsmonitor off (kosmos#7593)

**Posture:** production

## Problem
The win32 half of #5536 slice 4c-1. A world a restore made keeps each project's own `.git` from the backup, and its
`core.hooksPath` / `core.fsmonitor` run commands as soon as the provider runs git there. The Mac supervisor hands such
an agent's pane git's environment config (GIT_CONFIG_COUNT=2, hooksPath /dev/null, fsmonitor false). The Windows
launch (`engine/win32launch.js` childEnv, at its two spawn sites) had no restored-world handling.

## Change
- `restoredLaunch(baseEnv, cwd)`, the Mac supervisor's rule: a named world asks `restoreworld.isRestoredWorld` against
  the real base (`worlds.baseRoot(worlds.preWorldEnv(env))`), failing closed (a throw reads restored); and, whatever
  the world, `restored-world.json` two folders above the agent's absolute folder counts (a link counts; an lstat
  failure other than "not there" counts). The default world is never restored by the first rule. Never throws.
- `childEnv(..., opts)`: `opts.restoredGit` sets the five keys with `core.hooksPath=NUL` (as landedcheck.js uses);
  otherwise all five are deleted in every spelling, so an inherited value never switches hooks off or on. childEnv
  stays a pure function. Every place a Windows agent's environment is built passes `restoredLaunch(process.env, s.cwd)`:
  launch(), launchStreaming(), and the per-turn supervisor for codex, gemini, grok and antigravity (win32codexsup;
  round 1 BLOCKER: the card named only the two spawn sites). An ordinary agent losing inherited GIT_CONFIG_* is the
  card's step 3 and a difference from the Mac pane, which leaves them.
- `restoreworld.RESTORED_MARK` exported so the launch names the mark from its one source.

## Tests (engine/win32launch.restoreguard-7593.test.js, 7; engine/win32launch.restoreguard-wiring-7593.test.js, 5)
childEnv both ways with inherited spellings (any host); restoredLaunch against a real world prepareRestoreWorld made, an
ordinary world, the default world, an unplaceable id (fails closed), the mark beside the agent with a no-mark control,
a relative folder; and step 4 of the card on real git (2.55 on the box): a repo in a Restored world whose own
.git/config sets a hooks folder and an fsmonitor command, each writing a file when run. With the guard neither runs;
the control without it runs both.

## Weakest premise
That the provider's own git runs under the agent's environment. Claude Code, Codex and Gemini spawn git as children
of the agent process, so they inherit it; a provider that ran git through a separate service would not. Same premise
as the Mac half.

## Not covered (by design, same as the Mac)
Hooks and fsmonitor only. A restored .git/config can still run commands through filter drivers, textconv, core.pager,
core.sshCommand, credential helpers or includes; #5536's review screen (4c-2) shows those before the person enables
an agent.

The wiring file drives the real launch(), launchStreaming() and the per-turn supervisor (codex, gemini, antigravity),
each with a restored folder and an unmarked control; removing the supervisor's argument fails its three arms (run).

## Decided (review round 2)
- core.hooksPath=NUL relies on Git for Windows (MINGW) reading NUL as the null device, as the card asks and
  landedcheck.js already does. A Cygwin or MSYS2 git first on PATH would read it as a folder named NUL under the repo
  top (which does not exist, so no hooks run there either; untested).
- A mark that lstat cannot answer for (EPERM, EBUSY, a dead network drive) reads restored, stricter than the Mac's
  `-e || -L` (which reads those as absent), to match isRestoredWorld. The cost is an ordinary agent on such a drive
  losing its own hooks with no line saying so. Kept: a launch has no event channel at that point, and the guard
  erring on is the safe side. What would change it: a report of an ordinary agent missing its hooks.
- The sign-in child (win32signin) also builds its env with childEnv and no opts, so it too drops inherited
  GIT_CONFIG_* keys. Harmless: it runs in the account folder, not a project.
- Tests: rule 1 is also tested with the world already applied to the env (as in a real launch, roots moved and the
  originals in KOSMOS_PRE_WORLD_ROOTS); reading the base without preWorldEnv fails that arm (run).

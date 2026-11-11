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
  stays a pure function: both spawn sites pass `restoredLaunch(process.env, s.cwd)`.
- `restoreworld.RESTORED_MARK` exported so the launch names the mark from its one source.

## Tests (engine/win32launch.restoreguard-7593.test.js, 7)
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

# Plan: #1598 fail-closed live-execution gate

Assigned to Mona Lisa by Splinter after a mutual-deferral orphan (PigeonPete
claimed first, both stood down, both re-claimed). Design is mine; PigeonPete's
execArgv finding and Renet Tilley's constraints are credited and built in.

## Problem

engine/remove.js and engine/delete-leftover.js each have their own run() that
reaches live launchctl/tmux. remove.js's dry-run default was OFF; delete-leftover
had no dry-run gate at all. Nothing on this box sets AGENT_WORKFORCE_DRY_RUN, so
a test that required either module and forgot setRunner/setDryRun ran live
against the operator's fleet: 10 launchd jobs incl com.kosmos.board, 18 tmux
sessions. A booted job returns at login; a killed tmux session does not.

## Fix (one commit, so prod is never broken between two)

- New engine/live-execution.js: allowLiveExecution / liveExecutionAllowed /
  resetForTests / inTestProcess / refuseOrWarn. The gate is on EXPLICIT intent,
  not on binary or verb (a launchctl-shaped denylist missed the bare launchctl
  in delete-leftover and can never see tmux kill-session).
- remove.js + delete-leftover.js run(): runner -> runner; explicit dry-run ->
  dry-run; not authorized -> refuseOrWarn then dry-run; else live. Both require
  live-execution; both gain resetForTests and export run for the test.
- server.js opts in via allowLiveExecution() INSIDE require.main === module only,
  never at module load (routing tests require server.js; a load-time opt-in
  would arm live execution in every one).

## Two failure directions, handled differently (both credited)

- Missed PRODUCTION opt-in: WARN loudly + dry-run, NEVER fatal (a board that
  refuses to start is worse than one on the previous supervisor, #310). Renet's
  constraint.
- Unseamed TEST run: THROW, refusing to fake success past a missing seam. Keyed
  on process.execArgv containing --test, which is per-process and NOT inherited,
  so a server a test spawns is treated as production, not a test. PigeonPete's
  finding (safebin-1598).

## Scope

remove.js + delete-leftover.js. create.js is the same class but is Renet's live
#1539 area; left to him to adopt the shared gate rather than collide.

## Verification

- Full suite green; NO existing test calls run() unseamed, so the throw-in-test
  breaks nothing and the fail-closed default clears the class with zero per-test
  churn (measured: the two exposed tests never call run()).
- ABSOLUTE launchd/tmux counts unchanged (10/18) before and after the full suite
  (absolute, not delta, because a delta cannot see what an earlier arm created).
- engine.live-execution-1598.test.js drives run() with /bin/echo ONLY, so even
  the authorized arm (which really executes, a genuine control) never touches a
  live job or pane. Four arms per module: unseamed-test -> throw; simulated-prod
  missed opt-in -> warn + dry-run + no execution; opted-in -> executes echo;
  runner -> runner wins.

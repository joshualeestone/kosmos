# Uninstall sweeps the wrong data root under a sandboxed KOSMOS_HOME (#924)

Routed by Splinter/Baron right after #923 shipped, found live: Pete's
act-three uninstall ran with `KOSMOS_HOME` set (a sandboxed release-walk
convention) and `AGENT_WORKFORCE_DATA` unset. The launchd label was already
correctly scoped to the sandboxed `KOSMOS_HOME` (#883's own fix), but the
data sweep (`_remote_state`, `_support`) is keyed on `AGENT_WORKFORCE_DATA`,
which `uninstall()` never derived from `KOSMOS_HOME` the way `install()`
already does -- so the sweep fell through to the REAL, unsandboxed
`$HOME/Library/Application Support` and would have removed the shared
supervisor and remembered-answer files there. Correctly-scoped label, wrong
data root: the run looked targeted and was not.

Contained overnight: only Pete's own walker hits this shape, he had already
stopped, and his interim guard now sets `AGENT_WORKFORCE_DATA` explicitly.
Still a real bug in shipped code, and a real data-loss risk once other
people start installing and uninstalling on shared or repeat-use machines.

## Root cause

`install/setup.sh`'s `uninstall()` computes `_kosmos_home_default` (for the
launchd label comparison, #883) but never applies the same
`AGENT_WORKFORCE_DATA`-from-`KOSMOS_HOME` derivation that `install()`
already does for a non-default `KOSMOS_HOME`. Confirmed by reading both
functions side by side: `install()`'s derivation block (around the "Starting
Kosmos" step) sets `AGENT_WORKFORCE_DATA`/`_PROJECTS`/`_WORKERS` whenever
`KOSMOS_HOME != _kosmos_home_default` and the caller hasn't overridden them;
`uninstall()` had no equivalent, so it read whatever the shell's ambient
`AGENT_WORKFORCE_DATA` happened to be (real default, if unset) regardless of
`KOSMOS_HOME`.

## Fix

Two parts, both in `uninstall()`, right after the existing
`_kosmos_home_default` computation:

1. **The derivation** (matches install-side #883 exactly): if
   `AGENT_WORKFORCE_DATA` is unset and `KOSMOS_HOME` is non-default, derive
   `AGENT_WORKFORCE_DATA="$KOSMOS_HOME/data"`. An explicit caller override
   still always wins, same as every other `${VAR:-default}` in this file.
2. **The belt** (defense in depth for the derivation not firing -- a future
   reorder, or a caller who sandboxes `KOSMOS_HOME` but points
   `AGENT_WORKFORCE_DATA` at the real path by hand): if a non-default
   `KOSMOS_HOME`'s resolved data root still equals the real default
   `Application Support`, refuse (`exit 1`, named sentence) rather than
   sweep. Same proof-before-delete posture the launchd label guard already
   demands of itself.

## Verification plan

Four new scenarios appended to `tools/test-install.sh`'s `#924` section:

1. **Pete's exact incident, reproduced** (fake HOME, never the operator's
   real one): `KOSMOS_HOME` set, `AGENT_WORKFORCE_DATA` unset -- confirms
   the real Application Support sentinel files survive byte for byte and
   the sandboxed `KOSMOS_HOME` itself is fully removed.
2. **Explicit override still wins**: caller sets `AGENT_WORKFORCE_DATA`
   explicitly at uninstall time -- confirms that path is what gets swept,
   not the derived default, and the real sentinel is untouched.
3. **The belt**: `AGENT_WORKFORCE_DATA` forced to equal the real default
   while `KOSMOS_HOME` stays sandboxed -- confirms refusal (exit 1, named
   sentence), not a silent sweep.
4. **Control**: default `KOSMOS_HOME`, `AGENT_WORKFORCE_DATA` unset --
   confirms the real-machine case is byte-for-byte unchanged (the belt must
   never fire here, the sweep must proceed exactly as before).

Status as of the pre-reboot session: 1-3 all passed clean. 4 (control)
failed at its own INSTALL step (before uninstall was even reached).

**Diagnosed on resume, post-reboot:** a test-harness bug, not a regression
in the fix. The control scenario's env carried
`AGENT_WORKFORCE_LAUNCH="$SB/launch924c"` (copy-pasted from the sandboxed
scenarios above it) while leaving `KOSMOS_HOME` at its real default --
`AGENT_WORKFORCE_LAUNCH` sandboxed, `AGENT_WORKFORCE_DATA`/`PROJECTS`/
`WORKERS` not, which is exactly the half-sandboxed shape
`engine/sandbox.js`'s pre-existing #634 guard exists to refuse. Confirmed
by reading `board.log` from the failed run: "Kosmos will not start
half-sandboxed: AGENT_WORKFORCE_LAUNCH is pointed at a sandbox, but these
are still the real fleet: ...". The #634 guard was working correctly; the
test was wrong to trip it. Fixed by dropping the `AGENT_WORKFORCE_LAUNCH`
override from both the control scenario's install and uninstall env
blocks -- with it unset, it falls back to `$D924_DEFHOME/Library/
LaunchAgents`, which is safe because `$HOME` is already this scenario's
own fake home, not the operator's real one.

Also found, same evening, by April (Discord bot) sweeping `install/
setup.sh` for the same class of bug: a much more severe sibling defect in
this exact function -- the agent-plist sweep in `uninstall()` (lines
894-936) globs `com.kosmos.agent.*.plist` in
`${AGENT_WORKFORCE_LAUNCH:-$HOME/Library/LaunchAgents}` with no
per-plist ownership check, so a sandboxed uninstall with
`AGENT_WORKFORCE_LAUNCH` unset would `launchctl bootout` and delete
EVERY real agent's launchd job on the machine, not just this data-root
sweep's narrower blast radius. Confirmed by direct code read. Filed
separately as kosmos#931 (not this card's fix -- needs an ownership proof
for agent plists, not a quick derive-and-refuse, and touches the
fleet's own agent supervision rather than tester-facing installability).
Escalated to Splinter the same evening.

## Not yet done

- One more full, clean `tools/test-install.sh` run to confirm 267/267 --
  the two post-fix reruns tonight both got flaky-under-load failures in
  an EARLIER, unrelated section (`update`, a board.pid timing check)
  while this machine was under load 14-16 from 18 bots resuming
  post-reboot plus Baron's live 0.5.45 cut. Retrying once load settles.
- Challenge-loop (not started).
- PR (not opened).

# Plan: #3182 - runtime per-agent RunAtLoad loaded-check (per-agent layer of auto-launch-after-reboot)

## The ask (Splinter carded, from Mona + ICK, advancing Josh's #2958)
The board-level auto-start guard (#2397 `machine.boardAutostartCheck`) is done + deployed (0.6.60): it
verifies the BOARD's login job (com.kosmos.board) will bring the app back after a restart. #3182 is the
next layer DOWN: each AGENT is also its own LaunchAgent (`create.js plistFor` writes
`com.kosmos.agent.<name>[+<world>].plist` with RunAtLoad=true + KeepAlive), and that per-agent layer is
what a user's agents actually rely on to come back. Josh #2958: after a machine restart the fleet must
auto-launch. The board recovering is necessary but not sufficient - the per-agent layer is the remaining
gap this surfaces.

## Design - the agent analog of boardAutostartCheck
New `machine.js agentAutostartCheck(runner, opts)`, wired into `machine.check()` as the `agentautostart`
row (returns null off darwin, filtered by Boolean like the board arm). It mirrors boardAutostartCheck's
proven shape one level down:
- The reboot-bearing fact is presence + RunAtLoad + not-disabled. RunAtLoad=true is guaranteed at write
  time by plistFor and pinned by create.test.js:315-316, so the failure still worth surfacing per agent
  is a standing `launchctl disable` override - the same present-but-disabled ATTENTION arm the board
  check has.
- Disabled set: `create.disabledJobsResult()`, which already OWNS the world-scoping (nameInThisWorld),
  the both-tokens `=> disabled|true` regex the board check documents, and the fail-soft. Reused, not
  regrown (the repo's one-definition discipline). Given an optional injected `runner` so the launchctl
  read goes through the SAME seam boardAutostartCheck uses (a fake launchctl in a suite).
- Removed agents excluded (`remove.removedNames()`, keyed by `create.cleanName`): a disable on a removed
  agent is not a problem, it is not expected to come back.
- Aggregate one row: no disabled live agents -> OK; some -> ATTENTION naming up to three (+ "and N more"),
  pointing at System Settings > General > Login Items; unreadable disabled read -> UNKNOWN (could-not-look,
  never a false OK).

## What finished looks like
`machine.check()` on darwin includes an `agentautostart` row that reads OK when no board agent is disabled,
ATTENTION (naming them) when one or more are, and UNKNOWN when the disabled list can't be read - never a
false "your agents are fine". Unit-tested on every branch; no browser.

## Change (agent-workforce)
- engine/machine.js: `agentAutostartCheck(runner, opts)` + the `agentautostart` row in `check()` + export.
- engine/create.js: `disabledJobsResult(runner)` gains an optional injected runner (backward-compatible;
  every existing caller passes nothing and is unchanged).
- engine/machine.test.js: the check()-row-count sibling test updated 5->6 (+ the new key), with an
  injected `disabled` seam so it stays hermetic.
- engine/machine.agentautostart-3182.test.js (new): 13 branch tests - off-darwin null, unreadable->UNKNOWN,
  none->OK, Set shape, one/many disabled ATTENTION wording, removed excluded, mix, >3 "and N more",
  unreadable-removed safe direction (both the ok:false and the throwing-catch branches), a runner-path
  integration through disabledJobsResult, and a never-mutates-launchd guard.

## Scope, stated so the row is not read for more than it checks
- SEES a DISABLED board agent (its RunAtLoad won't fire at the next login).
- Does NOT flag a fully DELETED agent plist: the board's roster is derived from the present plists
  (createdroster.js reads AGENTS_DIR), so a deleted plist is gone-from-roster, not a known label gone
  missing. There is no per-agent equivalent of the single known com.kosmos.board label for this to miss,
  and no false-alarm-free signal for it here. Left out deliberately, a clean follow-up if a persistent
  expected-roster is added.
- Never reads plist CONTENT for RunAtLoad: plistFor always writes it true and create.test.js reds if that
  regresses, so re-reading it here would be a second, weaker copy of a fact already guarded.
- darwin only; a win32 per-agent arm (the agents' Scheduled Tasks) is a follow-up, matching how the board
  arm shipped darwin-first then gained win32 (#570).

## Not mine / coordinated
- The board-level #2397 check is ICK's, done + deployed; this does not touch it, only sits beside it.
- The win32 per-agent arm and the deleted-plist-detection (needs a persistent expected-roster) are
  follow-ups, noted above.

## Weakest premise
That a standing `launchctl disable` override is the per-agent autostart failure worth surfacing. It is the
one the board check already treats as ATTENTION and the one a user can cause via Login Items; a
manually-deleted plist (rm, not `remove`) with a lingering disable override would be reported as "disabled"
rather than "gone", a rare edge accepted for v1 (the message still points at a real toggle). RunAtLoad
being flipped false in-file cannot happen through the product (plistFor) and is guarded by create.test.js.

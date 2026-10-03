# #5092: the #3011 leak guard skips the LIVE install rewriting its own agents' plists

## Problem (measured, Mortals 2026-10-02 22:11)
Josh switched Liu Kang mid-suite; the live board rewrote `com.kosmos.agent.liukang.plist` (born Sep 11) and an
unrelated branch's full run went red on the #3011 guard. Related: #4392 (Baron) skips live-CHECK agents by a
reserved name prefix; that cannot cover the live install's real agents, which have real names.

## The call
`launchagent_leak_check` drops a changed plist only when BOTH hold:
1. it was already in the pre-suite snapshot (MODIFIED; a NEW plist always reds, wherever it points), and
2. its WorkingDirectory is exactly `<live_root>/<name>` (one segment; not the root, not nested, not `..`, not a
   look-alike prefix). `<live_root>` defaults to `$HOME/work/workers` (store.workersRootFor's default).
Each skip goes to an optional notes file; run-tests.sh prints a `#5092 note` line per skip, so it is never silent.

## Rejected
- Skipping by name: the live agents have arbitrary real names (unlike #4392's reserved prefix).
- Skipping any modified plist: a test re-writing a real plist with a sandbox WorkingDirectory must still red.
- Reading the live install's own agent list: more coupling for the same answer the path already gives.

## Weakest premise
A test that rewrites a REAL pre-existing plist AND keeps its real WorkingDirectory would pass. #3605's
launch-guard.js refuses any test's write into the real LaunchAgents under node --test, so it fails first.
Also: a live install with AGENT_WORKFORCE_WORKERS set elsewhere is not covered (the default root only).

## Tests
`tools/test-launchagent-leak-guard-3011.sh`: + 10 legs (skip + note; NEW-under-live control; five modified
shapes that must red: sandbox, nested, root, look-alike, `..`; default root from $HOME; runner passes notes).
Sabotages: S1 (drop "was in snapshot") -> the NEW control reds; S2 (everything live-owned) -> all five shapes
and the original modify control red; S3 (no skip) -> the skip, note and default-root legs red.
Replayed on the REAL Mortals liukang plist (copied read-only): live-owned under /Users/mortalkombat/work/workers,
not under another root. 10 shell tests touching run-tests.sh pass (test-install.sh needs dist/, same on main);
23 node files touching run-tests.sh: 541/0.

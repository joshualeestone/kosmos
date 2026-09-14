# codex-launch-sandbox-3011: stop the codex-observed test leaking real LaunchAgents (kosmos#3011)

## The defect
`engine/status.codex-observed-2413.test.js` builds a temp sandbox and sets
AGENT_WORKFORCE_DATA / WORKERS / CODEX_HOME, but never AGENT_WORKFORCE_LAUNCH. So
`create.js` agentsDir() falls back to `path.join(homeDir(),'Library','LaunchAgents')`
(create.js:238) and `fleet.install([...])` writes each fixture agent's plist into the
operator's REAL ~/Library/LaunchAgents. launchd then shows five phantom agents
(codexok/codexstale/codexresolve/codexonce/codexnotworking) on the board. Every sibling
create/discover test sets AGENT_WORKFORCE_LAUNCH for exactly this reason.

## The fix (two parts, per the card)
1. **Primary:** set `process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'LaunchAgents')`
   in the test, next to the other sandbox env and before `./create` / `../test-support/fleet`
   are required, and add it to the mkdirSync list. Matches all siblings.
2. **Class guard so the next test cannot reintroduce it:** a suite-level check in
   `tools/run-tests.sh` (extracted to `tools/lib/launchagent-leak-guard.sh`) that snapshots
   the real `~/Library/LaunchAgents` com.kosmos.agent.*.plist set BEFORE the suite and
   refuses the run if any was CREATED or MODIFIED during it. Pre-existing real fleet plists
   sit in the baseline and never trip it; only a new/mtime-changed one does. The lib is
   parameterized by directory so the control test exercises it against a temp dir WITHOUT
   touching real home (running the unfixed suite to watch the guard fire is the very leak).

## Verification
- The fixed test in isolation: 5/5 pass, and a before/after snapshot of real
  ~/Library/LaunchAgents shows zero new com.kosmos.agent.* (no leak).
- `tools/test-launchagent-leak-guard-3011.sh` (wired into test:shell): 10 legs pass, covering
  source-invariant wiring in run-tests.sh + behavioral fire-on-new, fire-on-modify,
  clean-on-untouched (real-fleet baseline safety), scope (non-agent files ignored), and
  fail-soft.

## Rejected
- A runner-level env sandbox (run-tests.sh exports AGENT_WORKFORCE_LAUNCH for the whole suite):
  broader, but changes behavior for every test and diverges from the sibling per-test pattern
  the card asks to match; the guard is the systemic safety net instead.
- The naive control (run the unfixed suite, watch the guard fire): re-leaks onto the real box.
  The parameterized-dir control proves red + green without that harm.

## Weakest premise
That a legitimate concurrent real-agent create during the ~minutes-long test window will not
false-trip the guard. It could, in principle; the cost is a re-run, and it is bounded to the
com.kosmos.agent.* class during the run window. The alternative (scoping to plists pointing at a
temp path) adds parsing for a rare case; if it proves noisy in practice, tighten it then.

## Gates
Kosmos beta: challenge-loop + full suite green, then merge on green (per Splinter, who assigned it).
Cleanup of the already-leaked plists was done by Splinter (moved to
~/.cache/kosmos-leaked-test-plists-20260913/); re-check both boxes after merge.

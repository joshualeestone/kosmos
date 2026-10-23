---
pre_challenge: true
method: challenge-loop
branch: aochome-0764
diff_hash: e72fd23282f36db02a7686d5b5c47b1aae77bdcfa4d949da28b940a7b884005b
validation: passed (targeted, both arms: tools/test-staging-agent-online-check.sh with AGENT_WORKFORCE_HOME exported as a cut exports it reds on main's version at exactly "launchctl noroute" and passes all arms with the fix; without it the fixed file passes all arms. No Mortals full suite: Mortals is the cut box, and the change is one assignment on one command line of one test file)
subdir_audit: passed
timestamp: 2026-10-23T06:30:15Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (sonnet, blind)
**Converged:** Yes: no BLOCKER, no WARNING; two NITs.

### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 2 NITs.

### Checked by the reviewer and found sound
- engine/create.js:283 homeDir is AGENT_WORKFORCE_HOME first; agentsDir (293) is AGENT_WORKFORCE_LAUNCH first, else
  homeDir/Library/LaunchAgents; workersDir (288) goes through store.workersRootFor (store.js:450), WORKERS first, else
  home/work/workers. So paths_of now computes under $R/home in the unsandboxed arms, the layout the fake board writes.
- live, noplan, transient, landed, partial-tokens assert on the launchctl log, untouched; noroute's ls check now
  matches where the engine looks; the sandboxed arm's explicit LAUNCH, WORKERS and DATA still win.
- Nothing in those arms can now reach a real folder: before the fix, inside a cut the gate looked in the cut's own
  home; delete-leftover.js:66-71 ignores XDG_DATA_HOME when AGENT_WORKFORCE_HOME is set, so the data root holds too.
- Every other gate call in the file sets LAUNCH, WORKERS and DATA; tools/test-staging-channel-2036.sh has no HOME or
  AGENT_WORKFORCE_* reference.

### NITs (not done: they do not change what runs)
- run_case's -u list could add AGENT_WORKFORCE_HOME for explicit isolation (LAUNCH/WORKERS/DATA already override it).
- The new comment could also say the sandboxed arm's explicit paths still win over the home variable.

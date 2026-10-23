# aochome-0764 (kosmos): test-staging-agent-online-check.sh passes inside a real cut

The pinned 0.7.64 re-cut (ed4464db28, started 23:23 10-22) went red at step 3 on one shell test:
`tools/test-staging-agent-online-check.sh`, arm "launchctl noroute": "could not clear ... (HTTP 404) and found no files
at .../kosmos-cut-home/Library/LaunchAgents/...". Node: 23420 tests, 0 fail. The arm is from #6922 (PR #6958, merged
21:00 10-22); its Mortals validations passed, but a validation does not export the cut's home and a cut does.

## Why
The engine roots every path at `AGENT_WORKFORCE_HOME || os.homedir()` (engine/create.js homeDir, agentsDir). The
launchctl loop's unsandboxed arms set HOME to a throwaway folder and the fake board writes the files under HOME; a real
cut exports AGENT_WORKFORCE_HOME (its cut-only home), so the gate's engine looked there and found nothing.

## Decided
- Set `AGENT_WORKFORCE_HOME="$R/home"` beside `HOME="$R/home"` on that loop's one command line, so the engine and the
  fake agree whatever the caller exports. Rejected: unsetting it (the engine would then use os.homedir(), the real
  home, for computing paths in an unsandboxed arm).

## Measured
- With AGENT_WORKFORCE_HOME exported (as the cut does): main's file reds on exactly "launchctl noroute"; the fixed
  file passes all arms. Without it: the fixed file passes all arms.

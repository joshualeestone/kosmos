# nodeonly-5488: #5488 part c, only the node suite takes the self-hosted Mac

## Why (measured 2026-10-07, numbers on #5488)
- Per job the self-hosted Mac is faster: node 4.3 min against GitHub's 22.2 (median, n=31); shell 2/2 14.0 against 23.5.
- But it is ONE runner. With every Mac job routed to it (part b), it ran them serially: about 33 min of mini time per PR run, so about 1.8 runs an hour. GitHub's 5 parallel runners give about 4.2 runs an hour. At 20:30 CDT, 30 jobs were queued for the mini against 15 for GitHub.
- **Node only:** the mini can take about 14 node suites an hour, and GitHub runs only the two shell shards (about 50 job-minutes per run, so about 6 runs an hour, roughly 40% more than today). Node results arrive in about 4 min. GitHub stays the bottleneck, and the mini is never the queue.

## Change
1. `.github/workflows/test.yml`, suite `runs-on`: `fromJSON(matrix.part == 'node' && needs.scope.outputs.mac_runner || '"macos-latest"')`. Shell shards always run on macos-latest. The node part takes scope's choice, which is still gated by the `KOSMOS_CI_RUNNER` switch and same-repo code (part b, unchanged).
   - If scope gave nothing, the empty string is falsy and the fallback is macos-latest, as before.
2. The tmux step refuses on a self-hosted runner (`RUNNER_ENVIRONMENT=self-hosted`) instead of `brew install`. The mini's Homebrew belongs to the machine's owner and is writable by the runner user through the admin group. tmux is installed there by hand.
   - GitHub-hosted runners, and an unset variable (older runners), install exactly as before.
3. `tools/test-ci-runner-route-5488.sh`: the runs-on pin updated, the tmux pin updated, and a new arm that runs the REAL tmux step body from the parsed workflow. It uses a stub brew that records calls and a PATH with no tmux:
   - self-hosted refuses without brew;
   - GitHub-hosted calls brew;
   - unset calls brew;
   - controls: tmux present means neither calls brew;
   - a precondition that /usr/bin and /bin hold no tmux, so the no-tmux arms are not vacuous.

## Caught while building
The first draft's error text ended `(see #5488)`. In a YAML plain scalar, ` #` starts a comment, so the parsed step was silently truncated mid-command. The new wiring pin caught it, and the text now reads `card 5488`.

## Checks
- route 17 ok (incl. the 5 tmux arms), job-guard 28 ok, plans-only-reuse 35 ok, tools.shell-shard-4317 12/12.
- **Red-check:** reverting the tmux step to `command -v tmux || brew install tmux` makes the route test fail. It fails through the exact-string pin, whose failure aborts the parse and with it every later arm. That is pre-existing harness behaviour, kept as is.

## Not in scope
- Turning the switch back on, which follows the merge. Then I measure again against the part b numbers and report on #5488.
- The mini's SSH login refusal (parked for the morning by Splinter).

## Weakest premise
The throughput figures assume tonight's GitHub job times and a steady arrival rate. On a quiet day the waits shrink, but the ordering (node only beats everything on one Mac) holds as long as the mini is a single runner.

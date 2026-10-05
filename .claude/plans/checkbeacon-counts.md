# Browser checks run directly must never register an install on installkosmos.com (homepage counts, Splinter 17:12)

## Measured (2026-10-05, admin telemetry, ids matched by the site's own HMAC label computed from ping.json files)
- Josh: the homepage counters "look broken". They are not: installs 187 -> 188 and agents 920 -> 930 today, and the
  #4253 silent filter (0 agents, no report) is doing its job.
- 105 brand-new silent install ids pinged today; 53 of them are OUR browser-check boards (45 Agent1s, 8 Mortals:
  render-settings-nav 26, a snav head test 6, render-plus-signin 4, ...; my own #5293 check 4). The other 52 have the
  same profile (US Mac, same bursts); their temp folders were already cleaned, so they cannot be matched.
  Control: the method finds Agent1s's real install in the rows.
- Cause: tools/browser-checks.sh points AGENT_WORKFORCE_CREATED_URL and _FEEDBACK_URL at a dead port, but a check run
  directly (node docs/browser-checks/x.js) inherits neither, its board is not under node's test runner, and
  createdbeacon.pingInstall() registers a fresh install id with production on every boot.

## Change
docs/browser-checks/lib-sandbox-home.js (required by every board-booting check; tools.browser-checks-home-3675 enforces
it) sets both URLs to http://127.0.0.1:9/... unless the caller already chose a loopback address (a check that stubs the
collector keeps its stub). A real host in the caller's environment is replaced.

## Tests
tools.browser-checks-beacon-counts.test.js: nothing set, a real host set, and a loopback stub (CONTROL: kept).
Removing the block reds two. All 63 browser-check-reading tests pass.

## Not changed, on purpose
The public count and its filter (Josh 10-03: do not alter the numbers). The junk ids already written stay excluded by
#4253's rule. Checks that boot no board need nothing.

## Weakest premise
That the other 52 are ours too. Unproven: their folders are gone. Nothing points to real users (no agent, no report,
US Mac bursts matching our runs), and a real user who makes an agent is counted at once either way.

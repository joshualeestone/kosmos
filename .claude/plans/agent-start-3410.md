# Plan: "Start this agent" button for not-running agents (#3410)

## Problem
Josh, testing 0.6.88 live (2026-09-22), had seven agents that never connected and
no way from the UI to start one. The only recovery path was the buried "Fresh
start" section on the detail page. He asked for a "Start this agent" button "right
under their avatar if they are in this state."

## Decision
Add a prominent "Start this agent" action in the detail-header identity column,
shown ONLY when the agent is confidently not running (`cardStOf(a).pres === 'off'`,
which is state 'stopped' alone today). Toggled at open time in `openDetail`,
parallel to how `#d-reauth` is toggled.

- **Reuse, do not add an endpoint.** The button drives the EXISTING
  `POST /api/agent/<name>/restart` route (the one that starts a stopped agent,
  already used by Fresh start and Trust & Restart), via the shared `restartTook` /
  `restartFailureLine` helpers.
- **Honest under #3418.** `restartInner` returns `outcome:'restarted'` even when
  the launchd relaunch never loaded (Alexandra's diagnosis, Angel's lane). So the
  button does NOT trust the restart response: after the route accepts it, it waits
  on `restartReadyWait` to actually SEE the session running before saying
  "Started". A start that never comes back shows an honest "has not come back yet"
  line; a refused/partial outcome shows `restartFailureLine`.
- **No cost-confirm modal.** A stopped agent has no live session to lose, so
  starting it is a direct action, unlike the running-agent restart modal
  (`openRestartModal`) whose whole purpose is showing what it stands to lose.
- **Wake it.** On confirmed readiness the button sends the same 'hello' the other
  restart paths send (#2686), inlined because `autoHelloAfterRestart` re-runs
  `restartReadyWait` which would time out after readiness is already past.

## Forward-compat
Angel named a `connection_lost` state in the button seam; it does NOT exist in the
code yet. The visibility gate keys on `pres === 'off'`, so when the engine adds a
distinct not-running state it falls under the same gate; the label switches to
"Reconnect" there. #3417 (auto-approve prompts) and #3418 (relaunch-from-dead) are
Angel's; this button becomes fully reliable once #3418 makes the restart response
honest, and is already honest on its own via the readiness re-check.

## Files
- `web/index.html`: CSS (`.d-start-wrap`), HTML (button + status line in the
  identity column after `.dnamerow`), visibility toggle in `openDetail`, the
  click handler, and the button id added to the poll's "agent vanished" disable
  list.
- `docs/browser-checks/render-start-agent-3410.js`: new self-serve check.
- `tools/browser-checks.sh` + `docs/browser-checks/README.md`: wiring.

## Test plan
`render-start-agent-3410.js` (self-serve, 14/14 green) asserts: visible + enabled
+ "Start this agent" on a stopped agent; hidden on a running one; the click POSTs
`/api/agent/<name>/restart` and a refused outcome (HTTP 400) shows the honest
failure line, not "started", and re-enables the button; and Part 4 exercises the
#3418 honesty path itself: the route returns the false-success `outcome:'restarted'`
while the agent never becomes ready (readiness window shortened via the
`RESTART_READY_WINDOW_MS` let-seam), and the button must show "has not come back
yet", must NOT claim "Started", and must re-enable.

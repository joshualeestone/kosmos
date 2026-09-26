# restart-surface-4006 (items 3-5 of #4006)

Card: joshualeestone/kosmos#4006. The hotfix (branch auto-restart-4006) stops quiet Grok agents being restarted. This
branch covers what the incident exposed about a restart that does not come back: Elon's failed auto-restart was
logged to board.log only; the card fell to a quiet "not running" for 23 minutes.

## Change
- engine/disruption.js: `fail(session, diagnostics)` marks the in-flight record failed (keeps cause and start, adds
  failedAt and what launchd said) instead of clearing it; `read`/`active` carry `failed`.
- engine/remove.js (restartInner): when the job does not load, wait RELAUNCH_RETRY_MS (2s; `bootout` returns before
  launchd has finished unloading, and a bootstrap into that gap can answer "already loaded") and try the bootstrap
  once more. If it still does not load: `disruption.fail(...)` with `ops.diagnose` (the last bootstrap's code/stderr
  and `launchctl print` of the job) instead of `disruption.clear`. `run()` now keeps stdout/stderr on failure.
- engine/status.js: a failed record over a stopped pane reads NEEDS_YOU ("Kosmos restarted this agent and it did not
  come back. Restart it to bring it back"), red on the board (not a phone notification; it is counted by
  wouldping.saw like any needs_you), for pane cards and for created agents with no pane
  (Elon's case: no session, no loaded job). The forward self-heal skips that reading, so it survives ticks; the agent
  coming back live clears it as before.

## Review round 1 (Opus), what changed
- The card shows it: web stateReason renders "Kosmos restarted it and it did not come back. Restart it to bring it
  back." for a needs_you carrying disruption.failed (the engine's `because` never reached the page, which quotes only
  REPORTED reasons). Browser check render-restart-timedout-2019 asserts it, with a plain needs_you CONTROL.
- NOT a phone notification: only a REPORTED needs_you pings (server.js report route). Red on the board only.
- A failed record clears the moment the pane reads anything but the failure itself, UNKNOWN included.
- Removal (recordRemoval), creation and delete-leftover clear the record, so it never outlives its agent.
- The bootstrap diagnostics are reset at each relaunch; the retry and the failed marking are Mac only (Windows keeps
  its clear; its running-check already polls up to 12s).
- Probed, not changed: the reviewer's concern that the working animation could paint over a failed card. Measured on
  a pane card and a created-no-pane card, with a newer liveness beat than the dead instance's last report and the
  guard removed: activeWhileWaiting stays false on both. A guard that cannot fire was not added.
- fail() validates its time; stale comments in remove.js and disruption.js corrected.

## Review round 2 (Sonnet), what changed
- The second-try wait blocks the whole board (restart is synchronous), so only the first failure in a 10-second
  window waits; later ones in a burst retry at once. A test runs two failing restarts back to back and requires the
  second to take under 300ms with a 400ms wait configured (perturbed red).
- A failed restart whose launch file was gone says the agent has to be created again, not "restart it" (engine
  reason and card copy; the record carries `gone` from its diagnostics).
- Kept as documented: the diagnostics hold the LAST bootstrap's answer only.

## Review round 5 (Opus), what changed
- No Answer button on a failed-restart card (page answerBtn), asserted with a plain needs_you CONTROL.
- The "launch file gone" reading is REMOVED: the created roster lists agents by their .plist, so an agent whose
  plist is gone never reaches that card path; the copy was reachable only from a fixture. plistExists stays in the
  diagnostics on disk.
- A failed record clears on an UNKNOWN reading only when an agent process runs in the pane (isAgentSession): a
  board that could not read the pane also says UNKNOWN, and one bad read must not erase the failure.
- A failed START (fromDead: a never-run or fully-dead agent) clears its record as before: it is not a restart that
  did not come back, and the route already says what happened.
- Deferred (harmless): the send route's asking gates do not exclude a failed restart (a stopped pane has no menu).

## Decided
- Reuse the disruption record rather than a new store: it already ties a restart to the card and already clears when
  the agent is back.
- NEEDS_YOU, not a new state: it is the existing red; the page's agent view always offers Restart. (It is not a
  phone notification: only a reported needs_you sends one.)
- Only a FAILED record reaches a created-no-pane card; an in-flight one there is a separate, existing follow-up.
- Applies to every failed restart (manual or automatic): either way the agent is down and the person must act.

## Weakest premise
- That a 2s wait covers the bootout teardown race. If #3418 has another cause, the second try fails too, and the
  record's diagnostics are what will name it.

## Tests
- status.disruption-2019.test.js #4006: reconcile (outranks a stale idle; in-flight CONTROL), pane snapshot across
  ticks and heal, created-no-pane card, fail() record on disk.
- remove.test.js #4006: second try loads -> RESTARTED; both fail -> failed record with bootstrap/print diagnostics.
- Existing #3418/#3410/#3431 failure tests now assert the record is kept and marked failed (not "restarting").
- Perturbed red: the retry, the diagnose, fail vs clear, the needs_you branch, the heal exclusion.

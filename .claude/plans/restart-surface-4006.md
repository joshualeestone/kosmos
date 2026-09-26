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
  come back. Restart it to bring it back"), red and notifying, for pane cards and for created agents with no pane
  (Elon's case: no session, no loaded job). The forward self-heal skips that reading, so it survives ticks; the agent
  coming back live clears it as before.

## Decided
- Reuse the disruption record rather than a new store: it already ties a restart to the card and already clears when
  the agent is back.
- NEEDS_YOU, not a new state: it is the existing red that already notifies; the page's agent view always offers
  Restart.
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

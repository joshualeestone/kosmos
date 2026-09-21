---
method: challenge-loop
branch: tz-remove-ask-3338
diff_hash: 0ec3d66f35fba46a2c69e39cc8275a85a666e35363fa3c000ebc4d8fc2ecdea9
converged: true
---

# Challenge loop: remove the time-zone ask (#3338 follow-up, Josh 0.6.84)

Adversarial self-review of removing the tz ASK while keeping the value auto-detected. Two
iterations; converged, no BLOCKERs.

#### Iteration 1

[WARNING] The machine zone is captured SILENTLY in two places -- onboarding Continue (always) and
Settings paint (only when unset). Does that double-write or race? No: onboarding Continue sets the
value, so on any later Settings visit `saved` is truthy and `paintYouTz` does NOT re-POST (the
`if (!saved)` guard). The Settings capture only fires for an install that never ran the onboarding
capture (e.g. upgraded from before this change, or onboarding skipped). One write in the normal
flow. Confirmed correct; the tz test pins both arms (POST when unset, NO POST when saved).

[WARNING] The picker-only helpers (`YOU_TZ_PLACES`/`ZIP3`, `youTzResolve`/`Select`/`FillSelect`/
`WireSearch`) are now dead code left in web/index.html. Is that a hidden bug? They are PROVABLY
dead: grep shows the only callers are each other (dead-calls-dead), no live code path and no test
or browser-check references them (the rewritten tz test no longer lifts them). Harmless, and it
fails nothing. Deliberately deferred to a focused follow-up removal rather than doing a large
deletion in the 3.2MB file in this change -- documented in the commit + PR. Confirmed-intentional.

[STRENGTH] Consumer safety is real, not assumed: `/api/settings.timezone` (route UNCHANGED) is read
only for the operator's local-time label to agents, which already degrades gracefully when unset.
The silent capture keeps that label working with ZERO asking. `server.test.js` 306/306 unchanged
proves the route and its consumers are untouched.

#### Iteration 2

[WARNING] `youTzLabel` returns the raw IANA id for a zone outside the friendly US-first set (e.g.
"Africa/Nairobi"). Is a raw id acceptable in the read-only display? Yes -- it is honest and never
blank; the friendly label ("Central Time (CT)") is used for the common cases, and Josh's ask was to
SHOW the detected zone, not to curate every global zone. The tz test pins the raw-fallback case.

[WARNING] The browser-check now asserts the picker's ABSENCE (`tzGone`, written as `=== null` for
the #758 selector guard) and that Continue silently POSTs the machine zone (`postBody.timezone ===
Intl…timeZone`). Does removing so many arms weaken it? It still discriminates: it would FAIL on the
old markup (picker present) and on a Continue that does not capture the zone. The index + reason-grep
tests pass (the file was MODIFIED, not added/removed, so the 4 browser-check indices are unchanged).

[NIT] The Settings value uses an inline `font-weight:600` rather than a class -- deliberate, to
avoid depending on a value-display class the codebase does not clearly have (a missing-class risk).

Converged: no BLOCKERs. Green: the rewritten tz suite (5) + firstrun (name/does two-field) +
file-pickers (3 Save buttons) + browser-check index/reason-grep, and server.test.js 306/306. The
dead-helper removal is a documented deferral; a HEADED verify of the browser-check is the 0.6.85
real-render gate (headless can false-pass rendering).

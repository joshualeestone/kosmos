# agyquota-4588: Antigravity agents paused on their Google account's shared quota, and resumed one at a time

Card: #4588 (priority; a user's six Gemini agents on one Google account all stop together with RESOURCE_EXHAUSTED
"Individual quota reached ... Resets in 24m54s"). This branch is PR A of part 2. The design and its correction are on
the card (comments 5895338362 and 5895357615).

## Call
- bin/agy-report-bridge.js: a Stop whose error is RESOURCE_EXHAUSTED with "Resets in XhYmZs" is still reported IDLE
  (agy's loop has ended), with the reset as an ISO time in the report's existing `until` field and text naming the
  account's shared quota (Google's own words kept at the end).
- engine/status.js: quotaPauseUntil(reported) = an AUTOMATIC idle whose `until` is a time still ahead. reconcileReport
  reads it as the existing rate_limited state (the board's "Paused"), with the reset in its reason and `quotaUntil`;
  the card carries quotaUntil.
- web/index.html stateReason: a rate_limited card with quotaUntil reads "Usage limit reached. Kosmos resumes it at
  9:47 PM."; without it the wording is unchanged.
- engine/agyquota.js + server.js: a sweep types one carry-on line into each agy agent whose reset has passed (+30 s),
  ONE agent per sweep and at least 60 s apart, oldest reset first, at most 3 tries per reset; live-execution gate,
  brake AGENT_WORKFORCE_AGY_QUOTA_RESUME_OFF=1. The agent's next automatic working then clears the pause.

## Rejected
- A `blocked` report: #2456 deliberately keeps an automatic blocked from being cleared by automatic reports
  (selfreport.autoclear-2456.test.js), so the card would stay Paused after the resume. Not changing #2456.
- Restarting agents at the reset: loses in-flight context; a typed line keeps it (#3410's measurement, for Claude).
- A new report state or a new stored file: the pause is derived from the reports that already exist.
- Holding the automatic senders (unanswered-message sweep, assigner, first-reply nudge...) during the pause: PR B.

## Weakest premise
That agy's "Resets in" counts from when the error is printed, and that a line typed after the reset resumes agy's
turn (agy has no screen reader here; the resume is unmeasured on a real agy). A wrong reset only makes the nudge early
(it fails again, and a new pause starts) or late.

## Measured
- engine/agyhooks.test.js 33/33 (4 new), engine/status.agyquota-4588.test.js 3/3, engine/agyquota-4588.test.js 6/6,
  engine/status.agyquota-card-4588.test.js 1/1 (sandboxed data root, asserted), web.agyquota-4588.test.js 2/2,
  server.agyquota-4588.test.js 1/1; the existing status/selfreport/agy files 677/677.
- Controls: no runner filter, no stagger, no timer (two spellings), no card copy, no page line: each reds its test.
  The first timer pin was a text match that a mutation passed; it now anchors on the assignment.

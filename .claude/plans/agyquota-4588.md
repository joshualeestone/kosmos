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

## Review iteration 1 (blind, opus)
0 BLOCKER, 5 WARNING, all taken:
- (W, SELF) the card and the stored text promised "Kosmos resumes it at 9:47 PM": false with the sweep off, and 9:47 is
  the reset, not the resume (six agents on one account are typed into over several minutes). Both now state the reset
  ("The Google quota resets at 9:47 PM"), which is true in every case; the record keeps Google's words for diagnosis.
- (W) the detail header quoted the report (raw RESOURCE_EXHAUSTED text and a stale "Resets in", #215), and after the
  reset it kept saying Paused. The quota branch now gives Kosmos's own sentence, and a quota report whose reset has
  passed reads as idle with "its ... quota reset at H:MM" (quotaResetOf split out of quotaPauseUntil).
- (W) accountproblem.js's generic rate_limited arm told the person and the manager "It looks like ... Add credits ...":
  hedged on a firm reading, and wrong advice for a subscription allowance. A firm antigravity branch names the shared
  account and the reset, and no credits.
- (W) the resume book is in memory, so an agent whose last report is an old quota stop would be typed into again after
  every board restart: a reset older than six hours (Google's five-hour window) is left alone.
- (W) the stagger equalled the 60 s tick, so jitter could double the spacing: it is 55 s.
- (N, taken) "Resets in 500ms" read as 500 minutes (m(?!s)); the "nothing else writes one" comment now names the
  Windows CLI's --auto --until; the card field notes that paneless cards carry no quotaUntil (agy always has a pane);
  the page test uses a real card's shape and pins the grid and the detail path.
- (N, left) the bridge's absolute `until` follows its own clock (a skewed remote machine shifts the pause).
Controls: each fix reds its test when removed. The engine regression set: 728/728.

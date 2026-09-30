# agyquota-4588: Antigravity agents paused on their Google account's shared quota, and resumed one at a time

Card: #4588 (priority; a user's six Gemini agents on one Google account all stop together with RESOURCE_EXHAUSTED
"Individual quota reached ... Resets in 24m54s"). This branch is PR A of part 2. The design and its correction are on
the card (comments 5895338362 and 5895357615).

## Call (current, after review 5; the per-round sections below record how it got here)
- bin/agy-report-bridge.js: a Stop whose error is RESOURCE_EXHAUSTED with "quota reached" and "Resets in [Nd][Nh][Nm][Ns]"
  is still reported IDLE (agy's loop has ended), with the reset as a strict ISO time in the report's existing `until`
  and a first sentence status.js keys on (QUOTA_REPORT_PREFIX); Google's own words follow, for the record.
- engine/status.js: quotaResetOf = an automatic idle with that first sentence and a strict ISO until. Before the reset
  (quotaPauseUntil) it reads as rate_limited (the board's Paused) with "its ... quota ran out; it resets at <time zone>";
  after it, while still the latest report, idle with "its turn stopped when its Google quota ran out and has not picked
  up again". Only over a screen that says nothing (agy's always). The card carries quotaUntil.
- web/index.html: stateReason says "Usage limit reached. The Google quota resets at <time>." (the day too when more
  than 20 hours out); the guide fallback says the Google quota refills by itself, not "add credits".
- engine/accountproblem.js: a plain line to the person naming the shared account and the reset; notify: false.
- engine/agyquota.js + server.js: after the reset (+30 s), one carry-on line per agent, one agent per sweep and 55 s
  apart, oldest first, only over an idle, unknown or paused card, refusals backing off, 3 tries, a six-hour window;
  live-execution gate and AGENT_WORKFORCE_AGY_QUOTA_RESUME_OFF=1.

## Rejected
- A `blocked` report: #2456 deliberately keeps an automatic blocked from being cleared by automatic reports
  (selfreport.autoclear-2456.test.js), so the card would stay Paused after the resume. Not changing #2456.
- Restarting agents at the reset: loses in-flight context; a typed line keeps it (#3410's measurement, for Claude).
- A new report state or a new stored file: the pause is derived from the reports that already exist.
- Holding the automatic senders (unanswered-message sweep, assigner, first-reply nudge...) during the pause: PR B.

## Weakest premise
That agy's "Resets in" counts from when the error is printed, and that a line typed after the reset resumes agy's
turn (agy has no screen reader here; the resume is unmeasured on a real agy). A wrong reset only makes the nudge early
(it fails again, and a new pause starts) or late. Neither Windows path is measured either: agy's quota text on
Windows, and a carry-on line delivered into a win32 agy pane (the bridge ships in the Windows bundle).

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

## Review iteration 2 (blind, sonnet)
0 BLOCKER, 5 WARNING:
- (W, taken) the antigravity branch set notify: true, so accountnotify typed "please tell the person ... so they can fix
  it" into the manager for a pause that clears itself (and a manager on the same account is likely paused too, and
  would spend the fresh quota on it). notify: false; the card and the DM line already say it.
- (W, taken) the quota rule sat above the screen rules and ignored them: it now applies only over a screen that says
  nothing (UNKNOWN or IDLE; agy's is never read, so always for agy), so a question, work or a lost connection on
  screen outranks it. Past the reset it says "reset at H:MM" for six hours (the sweep's window), then plainly at rest.
- (W, taken) a refusal (COULD_NOT) stamped the stagger clock and giving up was silent: only a line that may have
  reached the pane spaces the next agent out, and giving up is logged ('gave-up').
- (W, residual, disclosed) the resume book is in memory: after a restart an agent whose latest report is still the
  quota idle (an UNCONFIRMED nudge that never started a turn) can be typed into once more, within six hours.
- (W, taken) server-side times now carry their zone ("9:47 PM CDT"), since that sentence is formatted on the board's
  machine and can be read from another; the card formats in the viewer's own zone.
- (N, taken) the stagger stamp is a Symbol key; the plan's stale lines are fixed. (N, left) "Resets in 1 hour 5 minutes"
  reads as 1 hour (the real text is compact; early only means a failed nudge and a new pause).
Controls: each fix reds its test when removed. The engine regression set: 730/730.

## Review iteration 3 (blind, opus)
0 BLOCKER, 4 WARNING, all taken:
- (W) the status rule never checked the runner: any automatic idle whose until Date.parse accepted (any hook passes an
  until through; the Mac CLI's --auto --until too; Date.parse reads "5" as May 2001) read as the Antigravity quota.
  It now requires the bridge's own first sentence (status.js QUOTA_REPORT_PREFIX, pinned against the bridge's text) and
  a strict ISO until. Controls: another agent's automatic idle with a time, "5", and a non-ISO date are not a pause.
- (W, SELF) the give-up log said "left paused for a person" (it reads idle past the reset, and nobody is told), and a
  refusal let all three tries run on consecutive ticks. Refusals back off STAGGER_MS per try so far; the log says it is
  left idle with its turn unfinished until someone messages it.
- (W) the sweep ignored the card: it now types only over an idle, unknown or rate_limited card, never a question (a
  typed line could answer it), work, or a lost connection.
- (W) two copies of one fact: the sweep reads status.quotaResetOf and status.QUOTA_RESUME_WINDOW_MS (pinned equal).
- (N, taken) the reconcile branch now calls quotaPauseUntil (the function its comments cite); the DM line says "any
  other Antigravity agent signed in to the same Google account" (not "every agent on this computer", unmeasured); the
  card's time carries its zone; the weakest premise names the unmeasured Windows path.
- (N, left) the wiring pin is a source match (no test may run the server).
Controls: each fix reds its test when removed. The engine regression set: 733/733.

## Review iteration 4 (blind, sonnet)
0 BLOCKER, 3 WARNING:
- (W, taken) quotaResetMs fired on any RESOURCE_EXHAUSTED with a "Resets in": a short per-minute limit would be told
  as the account's quota used up. It now also requires "quota" (the measured text: "Individual quota reached").
  Control: a per-minute limit reads null; dropping the requirement reds it.
- (W, taken) the guide fallback (web asbFallbackWords, fed by setup-assistant guideFailure) still said "Add credits
  with Google" for an agy guide. An agy card is rate_limited only on this quota (its screen is never read), so the
  line says the Google quota refills by itself. Other runners keep their advice (control).
- (W, residual, kept and argued) the in-memory resume book repeats after a restart. Kept: the agent's latest report
  still being the quota idle means Kosmos has seen NO sign it resumed, so typing the carry-on line again is the right
  action; the only duplicate is an agent that resumed but fired no hook, and it costs one extra line, within six hours.
- (N, taken) a reset more than 20 hours out is shown with its day (the weekly window); the sweep requires status.js once.
- (N, left) compact-only regex forms ("1 hour 5 minutes" reads early; early only means a failed nudge and a new pause);
  NUDGE_TEXT carries no Kosmos marker (as connlost-heal and firstreply-nudge); past the six hours "at rest" replaces
  the ordinary idle reading for this one report shape.
The engine regression set (with setup-assistant): 743/743.

## Review iteration 5 (blind, opus)
0 BLOCKER, 3 WARNING, all taken:
- (W, SELF) past the reset the card read "quota reset at" and then "at rest and nothing is needed", a false calm when
  no resume happened (sweep off, given up, unconfirmed). While it is still the latest report it now reads "its turn
  stopped when its Google quota ran out and has not picked up again (the quota reset at ...)", at any age.
- (W) "quota" did not separate the account's quota from Google's per-minute limit ("Quota exceeded for metric ... per
  minute"): the guard is the measured phrase "quota reached", and the control is Google's real per-minute sentence.
- (W) days were shown but never parsed: "Resets in 3d4h" now reads (unmeasured form; the measured one is "24m54s").
- (N, taken) a test titled CONTROL that was not one is renamed; two test headers and a commit-era phrase no longer say
  "when Kosmos resumes"; comments no longer state as fact that every agy agent on a machine shares one account; the
  fallback line is one sentence; the page test lifts the page's own provider map.
- (N, left) book entries are never pruned (bounded by sessions per board run).

## Review iteration 6 (blind, sonnet): CONVERGED (no finding that needs a change)
Three WARNINGs, each judged against the code, none a change:
- DEFERRED (true as written): between the reset and the resume (30 s grace, then 55 s per agent) the card reads "its turn
  stopped ... and has not picked up again", which is literally true until the carry-on line lands. The other idle-agent
  senders that could type into a still-exhausted account in that window are PR B, disclosed.
- DEFERRED (known tradeoff, recorded since review 1): the reset is computed on the hook host's clock; a remote agent
  with a skewed clock is nudged early (a failed nudge and a new pause) or late (by the skew). Same machine today.
- DEFERRED (disclosed): a turn started by someone else after the reset but before its first hook can get one extra
  carry-on line (one per reset; the in-memory book can repeat it once after a restart within six hours).
NITs left: a small shared quota module instead of requiring status.js; compact-only regex forms; the source-match pin.
Next: the full validation once #4574 is on main (the queue override would otherwise red the queue tests), then proof.

## After the full validation (2026-09-29 23:23: REAL FAILURE, 2 tests)
- fixture-discipline.test.js: engine/agyquota-4588.test.js hand-built five roster rows (object literals with a
  sessionName key). FIXED: the rows are real cards from the real producer (fleet.install + status.snapshot()), copied
  with only the state each scenario needs; the roots are sandboxed first.
- render-talk-goldencard-2519.test.js: the recorded card lacked the new quotaUntil key. FIXED with the sanctioned
  tool (node tools/capture-agent-card.js), which added exactly one key, "quotaUntil": null.
- Then main (d30a0c13a, the #4609 queue fix) merged in and re-queued with no override.
- Main merged (6accc3917); full validation PASSED on it (2026-09-30).

## Review iteration 7 (blind, opus), after the test rewrite and the main merge
- (W) FIXED f09873dc5: nothing tested the seam carrying the reset from the hook to the board (main() passing
  mapped.until to buildBody). agyhooks.test.js drives the real bridge against a stub /api/report: a quota Stop posts a
  strict ISO until at the reset with the QUOTA_REPORT_PREFIX sentence; an ordinary error posts none. Red with
  mapped.until dropped.
- (W) FIXED f09873dc5: the reset-time format was written three times and the copies differed (status.js abs, the
  others signed). One rule, engine/quotawords.js (abs: a days-old past reset gets its day), used by status.js and
  accountproblem.js; the page keeps a copy and web.agyquota-4588.test.js compares the two from -72 h to +72 h. Red
  with the page on the signed rule. Two tests had a fixed reset date gone stale that passed only because the signed
  rule never gave a past time its day; they now use a reset 30 minutes out.
- NITs left: the 55 s spacing is board-wide, not per Google account (the safe side); 'unknown' in NUDGE_OVER is
  unreachable for a quota-paused card; paneless cards omit quotaUntil rather than null; one long header line in
  agyquota.js; the review-4 "at rest" note above was overtaken by review 5.

## Review iteration 8 (blind, sonnet): CONVERGED (no NEW finding)
- clock skew of the hook host: duplicate of the standing deferral (iterations 1 and 6).
- in-memory resume book repeats after a restart: duplicate of the standing deferral (iterations 3 and 5).
- DEFERRED: the quota branch applies only over an UNKNOWN or IDLE screen, and no test pins that agy's screen is
  never read. By design (review 2): a question, work or a lost connection read off a screen outranks this report, so
  if agy's screen is ever read, the screen winning is the intended behaviour, not a silent loss.
NITs: word-form resets ("1 hour 5 minutes") read as none; agyquota.js requires status.js for two constants; the page's
day suffix can flip between renders at the 20 h line; the server wiring pin is a source match.
Next: the final validation on this HEAD, then proof and PR.

## After merging main 2026-09-30
- Merged origin/main (41 commits) as 68d7c5027. Two conflicts, both sides kept:
  - bin/agy-report-bridge.js: main's #4569 made buildBody's 4th argument `waiting` (a Muse queue count); this
    branch's `until` is now the 5th, and the send passes mapped.waiting, mapped.until. reportFor auto-merged:
    `waiting` only on a working report, `until` only on a quota idle.
  - web/index.html: main's waitingLine and this branch's quotaResetWords sat in one place; both kept. stateReason's
    waiting line is working-only, the quota line rate_limited-only, so their order does not matter.
- Added a seam test (agyhooks.test.js): the real bridge posts a Muse queue count as `waiting` with no until. Controls,
  measured: dropping mapped.waiting at the send reds 1 test; swapping the two arguments reds 2. Before this test,
  dropping mapped.waiting reddened nothing (unpinned on main too).
- Single files, measured: agyhooks 36/36, the five 4588 engine/server/web files, status 211/211, goldencard 35/35
  (no re-capture needed: main's `waiting` and this branch's `quotaUntil` both present, both null), reason-grep 5/5,
  fixture-discipline 20/20, engine.reachable, geminisettings, agyseed-4417, musefront, selfreport/status/web
  4569, report-readback-2709, report-refusal-4606: all pass. Both browser-check gates pass.

### Review iteration 9 (blind, sonnet), over the merge: CONVERGED (0 BLOCKER, 0 WARNING)
Checked: the bridge throttle (only a repeated working is held, so a quota idle and its until always send); the report
route keeps until on an auto idle and #4606 only rewords a refusal; status.js ordering (main's Codex branch and
`waiting` do not touch the quota rule); the agy runner detection still yields 'antigravity'; a Muse Stop carries no
error, so it cannot read as a quota pause.
- NIT, left (PR B): main's #4624 roomhold.flushOnIdle runs on every idle report, the quota idle included, so room
  posts held while the agent worked are typed into it at the pause. The turn fails on the exhausted quota and files
  a fresh quota report; the pause card holds. Reasoned, not run. This is one of the automatic senders during the
  pause that PR B holds (see Rejected).

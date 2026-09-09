---
pre_challenge: true
method: challenge-loop
branch: pj-dismiss-state-2575
diff_hash: 7d39703c38bf0d6ceb4fc751d0fcefb3a12da8338e72dae648f80c01c197bd10
validation: passed
subdir_audit: passed
timestamp: 2026-09-09T18:23:11Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (both blind; multi-model rotation per #2032: sonnet then opus)
**Converged:** Yes (iteration 2, opus, found zero actionable findings)
**Total findings:** 3 (0 BLOCKERs, 2 WARNINGs, 1 NIT) -- all in iteration 1
**Fixed:** 3 | **Deferred:** 0 | **Asked:** 0

The change is the STATE half of #2575: a "Not waiting? Clear it" button
(`#pj-question-clear`) in the Projects question block that POSTs the merged engine
route `/api/agent/<name>/clear-selfreport` and re-reads the thread, so a stale
needs_you stops surfacing. It is distinct from the merged display-half Hide (a
per-session collapse that keeps the safety breadcrumb because the agent IS
waiting): Clear resolves the underlying state.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 NIT
**Self-generated:** 0 (all on the BRANCH diff)
- [WARNING] web/index.html (pjClearState) -- the failure message on
  `#pj-question-clear-msg` was never cleared on repaint, so a stale "could not
  clear" could sit next to a question a later 5s poll had refreshed --> FIXED: the
  message is now cleared on every paintThread repaint (a transient error, already
  announced), so it cannot go stale next to a fresh question.
- [WARNING] web/index.html (pjClearState) -- the failure wrote a `role="status"`
  live region directly; an identical repeat failure would not re-fire it (the
  round-33 pjAnnounce lesson, already hardened elsewhere for #pj-thread-msg) -->
  FIXED: the visible span is now non-live and the failure routes through
  `pjAnnounce` (blank-and-reset), so a repeated identical failure re-announces; a
  single `FAIL` constant keeps the visible and announced text byte-identical.
- [NIT] web/index.html:34845,36757 -- the two direct `#pj-question` hide sites
  (loadThread no-recipient; openProject reset) did not null `PJ_QUESTION_AGENT`,
  unlike paintThread's non-asking branch. Not a live bug (the button is inside the
  hidden block, so unclickable), but it left the invariant partial --> FIXED:
  null `PJ_QUESTION_AGENT` at both sites (placed AFTER `pjApplyEngMode()` so the
  fold-boxes 200-char source-pin still holds), so the invariant "null whenever the
  question is not painted-asking" holds at all four sites.

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 -- **CONVERGED**
- Verified the false-calm rule (#370/#2146) holds on every failure path (rejected,
  thrown, malformed JSON all route to sayFail + return without loadThread, so the
  question and breadcrumb stay painted); the target is captured synchronously
  before any await (no retarget race); the `PJ_QUESTION_AGENT` invariant holds at
  all four sites; success keys on `res.ok && body.ok === true`, never `by`, with
  both `cleared:true`/`false` refreshing; the announce lifecycle is correct; the
  test lifts and runs the real function; and the pre-existing fold-boxes source-pin
  still holds.

### The load-bearing safety property (both reviewers)
Clear must never become the false-calm the #370/#2146 auto-surface exists to
prevent. Every failure path leaves `qWrap.hidden` and the breadcrumb exactly as
painted (only `loadThread` can hide the question, and no failure path calls it),
and a 200 with an empty/malformed body is treated as failure (the safe direction).
So Clear only removes a waiting signal after the engine has ACTUALLY recorded idle;
a failed clear never produces a silent calm.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html (pjClearState) | BRANCH | stale failure msg not cleared on repaint | FIXED | cleared on every paintThread repaint |
| 2 | 1 | WARNING | web/index.html (pjClearState) | BRANCH | identical repeat failure not re-announced | FIXED | non-live span + pjAnnounce routing |
| 3 | 1 | NIT | web/index.html:34845,36757 | BRANCH | PJ_QUESTION_AGENT not nulled at 2 hide sites | FIXED | nulled after pjApplyEngMode (pin-safe) |

### Outstanding questions (ASKED)
None.

### Strengths (across iterations)
- Target capture is race-free (`const target` before any await) and the invariant
  holds at all four hide-sites (opus).
- Correctly keyed on ok/cleared, never `by`; a source-pin test locks provenance out
  of the success decision (opus).
- The test lifts and runs the real `pjClearState` (page.lift, with pjAnnounce as a
  closed-over param), covering success/idempotent/rejected/thrown/null-target plus
  source-pins; 8/8 green, fold-boxes 3/3 green.

### Validation
`validation_log_run_or_skip` PASSED for stack=typescript, hash=7d39703c38bf
(full node suite + bc-surface-map arms + build step). The #1720 web/ gate is
satisfied by the `Browser-check:` trailer (this bot cannot run a headed served
check); the served click-verify is routed to the claude-fe browser-remainder pass.
The #2518 surface gate is not triggered (render-thread.js declares no tokens).

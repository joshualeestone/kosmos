---
pre_challenge: true
method: challenge-loop
branch: limithold-5805
diff_hash: b48f92cfb39b3e0a74ca1e8bb4aefd6aac2aebd849acd69d732087c856aede8a
validation: passed (Mortals full suite at ccfc6b130, 18693 tests, 18450 pass, 0 fail, 0 cancelled, 2026-10-10 22:26 CDT; local helper skipped on that clean entry, hash b48f92cfb39b)
subdir_audit: passed
timestamp: 2026-10-11T03:29:09Z
iterations: 18
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 18
**Converged:** Yes (iteration 18 found no new issues)
**Reviewer models:** alternating opus (odd) and sonnet (even).

Note: the loop read as converged at iterations 10 and 12 and was reopened both times by defects found outside a
review (the page's quota wording for a limit-held wake, found by the slice-2 survey; the golden agent card's missing
screenState, found by a full-suite run on a stacked branch). Both are fixed and listed below. Each review's findings
and dispositions are recorded in .claude/plans/limithold-5805.md ("Review N" sections), copied here.

Note on 6.0: no local full suite (the shared Agent1s queue); the full suite ran once at convergence on Mortals.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- FIXED (BLOCKER): a limit-held ask older than a day was dropped at the flush by staleHeld's day rule; it now counts
  from the reset for limit holds only (tested with the real staleHeld, and the quota control unchanged).
- FIXED (BLOCKER): the cap mark made a post that named the member read "Nothing is asked of you"; limit holds keep the
  normal marks and the retry looks for addressed posts (the told line is asserted).
- FIXED: four senders called a limit hold the Google quota; they say limit-held (tested for firstreply and agentnudge).
- FIXED: the retry no longer wakes a member for posts that ask nothing of it (those stay unmarked and wait).
- FIXED: the room test's stale stub bypassed staleHeld; it uses the real one. NITs taken: the same isNamedOurs test in
  the hold and the retry; the reset-grace minute is commented.

#### Iteration 2
**Reviewer model:** sonnet
- FIXED: a post held while the member worked and limit-held only at its turn-end flush had no record of the limit, so
  the day rule still dropped it. The limit is now recorded at both points in roomhold's `<member>.limit`, and
  withoutStale keeps back an unanswered ask until a day after the reset (tested: the flush path, answered, grace past,
  another member, a plain post). This replaced a `heldBy` field on post rows, which the flush path could not write.
- FIXED: replynudge's limit-held arm is tested. NITs taken: one `chat.limitable` test for the hold and the retry; the
  reset-grace minute is a stated residual. Not taken: a test of the hello route's text (one string beside the menu arm).
- Found in this round by the new flush test: an edit had referenced `sent` outside its block, which would have thrown
  on every idle flush; fixed before commit.

#### Iteration 3
**Reviewer model:** opus
- FIXED: after a dated reset Claude's limit menu can stay up (status keeps the card capped for that reason); the hold now
  lasts while the card reads capped, looking again every minute, instead of ending at the printed reset (tested).
- FIXED: the Claude retry told every held project once any ask existed; it now tells only a project whose ask survives
  withoutStale and puts the rest back (askedOnly, tested).
- FIXED: an arrival limit-held now records every ask it put back, not only the new post.
- NITs taken: forgetProject clears its room's limit entries and an empty sidecar is removed; tests for merge and
  prune; stale comments ("the cap's mark") corrected; the server predicate is source-asserted; the two comment blocks
  above limitable merged.

#### Iteration 4
**Reviewer model:** sonnet
- FIXED: a dated limit line status never retires (another wording) could keep the post-reset re-look going for good; it
  stops an hour after the reset (tested both sides).
- FIXED: the Claude retry woke an idle member for any held ask; it now needs the ask's limit record, so other holds keep
  their #4624 behaviour (tested), and a project without one is not taken and rewritten every minute (#4797).
- NITs not taken: a lock on the sidecar (single board process, synchronous atomic writes, as the held file itself);
  driving the server predicate against a real card (it is chat.limitable plus the state, both tested; source-asserted).

#### Iteration 5
**Reviewer model:** opus
- FIXED (BLOCKER): after the reset the card read blocked (the StopFailure report stands), so the idle-only release
  never fired; chat.limitReleased reads the screen under that report (screenState).
- FIXED: in its first five minutes that report outranked the limit screen, so nothing was held; it no longer does.
- FIXED: the hour cap ended the hold with the limit menu up; the menu keeps it.
- NITs taken: the past-reset test's idle is checked against the engine; an arrival records the new post only when it
  names the member.

#### Iteration 6
**Reviewer model:** sonnet
- FIXED: re-looks restarted the day grace from each look; the day counts from `limitReset`, the printed reset.
- FIXED: a failed limit record was silent; it is logged.
- DEFERRED: a test across the hold-to-release handoff; both sides are pinned by the real-card tests above.

#### Iteration 7
**Reviewer model:** opus
- FIXED: an ask held while the member worked got no limit record when the turn failed on the limit and nobody posted
  during the pause; the minute sweep records it while the member is limit-held (tested, with a plain-post control).
- DEFERRED: per-minute retry of a limit-kept ask whose try keeps failing (stated under Residuals).
- FIXED: this plan, which had stopped at review 4. NITs taken: the idle flush records addressed asks only; the menu
  helper no longer splits retireResetLimits from its comment. Not taken: a shared helper for the held-by wording, and
  one menu test for both readers (a quoted menu title past the cap would only hold lines longer, never type them).

#### Iteration 8
**Reviewer model:** sonnet
- FIXED: the minute sweep asked for the limit verdict before checking the member held anything; the held check is first.
- DEFERRED: past the hour cap a capped card's delivery reads the pane for the limit menu. Only a card whose dated line
  never retires reaches it, and the menu hold already reads the pane per delivery for needs-you and working cards.
- NIT taken: providerLimitReport no longer splits the #4588 part 3 comment from reconcileReport.

#### Iteration 9
**Reviewer model:** opus
- DEFERRED, by design (decided): the handoff-restart pickup sends with `{ cap: false }` and the limit holds it. The
  usage limit is the Claude form of the shared quota, which holds that route, not of the Gemini cap the person's click
  overrides: typed into a capped session the pickup lands on the limit screen and is lost, while the 409 shows the
  person the manual line. Weakest premise: a stale roster just after a restart could give a needless 409, which costs
  one manual line. What would change it: evidence that a restarted session often reads capped from an old roster.
  Pinned by a test.
- NIT taken: the staleHeld comment's broken wrap. Not taken: an injected clock for withoutStale's limitKept (tests
  pass explicit times to limitKept directly); the shared held-by wording helper (as before).

#### Iteration 10
**Reviewer model:** sonnet
- NO NEW ISSUES (the loop read as converged here).

**Found after iteration 10 (not by a reviewer):**
- FIXED: the page's wakeHeldLine had arms for cap and menu only, so a wake or handoff pickup held on a usage limit
  told the person "This computer's shared Google quota is out". It now says the agent is out of usage, until the
  printed reset while that is ahead (web.wake-hello-automatic-4959.test.js; Browser-check trailer on 72e4f5aff).

#### Iteration 11
**Reviewer model:** opus
- FIXED: the minute sweep's limit record (review 7) skipped the day rule, so an @ask held for days could be stamped
  with a fresh reset and delivered after it. It now records only asks `stale` would not already drop even when asked
  (answered, or a day old), without logging them as dropped (tested: a three-day-old ask is not recorded, a fresh
  one is).
- Not taken: one read of the limit file per sweep (a small JSON file; correctness unaffected); the shared held-by
  wording helper (as before); a long comment line.

#### Iteration 12
**Reviewer model:** sonnet
- NO NEW ISSUES (the loop read as converged here).

**Found after iteration 12 (not by a reviewer):**
- FIXED: the golden agent card (docs/browser-checks/fixtures/agent-card.json, #2519) had no `screenState`, the pane
  card field review 5 added, so render-talk-goldencard-2519 failed on drift. Added as null, where the card builds it.

#### Iteration 13
**Reviewer model:** opus
- FIXED: past the printed reset the page told the person the agent was still out of usage, when the hold then lasts
  only while its limit screen is up; it now says the usage has reset and to answer the screen in its window (tested).
- FIXED: stale comments (flushReleased's header said only Antigravity cards are retried; three comments listing the
  hold kinds left out the usage limit).
- NIT taken: flushReleased reads the card's state before any file, so a card neither capped nor released costs nothing.
  Not taken: anchoring claudeLimitMenuUp below the limit row (it fails toward holding longer); the held-by wording
  helper (as before); stating that a second limit within a day carries a still-kept ask forward (it is the same ask,
  still unanswered).

#### Iteration 14
**Reviewer model:** sonnet
- FIXED: limitHeldVerdict's comment sat above the two constants instead of the function; it now sits on the function.
- Duplicates: the sidecar lock (reviews 4 and 10), the pane read past the hour cap (review 8).
- DEFERRED: flushReleased calls chat.limitHeldVerdict directly rather than through an injected option. It reads only
  the card unless the card is capped past the hour cap, and roomhold already requires chat lazily (addressable).

#### Iteration 15
**Reviewer model:** opus
- STATED (scope, not built): a weekly limit's last day prints a time with no date, so it is not held; the plan said
  "dateless" meant only the 5-hour form. Slice 3's first-seen time covers it.
- STATED (residual): a limit menu nobody dismisses ends with the kept asks dropped a day after the reset.
- FIXED: two more comments listing the hold kinds without the usage limit (messages reply nudge, missedtell).
- NIT taken: flushReleased's pre-filter passes only a capped card the limit hold applies to (a capped Codex or Gemini
  card costs nothing). Not taken: the held-by wording helper; one read of the limit file per sweep.

#### Iteration 16
**Reviewer model:** sonnet
- FIXED: flushReleased's pre-filter spelled the state as a literal; it reads status.STATE.RATE_LIMITED, and the lazy
  requires say why they are lazy.
- Duplicates of stated premises: the limit wording (weakest premise) and StopFailure not measured live (residual).

#### Iteration 17
**Reviewer model:** opus
- DECIDED and pinned: the report-under-screen rule applies to the dateless form as well (the card reads rate_limited,
  not blocked; nothing held; tested).
- STATED (residual): a told ask's limit record lapses rather than being removed.
- Not taken: hoisting the lazy requires; an injected clock for withoutStale; the held-by wording helper; the pane read
  past the cap (review 8).

#### Iteration 18
**Reviewer model:** sonnet
- NO NEW ISSUES (the loop read as converged here).

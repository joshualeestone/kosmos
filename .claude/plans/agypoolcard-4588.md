# agypoolcard-4588: a card held by a colleague's pause says so (#4588 part 3)

Card: #4588 ("show the shared pool" in its title). Stacked on PR B (agyhold-4588), which is stacked on PR A.
Found by PR B's review 11; recorded on the card (comment 5903897664).

## Call
- engine/status.js asks agyquota.heldBackBy(own reset), the resume's own rule, and requires the result ahead of now.
- engine/status.js, the post-reset branch: if the pool is paused past this agent's own reset, the card reads
  rate_limited (Paused): "the reset it was given (X) has passed, but its Google account's shared quota was reported
  paused until Y", with the time in a new `poolUntil` field; the snapshot copies poolUntil.
- engine/accountproblem.js: a pool-held branch for the Direct Message line (no "add credits", no "send it a message",
  notify: false).
- web/index.html stateReason: "Waiting for the shared Google quota, reported to reset at Y."

## Rejected
- Putting Y in quotaUntil: quotaUntil feeds the pool memory (notePool), so a card echoing the pool's reset would keep
  the pool held after the colleague's reset was corrected (a self-sustaining hold).
- Showing every idle agy colleague as Paused while the pool is held: they have no quota report of their own, and the
  card rule keys on the agent's own report; left for later if wanted.

## Weakest premise
With the resume switched off (AGENT_WORKFORCE_AGY_QUOTA_RESUME_OFF=1), the pool memory is fed only by automatic sends,
so the card may not show the hold and falls back to PR A's post-reset line. Not fed from the status read on purpose:
a read stays a read.
The memory is fed by the timers and the resume sweep each minute, so the card can lag a sweep behind a new pause or a
correction; and after a board restart the memory is empty until a sweep runs.

## Measured
- First build: engine/status.agypoolcard-4588.test.js 3/3 (4 tests now), web.agypoolcard-4588.test.js 1/1, with PR A's status and web files and
  engine/agyhold-4588.test.js: 42/42.
- Both browser-check gates run directly: the web/ gate accepts the Browser-check trailer; the surface gate passes.

## Review iteration 1 (blind, opus)
- (W) FIXED: a pool-held card has no quotaUntil, so the account line fell to the generic rate_limited branch ("add
  credits ... then send it a message"), the advice PR A removed and the invitation this change removes. It has its
  own branch now.
- (W) FIXED: the card read any remembered pool reset, so an old stop the resume will never pick up turned Paused when
  a colleague paused. It now asks heldBackBy, the resume's rule; poolPausedAt is removed.
- (N) FIXED: the always-true guard is gone and the control relabelled; the comment says "Google account".
- (N) LEFT: the snapshot-field test is a source pin (as the two existing ones are); a card could in a tiny window say
  "another agent" about its own newer entry.
- Measured: 55/55 (the new files with PR A's status/web/accountproblem files and agyhold-4588). Mutations: the card
  reading any remembered reset (the old-stop test reds), and no account branch (the account test reds).

## Review iteration 2 (blind, sonnet)
- (W) DEFERRED: with the resume off, or after a restart until a sweep or send runs, the memory is empty and the card
  shows PR A's post-reset line. Feeding the memory from the status read would give a GET a side effect, which this
  codebase avoids; named under Weakest premise.
- (W) FIXED (claim narrowed): the card reads Paused while the pause stands; for the grace and stagger after the pool's
  reset it shows PR A's "has not picked up again", true until the carry-on line lands (PR A iteration 6's decision).
  The comment no longer says "exactly when the resume is waiting".
- (W) DEFERRED: reconcileReport reads the module memory through a lazy require (best-effort, as the module already
  does); files are process-isolated and the new tests clear the memory before each test.
- (N) FIXED: the comment says heldBackBy counts a pause first seen inside the agent's own six hours.
- (N) LEFT: the time formatting repeated in three places (Math.abs vs signed differ only for a past time, which never
  reaches this branch); the snapshot source pin.

## Review iteration 3 (blind, opus)
- (W) FIXED: the Direct Message line promised the agent "carries on by itself"; the resume can be switched off or give
  up (PR A's card deliberately makes no promise). Dropped: it says when the quota is paused until.
- (W) FIXED: the card, the line and the page said "another agent", which heldBackBy cannot guarantee (the memory does
  not exclude the agent's own newer entry). All three now say the account's shared quota is paused, true whoever
  caused it; the tests assert "another" is gone.
- (N) LEFT: a paneless agy card (PR A's gap: an agy agent always has a pane); the snapshot source pin; the formatting
  in three places; long comment lines.

## Review iteration 4 (blind, sonnet)
- (W) duplicate of Weakest premise: the card lags a sweep behind a new pause and is empty after a restart (safe side).
- (W) duplicate of PR B's Weakest premise: nothing releases a hold early, so "still paused until" stands if a
  colleague's pool refills early (the card and the hold agree).
- (W) FIXED: the account line and the page did not check that poolUntil is still ahead; a stale card's past time now
  falls to the lines below rather than being said as "paused until" / "resets at". Tests pin a past time both places.
- (N) FIXED: the comment's "Said so" sentence reflowed. (N) LEFT: the snapshot source pin; the formatting in three
  places; the account line's wording.

## Review iteration 5 (blind, opus)
- (W) FIXED: nothing tested the poolAt > now half of the guard (a colleague's reset after its own that has passed);
  a control arm pins it now.
- (W) FIXED: a stale poolUntil fell through to the generic "add credits ... send it a message" line, the advice this
  change removes (my stale test accepted it). A pool-held card always gets the Google-worded line; the time is said
  only while ahead. The test asserts the generic advice is absent.
- (N) NOTED: commit 4439a65c0's message quotes the retired page wording; the squash message is written fresh at merge.
- (N) FIXED: the plan's first-build count. (N) LEFT: the snapshot source pin; the formatting in five places.

## Review iteration 6 (blind, sonnet)
- (W) duplicate: "still paused until Y" stands if the pool refills early (no early release; PR B's Weakest premise,
  recorded at review 4 here).
- (W) FIXED: a stale poolUntil on the page fell to the generic "Usage limit reached"; the page now says "Waiting for
  the shared Google quota." with no time, as the Direct Message line does.
- (N) LEFT: the best-effort catch around heldBackBy; the formatting in five places; the snapshot source pin; the
  stale Direct Message line asserting a wait that may be over (no advice, no time).

## Review iteration 7 (blind, opus)
- (W) FIXED: the card, the Direct Message line and the page stated a deliberately cautious hold (nothing releases it
  early) as observed fact. All three now say the time as reported ("was reported paused until Y"; the card adds that
  Kosmos holds its automatic messages until then). This also fixes the "two quotas" phrasing.
- (W) NAMED: an agy setup guide held by the pool now reads rate_limited, so setup-assistant's guideFailure switches the
  bubble to the hosted assistant for the pause (own_model_failing). Existing rate_limited handling meeting a new input,
  and the better outcome: a message to the guide would spend a turn against the empty quota; the fallback line ("The
  Google quota refills by itself.") is true here.
- (N) FIXED: the status comment says where the memory's input comes from and that the time is said as reported.
- (N) NOTED: commit 4439a65c0's message describes removed code; the squash message is written fresh at merge.
- (N) LEFT: the snapshot source pin; the formatting in five places.

## Review iteration 8 (blind, sonnet)
- (W) FIXED by removal: review 7's clause "Kosmos holds its automatic messages until then" named the card's time, but
  the hold runs by its own rule (the latest remembered reset) and release steps, so it could understate it. The card
  says only the reported time; the test asserts the clause is gone.
- (W) duplicate of review 7's named entry: the setup guide's hosted fallback while held (it goes in the PR description).
- (N) FIXED: reconcileReport says it reads the pool memory for a quota report.
- (N) LEFT: the stale Direct Message line's "is waiting"; the snapshot source pin; the formatting in five places.

## Review iteration 9 (blind, opus): CONVERGED (NITs only)
NITs left: the stale Direct Message line's present-tense "is waiting" (no advice, no time; reviews 6 and 8); the
snapshot source pin (as its sibling); the formatting in five places; the status comment names the resume sweep and
automatic sends as the memory's feeds, while the assigner, retell-ready and recommender hold checks feed it too (the
comment understates the feeds, the safe direction).
NEXT: this branch is stacked on PR B (agyhold-4588), which is stacked on PR A (agyquota-4588). Validation, proof and
PR in that order, after PR A and PR B land.

## After PR A's validation found two fixture defects (00:05, 2026-09-30)
- Merged the updated PR B (its tests now use real fleet cards). This branch's own account test hand-built its card
  (fixture-discipline); it now spreads one real antigravity card from fleet + status.snapshot(), sandboxed.
- The golden agent card is re-captured with tools/capture-agent-card.js: the producer now emits poolUntil (one key).

## After PR A's review iteration 7 (2026-09-30 03:00)
Merged PR B (with PR A's f09873dc5) in. PR A made engine/quotawords.js the one rule for writing a reset time; this
branch had three more copies of it (accountproblem.js's paused-until line, status.js's pool line, the page's pool
line; two on the old signed form). All three now use the one rule; web.agypoolcard-4588.test.js lifts the page helper.

## Rebased onto main after PR A merged (fd4dd0383), 2026-09-30
- Old head d8c38129c, stacked on PR B's old head 3a86d5420 (merged in as 0f6c3c220 and 8d070c936). New base: PR B
  rebased onto origin/main fd4dd0383, agyhold-4588 at 4cba8fcb6.
- How: `git -c core.commentChar=";" rebase --onto agyhold-4588 3a86d5420 agypoolcard-4588`, then once more onto
  4cba8fcb6 after PR B's plan commit. Dropped: the two merges of PR B (0f6c3c220, 8d070c936) and everything they
  carried (PR A, main, PR B's own commits, which now come from the rebased PR B). 8d070c936 held one resolution, in
  web/index.html stateReason (PR A's quotaResetWords beside this branch's pool line); d8c38129c had already moved the
  pool line onto quotaResetWords, so the replay needed it no more. Kept: this branch's 14 non-merge commits,
  4439a65c0 through d8c38129c. No conflicts. range-diff: 12 identical, 2 changed only in context.
- Check: `git diff agyhold-4588 HEAD` is exactly this branch's 8 files, +301, and byte-identical to the old
  `git diff 3a86d5420 d8c38129c`.
- Focused tests, one node --test run with the runner's two guards, 56 files (PR B's 53 plus this branch's three new
  ones): 1137/1137, rc 0. Both browser-check gates rc 0 (the web/ gate on d8c38129c's Browser-check trailer).
- Browser checks tools/bc-pr-select.js selects for this branch (the page and fixtures/agent-card.json):
  render-talk, render-waiting-phone-718, render-needsyou-dealarm-2808, render-fields, contrast. Queued one each on
  the light lane; results recorded below when they end.
- Review: the 9 blind iterations above ran on the pre-rebase tree; the rebase changed no line of this branch's diff.
- Browser checks, light lane, on d071095f5 (the frozen runner copy names it): render-talk, render-waiting-phone-718,
  render-needsyou-dealarm-2808 PASS. contrast and render-fields were given the same turn at 16:31:53 and refused by
  browser-checks.sh's own "another browser-checks run is already live" guard (rc 1, no check ran); queued again one
  after the other: contrast PASS, render-fields PASS. All five pass.

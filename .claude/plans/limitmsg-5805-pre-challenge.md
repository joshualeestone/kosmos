---
pre_challenge: true
method: challenge-loop
branch: limitmsg-5805
diff_hash: f46c423906a7a223499e8b6a8630d1b0c7302368aca5d643e0279d35b3bca046
validation: passed (Mortals full suite at c157c6fb0, 18852 tests, 18609 pass, 0 fail, 0 cancelled, 2026-10-11 00:22 CDT; local helper skipped on that clean entry, hash f46c423906a7)
subdir_audit: passed
timestamp: 2026-10-11T05:22:49Z
iterations: 21
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 21
**Converged:** Yes (iteration 20 found no new issues before the rebase onto main; iteration 21 found none after it)
**Reviewer models:** alternating opus (odd) and sonnet (even).

Note: the first Mortals run at 88553261d failed on engine.reachable (limitqueue's isTyping, a test-only export), fixed
in c157c6fb0 (file-keyed test seams) and validated again; its other red (remove.test.js #4006 timing under load 18.7)
passed alone, 93/93. Each review's findings and dispositions are in .claude/plans/limitmsg-5805.md, copied here.

Note on 6.0: no local full suite (the shared Agent1s queue); the full suite ran on Mortals.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- FIXED (BLOCKER): queue files are keyed by the store key, so two names with one key shared a file and one agent's
  messages could be typed to another. A name that is not its own key is not kept (refused, as any could-not-keep), and
  the sweep types only entries addressed to that exact agent (both tested).
- FIXED: a sweep still typing a backlog when the next minute started would type each message twice; one run at a time.
- FIXED: the same send again after the held copy was typed answered "held" as a raw state; it is now that delivery
  (placed, duplicate), and after a drop it goes as new. The repeat-send fold never passes "held" through.
- FIXED: held past the printed reset, the sender was promised a time already past; no time is promised then.
- FIXED: a dropped message's sender, told it was accepted, was never told otherwise; Kosmos tells it in its own pane.
- DEFERRED: the board UI shows no state for these rows. It renders no agent-to-agent message rows at all (no reader of
  /api/messages in web/), so there is no "delivered" impression to correct there.
- NIT taken: the bash CLI matches heldBy "limit" as the Windows CLI and the outbox predicate do. Not taken: a test of
  server.js's sweep wiring by running the server (a half-sandboxed server refuses to load; the predicate is tested).

#### Iteration 2
**Reviewer model:** sonnet
- FIXED: the repeat-send fold looks back minutes and a hold lasts days, so a later retry kept a second copy. The same
  send (sender, text, the message it answers) already kept for that agent is that copy at any age; a cap per agent
  (now 200, with 20 per sender since review 3; one more is refused as could-not-keep). Both tested.
- FIXED: a dropped long message left its spilled file behind; it is removed with the drop (tested).
- FIXED: after an unconfirmed delivery the next kept message was typed on top of it; it waits for the next minute
  (tested).
- Covered by the first fix: two identical sends at once (the held branch is synchronous, so the second finds the first).
- NITs taken: a queue file with nothing readable left is removed; the sweep's one-run guard wraps a separate function.

#### Iteration 3
**Reviewer model:** opus
- FIXED: kept messages waited for slice 1's release test while fresh sends stopped being held an hour past the reset,
  so old messages were dropped while new ones arrived. The sweep releases on chat.limitQueueReleased: slice 1's test,
  or no longer held at all, the test a fresh send meets (tested).
- FIXED: in the minute between release and the sweep a new send was typed ahead of the kept backlog. While an agent
  still has kept messages a new one goes behind them, told so in its own words (tested in order).
- FIXED: one sender looping with new text each time could fill the cap and crowd out everyone else; 20 per sender,
  200 per agent (tested).
- NITs taken: the recent-send fold no longer promises a time already past; the sweep is skipped when the roster cannot
  be read (a drop then waits for a minute when its sender can be told). Not taken: the spill written before the hold
  check (removed on refuse and drop); names() pruning empty files (commented where it happens).

#### Iteration 4
**Reviewer model:** sonnet
- FIXED: reads (list, has, keptByKey) now see only entries addressed to that exact agent, as the sweep already did, so
  a colliding name cannot pick up another agent's backlog or kept copy (tested).
- FIXED: an entry whose reset cannot be read is dropped a day after it arrived, so the day rule holds unconditionally
  (tested).
- NIT taken: sendWithDelivery's header names the held answer and the 'held' row state. Duplicate: the pair valve
  counts held sends (stated under Residuals). Not taken: an in-memory count to skip the queue read on every send (a
  missing file is one failed open).

#### Iteration 5
**Reviewer model:** opus
- FIXED: review 1 refused a name that is not its own store key, so an adopted session with a capital or a dot lost the
  hold. Queue files now carry a hash of the exact name: two names with one store key each keep their own file, and
  no name is refused (tested). Reads still see only entries addressed to that exact agent.
- FIXED: a send to an agent that cannot be reached joined its leftover backlog and was answered held; it is refused as
  before (the held branch already required an addressable agent; tested).
- FIXED: a repeat of a held message that was typed folded into it even after the two had spoken since; it now follows
  #4580's rule (quiet since) and its unconfirmed wording (tested).
- DECIDED (stated in chat.limitQueueReleased): the sweep types through the automatic gate, so a question or permission
  menu on screen, or a quota hold, also keeps kept messages, and new ones behind them, waiting, where a fresh message
  would be typed straight in. A line typed into a menu answers it; waiting a minute is the lesser cost.
- NITs taken: both CLIs word a message queued behind the backlog as that (a `behind` flag; tested); the bash match no
  longer depends on two keys sitting side by side; the sweep's one-run guard frees itself after 15 minutes; the double
  filter is gone.

#### Iteration 6
**Reviewer model:** sonnet
- FIXED: a typed or dropped message whose removal from the file failed was typed (or its sender told) again the next
  minute. The board remembers those ids, skips them, and tries the removal again (tested with an unwritable folder).
- FIXED, found by that test's control: removing the last message deleted the file and reported success even when the
  delete failed; a failed delete is now a failed removal.
- NITs: none taken (a message queued behind takes the last entry's reset, which the receipt already treats as no time
  to promise; the bash CLI's substring match runs only on a held reply).

#### Iteration 7
**Reviewer model:** opus
- FIXED: a message queued behind the backlog took the backlog's reset as its drop clock, so it could be dropped minutes
  after it was sent; its day counts from when it was sent (tested).
- FIXED: the behind receipt promised "within a minute or two", which a menu or quota hold on screen can break; the
  receipt and both CLIs no longer promise a time.
- FIXED: the dropped-message notice named a cause ("stayed out of usage") that is not the only one; it says what is
  known: Kosmos kept it for a day and could not type it.
- NITs taken: the sweep checks a message is still kept just before typing it (so a run that outlived the one-run guard
  cannot type it twice); a repeat of a held message that was typed reads the delivery row before the queue; the bash
  CLI accepts a space after the colon; the flush comment sits on flush.

#### Iteration 8
**Reviewer model:** sonnet
- DEFERRED, by design: a held row counts as a send for the pair valve and for the sender's activity; the sender did
  send it, and no reader shows it as delivered. NITs not taken.

#### Iteration 9
**Reviewer model:** opus
- FIXED: a plain hold took the printed reset as its drop clock, so with the limit menu left up a day past the reset a
  message was dropped a minute after it was held; the clock is the later of the reset and now (tested).
- FIXED: a repeat of a message queued behind a backlog lost its behind wording; the kept entry remembers it (tested).
- FIXED: a run that outlived the one-run guard could type a message alongside a newer run. Each message is claimed
  while it is typed (isTyping), and only the run that set the guard frees it (tested: claimed, and a second sweep at
  the same time types nothing).
- NITs taken: the store-key test's title; the plan's entry shape. Not taken: heldUntil as UTC ISO (the agent parses
  it); the double names() read.

#### Iteration 10
**Reviewer model:** sonnet
- STATED (residuals): a restart between paste and removal can type a kept message once more; a message behind a
  backlog that never clears is dropped a day after it was sent, its sender told.
- Verified covered: a repeat of a typed held message after the two have spoken since goes as new (review 5's test).
- CONVENTION taken: the per-send queue read is commented where it happens. NITs not taken.

#### Iteration 11
**Reviewer model:** opus
- FIXED: a run that outlived the one-run guard let a newer run skip the message it held and type later ones ahead of
  it; a claimed message now holds that agent's run (tested with the clock moved past the guard).
- FIXED: a long backlog was typed against a roster read once, so an agent that hit its limit again mid-backlog got the
  rest anyway; at most 5 messages per agent per minute (tested).
- CONVENTIONS taken: the claim's comment says what it guards (another flush run), and limitqueue.js is in the #5434
  writer guard's two lists (its title no longer counts the writers, so two branches adding one do not collide).
- NIT taken: the plan's cap figure matches the code. Not taken: heldUntil in UTC; the repeated addressable call.

#### Iteration 12
**Reviewer model:** sonnet
- DEFERRED (checked): a held long message's spill sits in the recipient's Inbox for the hold; nothing prunes the Inbox
  (searched engine/ and server.js), and the spill is removed on refuse and drop.
- Covered by a stated residual: the in-memory record of failed removals.
- NIT taken: MAX_PER_SENDER's comment was on PER_RUN's line.

#### Iteration 13
**Reviewer model:** opus
- FIXED: a kept message typed a day late read as new; the sweep adds "[kept for you while you were out of usage;
  sent <time>]" (tested).
- FIXED: a late retry of a kept message met the pair valve first and could be refused while its copy was kept; the
  kept-copy check runs before the valve and before an id or spill is made (tested).
- FIXED: the queue used the name as written while the router folds case, so two spellings of one agent had two
  queues; it is filed under the resolved card's name (tested).
- CONVENTIONS taken: the held-row read rule no longer sits between the reaction rule and its comment; "The call"
  matches the code.

#### Iteration 14
**Reviewer model:** sonnet
- FIXED (data loss): a queue file that could not be read for a moment (a rename in progress, too many open files) was
  deleted by the sweep's listing, and a send that met the same read error wrote a one-message file over the backlog.
  Reads now tell a missing file (empty) from an unreadable one (refused): add and remove refuse rather than
  overwrite, and the listing deletes only a file it read and found nothing for (tested both ways).
- STATED (residual): a restart can repeat a drop notice.
- CONVENTION taken: the held fold reads the delivery row once.

#### Iteration 15
**Reviewer model:** opus
- FIXED: every refusal to keep said "out of usage, could not keep"; it now says what happened (behind or out of usage;
  the per-sender cap, the per-agent cap, or the queue not written) (tested for the sender cap).
- FIXED: a drop could fall on a message a stuck run was still typing, telling its sender "never delivered" for one
  that arrived; a claimed message is not dropped (tested).
- FIXED: nothing tested the board's sweep wiring; a source assertion pins the gate, the release test and both
  outcome rows (tested).
- FIXED: a repeat of a message typed but not removed from the file answered "held"; it answers as that delivery
  (tested with a failed removal).
- NIT taken: the queue folder is owner-only (0700). Not taken: local time in the kept note and the CLI line.

#### Iteration 16
**Reviewer model:** sonnet
- FIXED: a paste that never settles left its claim for good, holding that agent's queue until a restart; a claim older
  than an hour (CLAIM_STALE_MS, longer than the 15-minute run guard so review 11's wait behind a slow paste still holds)
  is stale and the message is tried again (tested; found by review 11's test deadlocking on a shared threshold). Residual: if that hung paste did land,
  the message arrives twice.
- DEFERRED: a send to a card not yet released but not held either (a dateless limit) is typed, slice 1's stated gap;
  "after a drop it goes as new" is the design (review 1), noted as a coverage question.
- NIT taken: the comments above the claim check sit on the lines they describe.

#### Iteration 17
**Reviewer model:** opus
- FIXED: the check just before typing read an unreadable queue file as "removed", so a transient read error skipped a
  message and typed the next ahead of it; an unreadable file now stops that agent's run (tested).
- FIXED: a message queued behind a backlog was noted "kept while you were out of usage", which was false for it; it
  is noted "kept behind earlier messages" (tested).
- NIT taken: the behind decision ignores entries already typed or dropped (their removal failed). Not taken: the
  board log line's wording for behind entries; a pointer comment at readEntries.

#### Iteration 18
**Reviewer model:** sonnet
- FIXED: the behind decision read an unreadable queue as empty, so a new message could be typed ahead of a backlog;
  an unreadable queue is treated as possibly holding one, and the send is refused with "try again in a minute"
  (tested).
- DEFERRED (checked): no reader treats a held message row as one awaiting a reply; every reader of message rows (the
  read rule, the pair valve, reply citation, the repeat fold, sender activity) counts what the sender did.
- Covered by a stated residual: a hung paste holds its agent up to an hour.

#### Iteration 19
**Reviewer model:** opus
- STATED (residual): a drop notice to a sender that is itself held is never shown; the held-dropped row records it.
- STATED (residual): a dateless limit line releases kept messages as it does fresh sends (slice 1's stated gap).
- NITs not taken: the CLI wording for a held repeat; the repeat key built from the typed name (a different-case
  retry can keep a second copy); the roster read twice a minute.

#### Iteration 20
**Reviewer model:** sonnet
- NO NEW ISSUES. CONVERGED at iteration 20 (head ff612024f).

#### Iteration 21
**Reviewer model:** opus
- NO NEW ISSUES after the rebase onto main (slice 1 merged as #5818): every call into the parent's final code checked.
- NIT not taken: no test of limitQueueReleased on a card blocked by the StopFailure report; the reviewer traced it from the code (released, as limitReleased reads it). Adding it would have changed the diff under a queued Mortals run.

**Found after iteration 21 (not by a reviewer):**
- FIXED: limitqueue exports isTyping and isDone for its tests only; engine.reachable (#265) refused isTyping (isDone
  escaped only because another module has a reachable isDone). Both are file-keyed test seams in SEAMS_5548 now.
- Not this branch: remove.test.js #4006 timed out under load 18.7 on 12 cores; 93/93 alone.

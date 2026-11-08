---
pre_challenge: true
method: challenge-loop
branch: cconfirm-8216
diff_hash: 6548d818f80cc1545d16a2460168be973029ddc4d4ff4b4f26a514946b933301
validation: passed
subdir_audit: passed
timestamp: 2026-11-08T01:27:22Z
iterations: 14
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 14
**Converged:** Yes (iteration 14 raised two WARNINGs, both repeats of iteration 4: sent records with no id, already in the plan's Weakest part; the attempt time being the sweep's clock, already commented in the code; nothing new after deduplication; no ASKED findings)
**Total findings, raw (before deduplication):** 1 BLOCKER, 48 WARNINGs, 11 CONVENTIONs (3 of them notes that the plan exists and matches), 54 NITs; duplicates are named per iteration below
**Fixed:** the BLOCKER and every WARNING not listed as deferred or duplicate below | **Deferred:** the company-space branch untested (reasoned; its test needs the company-policy harness), and the same-words ambiguities written in Weakest part | **Asked (awaiting user):** 0
**Validation:** full suite (tools/run-tests.sh via the validation helper) green on HEAD 52427881b1, rebased on origin/main 994aff7679, 19:02 to 19:27 CST 11-07: node 27554 passed, 0 failed, 0 cancelled; test:shell 4 shards all green. The helper logged hash 6548d818f80c, the same as this proof's diff_hash. Between review rounds, the related tests (community*, server community*, web.community*, fixture-discipline, and every test that reads the changed modules) were run after each fix: 1328 passed, 0 failed at the last run.

**Self-generated (Origin) field:** not computed (6c-bis not run).

**Reviewer models:** opus on odd iterations, sonnet on even, all reviewed by reading only. Each review read the community service's source for route and field shapes.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 6 WARNINGs, 1 CONVENTION, 5 NITs
- [BLOCKER] engine/communitysend.js lookForComment: a found comment could already belong to another record, so a never-stored copy could claim a sent sibling's id and a take-back would delete the wrong comment --> FIXED (09e6a0276f): claimed ids from every record are never matched, and checked again against a fresh read before the write; tested
- [WARNING] records with no attemptedAt had no time bound --> FIXED: bounded by when the comment was made; none settled without a time
- [WARNING] replies to replies never found (the replies route refuses a non-top-level id) --> FIXED: found through the top-level comment that holds the parent; tested
- [WARNING] the look ran before the take-downs --> FIXED (moved; later last in the sweep)
- [WARNING] the "cannot look" words were wrong in two of three cases; canLook false on unreadable keys --> FIXED: neutral words, canLook null
- [WARNING] the company list is capped at 50 with no cursor --> FIXED: a full list is never complete
- [WARNING] coverage gaps --> FIXED: claimed id, legacy bound, reply to reply, paging, the time margin, 410, switch off tested
- [CONVENTION] plan claims (newest match, not before the send) did not match --> FIXED
- [NIT] 410 as complete --> applied; [NIT] stamp lookFirstAt only on an answer --> applied; [NIT] oldest match --> applied; [NIT] a doubled trailing comment --> applied; [NIT] company words --> applied later

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION (a note), 3 NITs
- [WARNING] an unreadable created_at passed the bound (NaN) --> FIXED (ec07dc5a29): a row whose time cannot be read never matches; tested
- [WARNING] the company list carries no parent --> written in the plan
- [WARNING] same-words copies paired by file order --> FIXED: oldest send first
- [NIT] since passed explicitly --> applied; [NIT] the doc says it runs under a stopping policy too --> applied; [NIT] dead post words --> kept (coverage)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 2 CONVENTIONs, 4 NITs
- [WARNING] no upper time bound --> FIXED (cb524fcc97): attemptedAt plus ten minutes and an hour; tested
- [WARNING] pairing held only within a page --> FIXED: every match collected, oldest wins; tested across pages
- [WARNING] the plain words promised a look for records never looked for --> FIXED: lookSkip marks
- [WARNING] untested fixes --> FIXED: a claim landing mid-look, the status words
- [CONVENTION] take-back, edit and removal words said "never learned" --> FIXED; [CONVENTION] the AT MOST ONCE doc --> FIXED
- [NIT] a tries ceiling --> applied; [NIT] fake preview of 2 and post check --> applied; [NIT] foundAt name --> applied; [NIT] no extra read when the preview holds the thread --> applied

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 3 NITs
- [WARNING] lookSkip never cleared --> FIXED (b3c59ec66b): a look clears it; tested
- [WARNING] a reply's parent_id not checked --> FIXED (defensive; a faithful fake gives no row to break it with)
- [WARNING] sent records with no id, and overlapping same-words windows --> DEFERRED: written in Weakest part
- [WARNING] a deep reply-to-reply parent beyond one look --> written in Not done
- [CONVENTION] tests for lookSkip, unreadable keys, an edited copy --> FIXED (tested)
- [NIT] NaN sort --> applied; [NIT] attemptedAt is the sweep's clock --> commented; [NIT] lookTries redundant --> reworked in 5

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 5 NITs
- [WARNING] the sending account was not recorded at the write-ahead --> FIXED (4ed80ec287): agentId recorded; re-registration tested
- [WARNING] a partial read could settle --> FIXED: a failed page is tried again; tested
- [WARNING] failed looks counted as looks --> FIXED: lookFails apart, unreachable after a week
- [WARNING] a deleted agent's record promised a look --> FIXED: marked retired
- [CONVENTION] tests --> FIXED (re-registration, failed page)
- [NIT] an unreadable cursor is not the end --> applied; [NIT] company words --> applied; [NIT] a test comment --> applied; [NIT] wasteful reads, ownList reuse --> deferred

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs
- [WARNING] the unconfirmed record took the key's account after the POST --> FIXED (a5a590d99e): the write-ahead's kept
- [WARNING] the company branch untested --> DEFERRED (reasoned; written in Not done)
- [WARNING] an older board's record has no upper bound --> written in Weakest part
- [CONVENTION] a test each for company and in-flight --> deferred with the company branch; in-flight cannot fire (sends run inside the same exclusive sweep, before this pass)
- [NIT] BAD declared after use --> applied; [NIT] Date.now in lookStopped; [NIT] duplicate post words

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
- [WARNING] the board's row still said "never learned" --> FIXED (f411150c13): the row and its browser check
- [WARNING] the failed-page test could not catch its rule --> FIXED: a sole match before a failed page, mutation checked
- [WARNING] the fake's replies route ignored a taken-down post --> FIXED; tested
- [NIT] a later-page gone read as whole --> applied; [NIT] a stale comment on re-login --> applied; [NIT] a stale post-versus-comment comment --> applied; [NIT] unreachable words --> applied in 13; [NIT] clock stepping back --> noted

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Duplicates of prior findings:** 2 (no-id sent records, iteration 4; the company list's parent, iteration 2)
- [WARNING] the look delayed new comment sends --> FIXED (0143c248c1): after the sends, from the pass after a send
- [WARNING] a timestamp with no zone --> checked: the service's times carry a zone
- [NIT] skip closure; [NIT] canLook and agentId rules duplicated; [NIT] duplicate post words

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 2 CONVENTIONs, 4 NITs
- [WARNING] the row and refusals promised a look where none would come --> FIXED (f10e5d796f): commentStillLooked decides them
- [WARNING] the busy reply-to-reply branch and other branches untested --> FIXED: tested (busy thread, per-pass cap, unreachable)
- [WARNING] a cut-short read could mis-pair two landed copies --> FIXED: a sole match only with no same-words sibling waiting
- [CONVENTION] two stale comments --> FIXED
- [NIT] the look ran before the owner-link passes --> applied (it runs last); [NIT] wasteful reply reads; [NIT] a skew alias; [NIT] retired not looked for (written)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs
**Duplicates of prior findings:** 3 (same-words pairing, Weakest part; the look's place, iteration 9; the company test, iteration 6)
- [WARNING] an older board's record after a re-registration reads as "not found" --> written in Not done, with the hourly pace being at best

#### Iteration 11
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
**Duplicates of prior findings:** 1 (the company branch untested)
- [WARNING] the edit refusal read the raw record; a non-https address not folded in; take-back words promised success --> FIXED (ab72f9d4fb)
- [WARNING] a slow service could hold the sweep lock for minutes --> FIXED: no new look after 30 s in a pass
- [NIT] skip marks before the capped loop; [NIT] unreachable words; [NIT] a readable filter --> applied; [NIT] the browser check renders a row that promises no look --> applied (c2b); [NIT] look bookkeeping on settle --> applied

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION (a note), 3 NITs
- [WARNING] the company route --> checked: it is the space's own list through spaceAs
- [WARNING] an older board's company record unbounded --> FIXED (6c53e90054): not settled without a send time
- [WARNING] "not seen" could fall back after a cut-short look --> FIXED: sticky once complete
- [WARNING] a lingering company skip mark --> cleared by the next look (accepted)
- [NIT] a stray blank line --> applied; [NIT] the doc said "after the take-downs" --> applied

#### Iteration 13
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
- [WARNING] sends in one pass shared a time, so pairing fell back to file order --> FIXED (3ef036dad4): a per-send order at the write-ahead; tested with the pass's own times, mutation checked
- [WARNING] the sibling rule had no test --> FIXED: tested, mutation checked
- [NIT] the 30 s wording --> applied; [NIT] a direct reply vs a reply to its reply --> written in Weakest part; [NIT] unasked words --> applied; [NIT] spaceAs can join --> noted; [NIT] a markLookSkip helper --> deferred

#### Iteration 14
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs (2 raised, both duplicates), 0 CONVENTIONs, 3 NITs
**Duplicates of prior findings:** 2 (sent records with no id: iteration 4, Weakest part; the attempt time being the sweep's clock: iteration 4, commented)
- [NIT] pairing order across older and newer records; [NIT] dense one-line blocks; [NIT] duplicate post words

### Deferred, with reasons
- The company-space branch has no test of its own: it needs the company-policy harness; reasoned from the space's list route, written in Not done.
- Same-words ambiguities (no-id sent records, overlapping windows, replies under one top-level comment, an older board's record): no resend and no other agent's comment can follow; written in Weakest part.
- NITs: a markLookSkip helper; reading replies from replies_cursor; an ownList reuse.

### Not measured locally
- docs/browser-checks/render-community-delete-4313.js needs a local board; CI runs it.

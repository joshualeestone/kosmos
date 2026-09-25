---
pre_challenge: true
method: challenge-loop
branch: unread-edge-3743
diff_hash: 3b6c29c72a75430630c5cbef0e10e8772961671cdf88214574ec5e79d0484ca4
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T20:54:30Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5 had nothing at WARNING or above)
**Fixed:** every BLOCKER and WARNING raised | **Deferred:** 0 | **Asked (awaiting user):** 0

Iterations 1 to 3 ran on the previous account (handoff monalisa-night-1102); their fixes are the commits named. 4 and 5
ran in this session.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** unknown (recorded as a blind review; model not in the handoff)
**Self-generated:** 0
Fixed: tall messages are read a screenful at a time (U8); a failed room read or a stale count cannot edge read history
(U9, U10).

#### Iteration 2
**Reviewer model:** unknown
**Self-generated:** 0
Fixed: a thread's unread sets are bounded by the rows it shows (U11); bodyless posts are left out.

#### Iteration 3
**Reviewer model:** unknown
**New findings:** 2 WARNINGs
Fixed: the moment on screen is continuous, so leaving the window inside it starts it again (U12); a very tall message is
measured as it scrolls inside its own box (U13).
U13's control, settled in this session: the scroll pass disabled from outside the page (a capture listener stopping
scroll before the document sees it) turns U13 red, with the same bubble and no repaint; unmodified, green.

#### Iteration 4 (the setup assistant's chat, added in this session)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 3 NITs
**Self-generated:** 0
- [WARNING] The unread state was keyed by the guide's session name and never cleared, so a new guide under the same
  name would light up its whole history. Fixed: forgetting a guide clears the assistant's unread state and its reply
  ids (U16).
- [WARNING] Replies that came while folded were counted, and the count was applied to a differently filtered set of
  rows, so the edge could land on an older, read reply. Fixed: found by id; the first read's reply ids are the
  baseline, and when open any other id is new (U15 goes through asbNoteReplies).
- NITs: the poll's backlog line was not exercised by U15 (now through asbNoteReplies); a backlog left when a paint
  returned early (moot with ids); at-timestamp id collisions (cosmetic, not taken).

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 NIT
**Self-generated:** 0
Verified: the id baseline matches unreadEdgeApply's first look; the id filter matches what the DOM edge can mark; the
forget clears state in lockstep with every guide-identity change (U16 fails without it); no unbounded growth. NIT not
taken: ASB.replyIds is one global, correct while every guide change goes through asbConfirmGuide / asbForgetGuide.

## After convergence
- 6j caught the check's surface list naming 'unread-edge' (only a custom property's name); dropped, data-unread covers it.
- Rebased onto main twice (after #3755 and #3660's bubble half): the runner list, the README row, a :root token line
  (both kept), and the assistant's state (fallback and replyIds both kept, and both reset on forget).
- The surface gate named render-assistant-bubble-3034 (75), render-dm-phone-718 (88), render-assistant-hosted-3660
  (106) and render-agentdm-3414 (40); each run green on this branch and recorded in per-check trailers.

## Validation
6j on HEAD: full suite clean (hash 3b6c29c72a75), subdir audit clean. render-unread-edge-3743: 24 pass (U1-U16), on
today's main.

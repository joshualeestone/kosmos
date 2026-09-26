---
pre_challenge: true
method: challenge-loop
branch: dm-tapreact-718
diff_hash: 33c2a4dedbf9dbaed9ae4ef935788cbea89367e74a40fadfec9ddeabfdaa4dbd
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T09:57:39Z
iterations: 9
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9 (iteration 1 = the initial validation pass, which failed on the #2518 surface gate and was fixed; iterations 2 to 9 = eight blind review rounds)
**Converged:** Yes, at iteration 9 (NITs only)
**Total findings:** 1 BLOCKER (validation), 13 WARNINGs, 1 CONVENTION, about 30 NITs
**Fixed:** 13 | **Deferred (named backstops or kept-on-purpose, each with its reason):** 3 | **Asked:** 0

Reviewer model: opus for every round. Sonnet is off limits until Sunday 2026-09-27 17:00 CDT (weekly
limit, Liu Kang m711), so one model witnessed the convergence: a known weakness.

The branch was squashed to one commit before the PR (the first commit's subject said "WIP, unverified";
every Browser-check-surface trailer is kept in the squashed message) and rebased onto origin/main after
#3882 and #3915 merged. Tree identical before and after the squash, verified.

Final state (head 1ab01ce67): tools/run-tests.sh 9894 tests, 9742 pass, 0 fail, validation PASSED (hash
eefb5345a65b), subdir audit clean. render-dm-tapreact-718 156/0 on Chromium + WebKit; against origin/main's
page it fails 144 of 156 (143 in one run; the passes there are "no page errors" and the mouse arm). Room
and DM checks on this tree: render-room-msgbox-2806 356/0, render-room-reply-3745 44/0,
render-dm-reactions-3650 13/0, render-dm-chatfirst-718 634/0; web.room-phone-718.test.js 11/0. Removal
controls (Chromium): tap listener 60, repaint observer 12, per-agent scope 8, outside-tap close 8,
full-list pick close 8, show rule 5 to 6, open-row lift 5, sticky-hover rule 4, 36px targets 4 FAIL; the
DM composer edge stays green (a named backstop). Every heavy run went through the fleet gate (v4); the
gate stopped the suite five times for other agents' runs and it was re-run whole.

Rebased once more onto origin/main af8b2a808 (the gated checks-list line only; main added #3928's tip
placement and others). On that base, under the gate: render-dm-tapreact-718 156/0, render-room-msgbox-2806
356/0, render-room-reply-3745 44/0, render-dm-reactions-3650 13/0, render-dm-chatfirst-718 634/0,
web.room-phone-718.test.js 11/0. The full-suite numbers above are from the previous base; CI runs the
suite on this head.

### Per-Iteration Breakdown

#### Iteration 1 (initial validation)
**Reviewer model:** none (helpers)
**Self-generated:** 0
- [BLOCKER] initial-validation: #2518 surface gate flagged 8 touched checks --> FIXED (all re-run on the tree; per-check trailers)

#### Iteration 2 (round 1)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0
- [WARNING] web/index.html shared picker: a full-list pick left a tapped DM bar open --> FIXED (pjRxnClose in the DM branch; arm + control)
- [WARNING] web/index.html rxnOpenRow: the open DM row keyed by at, shared by same-millisecond messages --> FIXED (keyed by the row's data-mid)
- [CONVENTION] git history: a commit subject "(WIP, unverified)" --> FIXED (reworded, then squashed)

#### Iteration 3 (round 2)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 6 NITs
**Self-generated:** 1 (the named handler moved the text the room-order pin anchored on)
- [WARNING] web.room-phone-718.test.js: the order pin anchored on the handler body, not its registration --> FIXED (asserts the registration line; control: moving it below fails)

#### Iteration 4 (round 3)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] branch behind main (checks list) --> FIXED (rebased)
- [WARNING] the DM half depends on #3882 not yet merged --> FIXED (#3882 merged; rebased onto it; every number re-measured there)

#### Iteration 5 (round 4)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] plan said #3882 was pending --> FIXED (plan corrected; it was already in the branch)
- [WARNING] the full-list pick finds its message by at while the bar uses the row id --> DEFERRED on purpose, commented: the react route itself names the message by at (#3650), so a row id could only repaint a row the server may not have changed

#### Iteration 6 (round 5)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (round 1's const helpers broke the file's load-order promise)
- [WARNING] const helpers read by pjView -> pjRxnClose broke "safe at any load point" --> FIXED (then corrected in round 6)
- [WARNING] no arm for a DM message taller than the thread (the pinned bar) --> FIXED (tall-message arm)

#### Iteration 7 (round 6)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (round 5's var RXN_HOSTS is hoisted as undefined)
- [WARNING] var RXN_HOSTS undefined before its line, so an early close would throw --> FIXED (rxnHosts() function declaration)
- [WARNING] branch behind main (checks list) --> FIXED (rebased)

#### Iteration 8 (round 7)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] the per-agent scope had no arm --> FIXED (an arm swaps the agent under an open bar with the same messages; control fails 8)
- [WARNING] the DM composer edge in the visible band has no arm --> DEFERRED: in every layout measured the thread ends where the composer bar begins, so no arm can isolate it without an invented layout; a named backstop in the plan

#### Iteration 9 (round 8)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0
- [NIT] the check never asserts how many arms ran --> DEFERRED: follow-up (the gate and I read the PASS count against 156 each run)
- [NIT] the cross-thread guard sits after the link/button branch --> DEFERRED: the outside-tap closer already closes the other thread first
- [NIT] a bar left open when the agent page is left by a view other than pjView --> DEFERRED: matches the room; the next scroll or resize closes it
- [NIT] dead `|| room` kept for Kano's pinned line; --room-tap name; keyboard focus flip in the DM has no arm --> DEFERRED (pinned room test; named in the plan)
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | Where | Origin | Description | Status | Resolution |
|---|------|----------|-------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | surface gate | BRANCH | 8 touched checks | FIXED | re-run + trailers |
| 2 | 2 | WARNING | shared picker | BRANCH | full-list pick left bar open | FIXED | pjRxnClose |
| 3 | 2 | WARNING | rxnOpenRow | BRANCH | at shared by messages | FIXED | data-mid |
| 4 | 2 | CONVENTION | history | BRANCH | WIP subject | FIXED | reworded, squashed |
| 5 | 3 | WARNING | room test | SELF | order pin on body | FIXED | registration pin |
| 6 | 4 | WARNING | branch | BRANCH | behind main | FIXED | rebased |
| 7 | 4 | WARNING | DM band | BRANCH | depends on #3882 | FIXED | rebased onto it |
| 8 | 5 | WARNING | plan | BRANCH | stale #3882 note | FIXED | plan |
| 9 | 5 | WARNING | picker | BRANCH | pick by at | DEFERRED | route keys by at |
| 10 | 6 | WARNING | helpers | SELF | const load order | FIXED | declarations |
| 11 | 6 | WARNING | check | BRANCH | no tall-message arm | FIXED | arm |
| 12 | 7 | WARNING | helpers | SELF | var hoisted undefined | FIXED | rxnHosts() |
| 13 | 7 | WARNING | branch | BRANCH | behind main | FIXED | rebased |
| 14 | 8 | WARNING | check | BRANCH | scope untested | FIXED | arm + control |
| 15 | 8 | WARNING | DM band | BRANCH | composer edge untested | DEFERRED | named backstop |

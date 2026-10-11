---
pre_challenge: true
method: challenge-loop
branch: joincorp-5791
diff_hash: 720becc9d0c1f629b80f81f541522cbf074ba5a68340a1038f2b6a88bb1e154d
validation: passed
subdir_audit: passed
timestamp: 2026-10-11T03:03:40Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 (blind reviewers alternating Opus and Sonnet)
**Converged:** Yes, at iteration 6 (Sonnet): no NEW finding above NIT after deduplication.
**Total findings (actionable, above NIT):** 21 (1 BLOCKER, 18 WARNINGs, 2 CONVENTIONs)
**Fixed:** 11 | **Decided, not changed (with reasons):** 4 | **Not a defect (verified in code):** 3 | **Duplicates:** 3 | **Asked (awaiting user):** 0

6.0 baseline: deferred to the final gate on purpose. The machine's suite queue was about an hour deep at 16:30, and a run that starts while review fixes are being made validates nothing. The related set (357 tests across orgenroll, orgrollup, agentevents, server.orgenroll and the web tests) was run after every iteration and was green each time. The browser check render-orgenroll-5531.js was run after every page change, and each fix got a mutation that turned it red.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 4 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** 0 of the above
- [BLOCKER] engine/orgrollup.js tick: terms that ask for no reports could never pick up new terms (such a board never sends, so it never gets the 409, and the Review button that was its only way is gone) --> FIXED (b51eea6a1): a daily re-check; reacceptWords leaves unchanged terms alone. Three mutations red (the second only after fixing a vacuous fixture).
- [WARNING] web/index.html plusOrgCancel: X Cancel could not close a pane a "stopped naming this Kosmos" note held open --> FIXED (b51eea6a1), browser check O8b, both halves mutated red.
- [WARNING] engine/orgenroll.js reacceptWords: widened terms are accepted with nothing on screen --> DECIDED: Josh's 14:32 ruling ("the company decided") covers the company's terms as a whole. Recorded on card #5791 at 16:40 so he can overrule it.
- [WARNING] web/index.html plusOrgConnect: a move is joined with no confirmation --> DECIDED: Josh's ruling that Connect Account joins directly. On the card.
- [WARNING] engine/agentevents.js: failAt may survive a re-accept --> NOT A DEFECT: the new hash changes the sender's enrollment key and the state resets (failAt: null). Pinned anyway: a later event is now asserted sent; keeping failAt on reset turns it red.
- [CONVENTION] .claude/plans/joincorp-5791.md: empty loop notes --> FIXED.
- [NIT] stale consentWithdrawn comment; "press Join again" in move refusals; the event sender's log line; export order --> taken. The /api/org/preview { review: true } branch with no page caller --> kept as API surface.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 1 of the above (the dismissal logic was iteration 1's fix)
**Duplicates of prior findings (confirmed resolved):** 1 (silent terms)
- [WARNING] web/index.html PLUS_ORG.dismissed: a closed note stayed suppressed for the page's life --> FIXED (c880a59c0): forgotten once the engine drops the note or the Kosmos joins. Browser check O8c, mutation red.
- [WARNING] web.*.test.js need the repo root as cwd --> NOT THIS BRANCH (pre-existing; run-tests.sh runs them from the root).
- [CONVENTION] the plan's "to update" list named files needing no change --> FIXED: the plan says which changed and which were checked and left.
- [NIT] the Cancel link reuses the plus-lost-link style; the web test is source-text --> not taken (deliberate look; the browser check is the behaviour pin).

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 1 of the above (the read-back call was iteration 0's code, moved by no fix; the race comment concerns iteration 1's re-check)
- [WARNING] web/index.html plusOrgConnect: the read-back after a join ran while busy and did nothing --> FIXED (d66dc5d3a). The browser check's stand-in /api/org was also taught to remember a join, which the bug had hidden. Check O2b, mutation red.
- [WARNING] engine/orgrollup.js: the re-check runs before the run lock --> DECIDED, comment added: two runs cost one extra read and at most one repeated codeless enroll.
- [WARNING] engine/orgrollup.js and agentevents.js: a 409 under the same served hash re-enrolls hourly --> DECIDED, not guarded: re-enrolling under the served hash is what rebinds the company's record; a guard would block the real repair. Capped by the failure wait.
- [CONVENTION] engine/orgenroll.js: "Press Accept again" left in the review branch --> FIXED.
- [NIT] stale mayReport, "bottom row" and "reading a consent" comments; Cancel focus when the button stays hidden --> taken.

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the stamp was iteration 1's code)
**Duplicates of prior findings (confirmed resolved):** 1 (silent terms)
- [WARNING] engine/orgrollup.js: the stamp read-modify-wrote the shared rollup state outside the lock --> FIXED (49c66200b): its own file (RETAKE_FILE). Test asserts the shared state untouched; mutation red in two tests.
- [WARNING] "no hash but words on file" refused for good --> NOT A DEFECT: acceptedConsent returns null unless mayReport (a hash) holds; the 15-minute test builds exactly that state and recovers.

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above (both in iteration 1's re-check)
- [WARNING] engine/orgrollup.js: two acceptedConsent reads could straddle a change and throw in a tick documented never to throw --> FIXED (088b319c2): one read. Not test-pinned (needs another process between two synchronous reads).
- [WARNING] engine/orgrollup.js: a company that never lets terms be recorded got an enroll every 15 minutes forever --> FIXED (088b319c2): the window doubles per miss up to a day, resets on success. Two mutations red.
- [NIT] a spent code stayed in the field after "not known yet" or "undo pending" --> FIXED, browser check O14, mutation red. Other NITs not taken.

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 2 (the "words but no hash" case, verified not a defect in iteration 4; silent terms, decided in iteration 1)
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/orgrollup.js | BRANCH | no-report terms never learn new terms | FIXED | b51eea6a1 |
| 2 | 1 | WARNING | web/index.html | BRANCH | Cancel cannot close a note-opened pane | FIXED | b51eea6a1 |
| 3 | 1 | WARNING | engine/orgenroll.js | BRANCH | widened terms accepted silently | DECIDED | Josh's ruling; on the card |
| 4 | 1 | WARNING | web/index.html | BRANCH | move with no confirmation | DECIDED | Josh's ruling; on the card |
| 5 | 1 | WARNING | engine/agentevents.js | BRANCH | failAt after re-accept | NOT A DEFECT | pinned by a test |
| 6 | 1 | CONVENTION | plan | BRANCH | empty loop notes | FIXED | b51eea6a1 |
| 7 | 2 | WARNING | web/index.html | SELF | dismissal permanent | FIXED | c880a59c0 |
| 8 | 2 | WARNING | web tests | BRANCH | cwd-dependent tests | NOT THIS BRANCH | pre-existing |
| 9 | 2 | CONVENTION | plan | BRANCH | stale update list | FIXED | c880a59c0 |
| 10 | 3 | WARNING | web/index.html | BRANCH | read-back ran while busy | FIXED | d66dc5d3a |
| 11 | 3 | WARNING | engine/orgrollup.js | SELF | re-check before the lock | DECIDED | comment |
| 12 | 3 | WARNING | orgrollup/agentevents | BRANCH | same-hash 409 loop | DECIDED | rebinding is the repair |
| 13 | 3 | CONVENTION | engine/orgenroll.js | BRANCH | "Press Accept again" | FIXED | d66dc5d3a |
| 14 | 4 | WARNING | engine/orgrollup.js | SELF | shared state read-modify-write | FIXED | 49c66200b |
| 15 | 4 | WARNING | engine/orgrollup.js | BRANCH | words but no hash | NOT A DEFECT | acceptedConsent needs mayReport |
| 16 | 5 | WARNING | engine/orgrollup.js | SELF | double read could throw | FIXED | 088b319c2 |
| 17 | 5 | WARNING | engine/orgrollup.js | SELF | no backoff on repeated misses | FIXED | 088b319c2 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None. The two DECIDED product calls are on card #5791 for Josh to overrule; neither blocks.

### NITs (non-blocking, across all iterations)
- The /api/org/preview { review: true } branch has no page caller (iterations 1, 5, 6)
- The Cancel link reuses the plus-lost-link class (iterations 2, 4)
- web.joincorp-5791.test.js is source-text; the browser check pins behaviour (iterations 2, 5)
- The org_ticket sentence fits a join, not the page-less review caller (iteration 5)
- The reacceptWords docblock is long (iteration 5)
- A retry after org_ticket gives no new hint (iteration 6)

### Strengths (across all iterations)
- The page change is small: preview then enroll with the one-time ticket, the server contract unchanged (iterations 1, 5, 6)
- Every engine fix has a control and a mutation that turned it red (iterations 3, 5)
- The terms re-check is throttled, stamped before the ask, kept out of the shared state, and backs off (iterations 4, 5, 6)
- "Lost your phone?" moved under the same enrolled-only condition as the old footer (iterations 3, 5)

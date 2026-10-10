---
pre_challenge: true
method: challenge-loop
branch: langpicker-5080
diff_hash: 97e422938f9cff1df5809d63a2ae924cb1dddf67f0bd28d8f8fdc87601535790
validation: passed
subdir_audit: passed
timestamp: 2026-10-10T20:21:47Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10 blind reviews, alternating Opus and Sonnet (5 each)
**Converged:** Yes. Iteration 8 found nothing new; the closing gate (6j) then failed twice (below), each fix ran
another review (9, 10), and iteration 10 found nothing new. The final gate passed on the hash above
(local validation, validation-log hash 97e42293, EXIT=0 at 15:21 CDT; subdir audit rc=0).
**Total actionable findings:** 1 BLOCKER, 23 WARNINGs (plus 2 synthetic final-validation BLOCKERs), many NITs
**Fixed:** 22 | **Deferred:** 6 | **Asked (awaiting user):** 0

**Self-generated (6c-bis):** not classified by blame this run. Recorded as unknown rather than estimated. Several
later findings were plainly in earlier iterations' fixes (iteration 2 in iteration 1's stale-block code, iteration 6 in
iteration 4's cache key, iteration 7 in iteration 5's save message), so the loop did review its own output.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [BLOCKER] engine/personlanguage.js tellAgent: Automatic after a choice, off a Mac, left the chosen block while the page said English --> FIXED ee05d5a36
- [WARNING] automatic() bypassed the read cache, so every Settings read ran `defaults` --> FIXED ee05d5a36
- [WARNING] edit history gave the computer's reason for a Settings write --> FIXED ee05d5a36
- [WARNING] an unreadable roster was reported as "1 agent could not be changed" --> FIXED ee05d5a36
- [WARNING] no test for a choice back to Automatic off a Mac --> FIXED ee05d5a36

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] the test-only AGENT_WORKFORCE_PERSON_LOCALE override outranks the picker --> DEFERRED: test-runner seam only, documented in the module header
- [WARNING] a read still out from page load dropped a save's answer (shared epoch) --> FIXED 83c1a7bcb
- [WARNING] the stale-block match was a loose substring --> FIXED 83c1a7bcb

#### Iteration 3
**Reviewer model:** opus
- [WARNING] an unsure Automatic reported two-block or unreadable files as COULD_NOT on every boot (boot noise) --> FIXED 5fa25c9cd
- [WARNING] the boot sweep off a Mac now reads files; undocumented --> FIXED 5fa25c9cd (plan)
- [WARNING] the note promised English while a computer-written block stayed in force --> FIXED 5fa25c9cd
- [WARNING] the boot line blamed the Mac for an unreadable Settings file --> FIXED 5fa25c9cd

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] the cached read ignored a choice written outside setChoice --> FIXED a518e0085
- [WARNING] after choosing Automatic, Settings ran `defaults` a second time --> FIXED a518e0085
- [WARNING] stale-line regex could drift from blockBody's wording --> DEFERRED: two tests build the block from blockBody and expect removal, so a drift fails them
- [WARNING] override precedence (dup of iteration 2) --> DEFERRED as above

#### Iteration 5
**Reviewer model:** opus
- [WARNING] English (a removal) owes no re-read, but the page said agents switch now --> FIXED ab3d605dc (save reports removals apart; page says "at their next start")
- [WARNING] setChoice's cache reset re-asked a hanging `defaults` on every save --> FIXED ab3d605dc

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] CHOICE_FILE captured store.ROOT at require time --> DEFERRED: store.js #5418 guards the derivation for test processes; sibling setting modules capture the same way
- [WARNING] the override env is not part of the cache key --> DEFERRED: predates this branch; the env does not change while a board runs
- [WARNING] the stale-block match should anchor to the block's own sentence --> FIXED a0fd7bdb9
- [WARNING] off a Mac, files were read on every boot even with no choice ever saved --> FIXED a0fd7bdb9 (+ plan ec5890b43)

#### Iteration 7
**Reviewer model:** opus
- [WARNING] a save that changed nothing still said agents would switch --> FIXED 509979655
- [WARNING] a mixed save (some written, some removed) described only the removals --> FIXED 509979655

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 (one duplicate of iterations 4/5, confirmed bounded). Converged; went to 6j.

#### Final validation (6j), first run
- [BLOCKER] final-validation: web.settings-nav pins the Automation boxes in order; the new Language box broke it --> FIXED 76ec743df (then iterations 9 and 10)

#### Iteration 9
**Reviewer model:** opus
- [WARNING] creating an agent under a saved, unsure Automatic kept a pasted stale Settings block --> FIXED 8ab06e7a1
- [WARNING] a failure to record the re-read reported "next time Kosmos starts" though the files had changed --> FIXED 8ab06e7a1

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 (two duplicates; the Mac read cached until restart is #5050's design and the label shows exactly what agents get: DEFERRED). Converged; went to 6j.

#### Final validation (6j), second run
- [BLOCKER] final-validation: the browser-check surface gate (#2518) saw the token "msg" (the new agent-language-msg id) and two checks that read the .msg chat rows --> FIXED edd59f116 with per-check Browser-check-surface trailers (neither check reads Settings). Gate re-run: passes with the trailers; control at the commit before them fails (rc=1).

#### Final validation (6j), third run
Passed on edd59f116: node 18684 tests, 0 fail; shell part passed; EXIT=0.

### Final Ledger (actionable only)

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/personlanguage.js | BRANCH | stale Settings block kept under unsure Automatic | FIXED | ee05d5a36 |
| 2 | 1 | WARNING | engine/personlanguage.js | BRANCH | automatic() uncached | FIXED | ee05d5a36 |
| 3 | 1 | WARNING | engine/personlanguage.js | BRANCH | wrong edit-history reason | FIXED | ee05d5a36 |
| 4 | 1 | WARNING | server.js | BRANCH | unreadable roster counted as one agent | FIXED | ee05d5a36 |
| 5 | 1 | WARNING | tests | BRANCH | no Automatic-after-choice test | FIXED | ee05d5a36 |
| 6 | 2 | WARNING | engine/personlanguage.js | BRANCH | test override outranks picker | DEFERRED | test seam only |
| 7 | 2 | WARNING | web/index.html | BRANCH | save answer dropped by a page-load read | FIXED | 83c1a7bcb |
| 8 | 2 | WARNING | engine/personlanguage.js | BRANCH | loose stale match | FIXED | 83c1a7bcb |
| 9 | 3 | WARNING | engine/personlanguage.js | BRANCH | boot noise off a Mac | FIXED | 5fa25c9cd |
| 10 | 3 | WARNING | plan | BRANCH | boot read undocumented | FIXED | 5fa25c9cd |
| 11 | 3 | WARNING | web/index.html | BRANCH | note promised English | FIXED | 5fa25c9cd |
| 12 | 3 | WARNING | server.js | BRANCH | boot line blamed the Mac | FIXED | 5fa25c9cd |
| 13 | 4 | WARNING | engine/personlanguage.js | BRANCH | cache hid an outside choice write | FIXED | a518e0085 |
| 14 | 4 | WARNING | engine/personlanguage.js | BRANCH | second defaults after Automatic | FIXED | a518e0085 |
| 15 | 4 | WARNING | engine/personlanguage.js | BRANCH | stale regex drift | DEFERRED | pinned by tests |
| 16 | 5 | WARNING | web/index.html, server.js | BRANCH | removal promised an immediate switch | FIXED | ab3d605dc |
| 17 | 5 | WARNING | engine/personlanguage.js | BRANCH | setChoice reset re-asked defaults | FIXED | ab3d605dc |
| 18 | 6 | WARNING | engine/personlanguage.js | BRANCH | CHOICE_FILE module capture | DEFERRED | store.js #5418 |
| 19 | 6 | WARNING | engine/personlanguage.js | BRANCH | override not in cache key | DEFERRED | predates branch |
| 20 | 6 | WARNING | engine/personlanguage.js | BRANCH | stale match not anchored | FIXED | a0fd7bdb9 |
| 21 | 6 | WARNING | engine/personlanguage.js | BRANCH | files read with no choice saved | FIXED | a0fd7bdb9 |
| 22 | 7 | WARNING | web/index.html | BRANCH | nothing-changed save message | FIXED | 509979655 |
| 23 | 7 | WARNING | web/index.html | BRANCH | mixed save message | FIXED | 509979655 |
| 24 | 6j | BLOCKER | web.settings-nav.test.js | BRANCH | Automation order test | FIXED | 76ec743df |
| 25 | 9 | WARNING | engine/create.js | BRANCH | stale block kept at create | FIXED | 8ab06e7a1 |
| 26 | 9 | WARNING | server.js | BRANCH | re-read failure misreported | FIXED | 8ab06e7a1 |
| 27 | 10 | WARNING | engine/personlanguage.js | BRANCH | Mac read cached until restart | DEFERRED | #5050 design |
| 28 | 6j | BLOCKER | web/index.html | BRANCH | surface gate: token "msg" | FIXED | edd59f116 (trailers) |

Origin is BRANCH for every row because no blame classification ran (see above); that is the fail-safe value, not a measurement.

### Outstanding questions (ASKED)
None.

### NITs (non-blocking, selected)
- Source-regex tests over web/index.html catch reverts, not behaviour (repo convention); the route and engine tests cover behaviour.
- The test-only override, and HEAD on GET possibly running `defaults` once per 5 minutes.

### Strengths (across iterations)
- An unreadable choice file is "not sure" and changes nothing, never Automatic; tested with five bad shapes and a control.
- The computer-written block is byte-identical to before; only the bracketed source differs for a Settings choice.
- The route copies /api/undo-setting's shape (agent token refused, 400/500 split) and syncs every agent through the boot sweep's own call.
- Mutation checks: each key fix was reverted once and its test went red.

### Also on the record
- Design review by Mona Lisa (comment 6100105092 on #5080): the not-sure Automatic reads "English for now"; placement kept under Automation on purpose.
- Related test set (151 files, later 160) clean after every iteration (last 2805 tests, 0 fail).
- The first validation run (01269cd3e) was stopped by the author at 12:15 to fix iteration 1; it recorded nothing.

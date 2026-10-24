---
pre_challenge: true
method: challenge-loop
branch: seen-poll-6951
diff_hash: b449f88dc4d7200ef3e3a147ed3959b1c360bc366ec8a4384b320f162d153551
validation: passed (focused: 604 files, ~7233 tests, exit 0, at f2c9b70d before the body-read fix and the replay onto main; after the replay, the card's 5 test files 55/55, syntax checks, and both browser-check gates; the full suite is CI's)
subdir_audit: passed (no CLAUDE.md changed)
timestamp: 2026-10-23T02:34:37Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (the usage cap; round 8 raised no blocker, its two actionable warnings were fixed and its rest went to #6953)
**Converged:** Yes
**Total findings:** 58 (0 BLOCKERs, 27 WARNINGs, 1 CONVENTION, 30 NITs)
**Fixed:** 24 | **Deferred:** 4 | **Asked (awaiting user):** 0
**History:** reviewed stacked on #6947 (8 commits, kept on branch seen-poll-6951-old), replayed onto main after #6956 as one commit.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] web/index.html - the drawn signature was stored even when the mark declined, so later polls never marked --> FIXED (1cf1ee31): tkMarked kept apart from tkDrawn
- [WARNING] openTaskPage left tkDrawn, so a failed read after a reopen stayed on screen --> FIXED (1cf1ee31)
- [WARNING] paintTaskActivity header said it is not on the poll --> FIXED (1cf1ee31)
- [WARNING] tab-return listener comment wrong after the change --> FIXED (1cf1ee31)
- [WARNING] nudge plan claimed the gap closed --> FIXED (1cf1ee31)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 2
- [WARNING] a 4xx was re-posted every poll --> FIXED (c7258e62): a conversation settles once answered
- [WARNING] a broken board was asked twice every poll --> FIXED (c7258e62)
- [WARNING] plan said a failed read clears both memories --> FIXED (c7258e62)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 1
- [WARNING] a poll inside the retry window sent a second record --> FIXED (b150901e): tkMarking
- [WARNING] a page left open on an empty desk marked every nudge seen --> FIXED (b150901e): the poll draws only while the person is there (tkPresent)
- [WARNING] seenByPerson holds the first view of the state, not the latest; CLI said "last viewed" --> FIXED (b150901e): "viewed at", documented

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 2 NITs
- [WARNING] out-of-order reads rewrote drawn/marked --> FIXED (76534fb3): read sequence
- [WARNING] a retry from an earlier open could settle the new open --> FIXED (76534fb3): per-open token
- [WARNING] presence missed touchmove/scroll --> FIXED (76534fb3), revised in iteration 5
- [WARNING] four comments still said "last viewed" --> FIXED (76534fb3)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 3
- [WARNING] off-by-one let a read from the previous open survive a reopen and leave tkMarking stuck --> FIXED (1475c276), test fails only with both guards removed
- [WARNING] the reopen test hand-copied openTaskPage's reset --> FIXED (1475c276): runs the real openTaskPage
- [WARNING] scroll and pointermove fire without the person --> FIXED (1475c276): deliberate input only
- [WARNING] "first saw it" claim untrue across reopens --> FIXED (1475c276): wording
- [WARNING] nudge plan contradicted itself on dialogs --> FIXED (1475c276)
- [NIT] poll reads could stack --> fixed anyway (tkPollActivity)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] reopen test could pass with nothing drawn --> FIXED (2095cbd0)
- [WARNING] a failed read during a record caused a duplicate record --> FIXED (2095cbd0)
- [WARNING] the poll gate is pinned by source only --> DEFERRED: its parts are driven; listed; #6953
- [WARNING] nudge plan's tab-return line --> FIXED (2095cbd0)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
- [WARNING] the poll's redraw re-announced the whole conversation through the polite live region (AA) --> FIXED (324f8781): quiet swap on the poll path
- [WARNING] a retry from an earlier open still posted after a reopen --> FIXED (324f8781): current()
- [WARNING] a hung read stopped the poll for every task --> FIXED (324f8781): 15 s release

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs
- [WARNING] the poll redraw dropped keyboard focus (AA) --> FIXED (f2c9b70d): focus restored by rollup key
- [WARNING] a late hung read released the replacement's flag --> FIXED (f2c9b70d): owner token
- [WARNING] "viewed at" ages within one open --> DEFERRED: #6953
- [CONVENTION] poll gate wiring pinned by source --> DEFERRED: #6953 (dup of iteration 6)
**Converged** - no blocker; actionable warnings fixed or carded.

After the loop: the seen reply's body is read (8af3e6cc), the fix #6956 needed for render-url-state, with a test that fails without it.

### Final Ledger (warnings and above)

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html | BRANCH | declined mark never retried | FIXED | 1cf1ee31 |
| 2 | 1 | WARNING | web/index.html | BRANCH | stale tkDrawn on reopen | FIXED | 1cf1ee31 |
| 3 | 2 | WARNING | web/index.html | SELF | 4xx re-posted | FIXED | c7258e62 |
| 4 | 2 | WARNING | web/index.html | SELF | broken board asked forever | FIXED | c7258e62 |
| 5 | 3 | WARNING | web/index.html | SELF | double record in retry window | FIXED | b150901e |
| 6 | 3 | WARNING | web/index.html | BRANCH | empty desk marks seen | FIXED | b150901e |
| 7 | 4 | WARNING | web/index.html | BRANCH | out-of-order reads | FIXED | 76534fb3 |
| 8 | 4 | WARNING | web/index.html | BRANCH | earlier open settles new | FIXED | 76534fb3 |
| 9 | 5 | WARNING | web/index.html | SELF | off-by-one across reopen | FIXED | 1475c276 |
| 10 | 5 | WARNING | web/index.html | BRANCH | synthetic presence events | FIXED | 1475c276 |
| 11 | 6 | WARNING | web/index.html | SELF | duplicate after failed read | FIXED | 2095cbd0 |
| 12 | 6 | WARNING | web.task-seen-6947.test.js | BRANCH | gate pinned by source | DEFERRED | #6953 |
| 13 | 7 | WARNING | web/index.html | BRANCH | live region re-announced | FIXED | 324f8781 |
| 14 | 7 | WARNING | web/index.html | BRANCH | old retry posted | FIXED | 324f8781 |
| 15 | 7 | WARNING | web/index.html | BRANCH | hung read stops poll | FIXED | 324f8781 |
| 16 | 8 | WARNING | web/index.html | BRANCH | focus dropped | FIXED | f2c9b70d |
| 17 | 8 | WARNING | web/index.html | SELF | late release of flag | FIXED | f2c9b70d |
| 18 | 8 | WARNING | CLIs | BRANCH | viewed-at ages | DEFERRED | #6953 |

### Strengths
- Drawn, in flight and settled are kept apart on the holder, with no new globals the page's lifted tests would need (iterations 1-8)
- The tests drive the real lifted functions (paintTaskActivity, tkMarkSeen, openTaskPage, tkPollActivity, the tab-return listener) against stand-ins that can return 5xx, lost, 4xx, off screen, held and reordered reads; each guard has a negative control (iterations 2-8)
- Request volume is bounded: one activity read at a time while the person is present, at most two records per conversation state (iterations 2-8)

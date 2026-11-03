---
pre_challenge: true
method: challenge-loop
branch: bareprev-7861
diff_hash: 24fe3b6de844f41f89db9120d3ec87f3dfda6a29de389a1593dd07290aa37f4d
validation: failed (full suite on dc7ed1dcb5: 29 of 26826; 1 was this branch, server.guide-secrets-3769 matching the changed /api/messages line, fixed in 09199eac07; 28 were contention, 9 files that spawn the server, all 310 of their tests green alone at 11:12 CST; 15-minute load 18.7 with two other suites running)
subdir_audit: passed
timestamp: 2026-11-03T17:13:17Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the 8-round review cap (a standing operator rule: past 8 only with a BLOCKER). Round 8 reviewed the whole branch, raised no BLOCKER, and its two WARNINGs were wording (fixed in dc7ed1dcb5, no behaviour change); no round 9 ran over those wording fixes.
**Total findings:** 31 actionable (5 BLOCKERs, 22 WARNINGs, 4 CONVENTIONs about the plan), plus NITs
**Fixed:** all BLOCKERs and WARNINGs except those DEFERRED below | **Asked (awaiting user):** 0

**Validation, stated as it happened:** see the frontmatter. The 3769 failure was real and is fixed with a control (the check still goes red when masking is removed). The other 28 failed with "server never announced a port" / "the tunnel program did not answer in time" and passed 310/310 when their 9 files were run alone. No second full suite ran over 09199eac07, which changes one test file's regex.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/unfurl.js firstLinkInfo - code handling differed from the page (unclosed fence, empty backticks, code touching a word) --> FIXED (b856971fae: no bare scan with any backtick)
- [WARNING] engine/unfurl.js - markdown links not handled (label previewed, target missed) --> FIXED (b856971fae; later replaced, see iteration 7)
- [WARNING] engine/unfurl.js / server.js - bare and typed https shared one cache key, so a typed https link could show an http-fetched preview --> FIXED (b856971fae: 'b:' key)
- [WARNING] engine/unfurl.bare-7861.test.js - parity only word by word --> FIXED (b856971fae: whole-message parity with the lifted pjRich)
- [CONVENTION] plan claimed typed https never fetched over http while the cache could show it --> FIXED (b856971fae)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 WARNINGs, 2 NITs
**Self-generated:** 1 (the markdown-link rewrite from iteration 1)
- [BLOCKER] engine/unfurl.js - the markdown rewrite split text glued to a link (evil.com[x](y.org)) and previewed it --> FIXED (a7b71e0efe)
- [WARNING] test - parity list had no adjacent-to-link cases --> FIXED (a7b71e0efe: 20000 generated messages)
- [WARNING] engine/unfurl.js - misses after > and in tables; the "always the first link" claim false --> FIXED (claim corrected, misses stated)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 3 NITs
**Self-generated:** 1 (the markdown handling)
- [BLOCKER] engine/unfurl.js - GFM tables: extra cells and a | in a link label were previewed --> FIXED (c41fd6c08a: no bare scan with any |)
- [WARNING] engine/unfurl.js previewBare - card opened http:// after the fallback --> FIXED (c41fd6c08a)
- [WARNING] plan/comment overclaimed --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 4 NITs
**Self-generated:** 1 (the scheme guard)
- [WARNING] engine/unfurl.js - scheme guard rejected host: and host:port --> FIXED (49d640beb8)
- [WARNING] server.js - a row whose text is only its host-named file name was previewed though the page hides it --> FIXED (49d640beb8: no bare scan on rows with files)
- [NIT] http redirect to another host kept --> FIXED (49d640beb8)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 6 NITs
**Self-generated:** 1 (the docblock)
- [WARNING] engine/unfurl.js - the project room's file chip exception not in the code; pjBody untested --> FIXED (b113619583: named, pjBody in generated parity)
- [WARNING] server.js - GET /api/messages (no screen reads it) would fetch bare addresses across every record --> FIXED (b113619583: { bare: false }; route test moved to the agent thread)
- [NIT] redundant scheme regex caused misses --> FIXED (removed); timeout arm untested --> FIXED; www redirect --> FIXED; plan count --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 3 NITs
**Self-generated:** 2 (the markdown pattern; the same-host rule)
- [WARNING] engine/unfurl.js - markdown pattern backtracked quadratically on every poll --> FIXED (8613303860: bounded + cap; later removed in iteration 7)
- [WARNING] engine/unfurl.js - http to another host's https page kept --> FIXED (8613303860)
- [WARNING] project-thread and guide routes untested for bare --> DEFERRED: same helper, bare previews intended there; covered by the thread-route tests' shape

#### Iteration 7
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 2 NITs
**Self-generated:** 2 (the bounded pattern from iteration 6; the timing test)
- [BLOCKER] engine/unfurl.js - a markdown link longer than the bounded pattern was scanned as words --> FIXED (c35a331b58: no bare scan with any [ or ], the markdown-link machinery removed)
- [WARNING] timing test never ran under the cap --> FIXED (c35a331b58)
- [WARNING] words x links cost per poll --> FIXED (the machinery is gone)
- [WARNING] three cache slots per bare address --> FIXED (c35a331b58: one slot when https answers)

#### Iteration 8
**Reviewer model:** sonnet (whole branch, nothing pre-cleared)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 4 NITs
**Self-generated:** 1 (the never-plain-http wording)
- [WARNING] cache and retry cost of an unreachable bare address unstated --> FIXED (dc7ed1dcb5: stated in the plan as accepted)
- [WARNING] "never plain http" overstated for the https-answered path --> FIXED (dc7ed1dcb5: narrowed)
- [NIT] round numbers in comments --> FIXED; timing bound --> FIXED (250 ms)
**Stopped at the cap.** Its own generator, 400000 messages across two shapes, found 0 disagreements with pjRich or pjBody.

### Final Ledger (actionable)

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/unfurl.js | BRANCH | code handling differed from the page | FIXED | b856971fae |
| 2 | 1 | WARNING | engine/unfurl.js | BRANCH | markdown links | FIXED | c35a331b58 |
| 3 | 1 | WARNING | engine/unfurl.js | BRANCH | shared cache key | FIXED | b856971fae |
| 4 | 2 | BLOCKER | engine/unfurl.js | SELF | text glued to a link previewed | FIXED | a7b71e0efe |
| 5 | 3 | BLOCKER | engine/unfurl.js | SELF | tables previewed hidden cells | FIXED | c41fd6c08a |
| 6 | 4 | WARNING | server.js | BRANCH | host-named file text previewed | FIXED | 49d640beb8 |
| 7 | 5 | WARNING | server.js | BRANCH | unread route widened | FIXED | b113619583 |
| 8 | 6 | WARNING | engine/unfurl.js | SELF | quadratic markdown pattern | FIXED | c35a331b58 |
| 9 | 6 | WARNING | engine/unfurl.js | SELF | cross-host https redirect kept | FIXED | 8613303860 |
| 10 | 6 | WARNING | server.js | BRANCH | guide/project thread untested | DEFERRED | same helper, intended |
| 11 | 7 | BLOCKER | engine/unfurl.js | SELF | long link scanned as words | FIXED | c35a331b58 |
| 12 | 8 | WARNING | plan | SELF | retry cost unstated | FIXED | dc7ed1dcb5 |

### Outstanding questions (ASKED)
- none

### Mutation evidence (each run, file restored and compared after)
Server explicit-only links; bare flag dropped from warm; no backtick / | / [ ] rule; each earlier round's unfurl.js put back; the server ignoring a row's files; the cross-host check removed (http and https); bare previews back on GET /api/messages; the unbounded pattern; the 3769 masking removed. Each turned exactly its own test red.

### Strengths
- Parity is tested against the page's own pjBareWeb, pjBareSplit, pjRich and pjBody, lifted from web/index.html, on 51 fixed and 20000 generated messages.
- The address gate runs before every fetch on both schemes; a private address is never retried over http.
- A typed https:// link never shows a preview read over http (separate key, tested).

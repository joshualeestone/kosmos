---
pre_challenge: true
method: challenge-loop
branch: boughtaddr-4756
diff_hash: b3f4d454c020f3bffd587f902d36dfd68a4f66bd308fd8d96a198e22fffb0e01
validation: focused per round (engine/remote.test.js #4756, server.test.js #4756, render-plus-bought-4756.js browser check, both browser-check gates); static set on the main-merged tree 2419/2419; the FULL suite runs on Mortals on this head after this commit, result in the PR
subdir_audit: not run (the diff changes no subdirectory CLAUDE.md)
timestamp: 2026-09-30T21:10:48Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

This is a fresh loop, started because 0bc1a29bc (kosmos#4754 review 3, the free first address) made the earlier
18-round proof invalid.

**Iterations:** 10 (reviewer model alternated: opus on odd rounds, sonnet on even)
**Converged:** Yes, at iteration 10 (no new BLOCKER, WARNING or CONVENTION after deduplication; NITs only otherwise)
**Total findings:** 1 BLOCKER, 12 WARNINGs acted on or deferred as distinct, repeats counted once; about 20 NITs
**Fixed:** 11 | **Deferred:** 6 distinct | **Asked (awaiting user):** 0

**Deviation, stated:** per-round validation was the focused set named above, not the full suite; the full suite is
queued once on the converged head (the fleet's Mortals queue), not per round.
After iteration 8 converged, main was merged (14 commits) and two guards main had gained were met (README index,
selector ids); iterations 9 and 10 reviewed those bytes.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [BLOCKER] engine/remote.js:2004: the engine dropped bought_at and grandfathered, so the free-first-address rule never worked in production --> FIXED (16ac33fad: one derived first_free per row, the server's own first_free preferred)
- [WARNING] web/index.html:43868: the shape rule failed toward "buy one" --> FIXED (16ac33fad: missing fields do not count; the coordinator's 402 is the gate)
- [WARNING] engine/remote.js:1969: switch + list + close grace exceeded the page's 15 s --> FIXED (16ac33fad, test against PLUS_ASK_TIMEOUT_MS)
- [NIT] server.js:8281: unsupported flag not carried (fixed later, iteration 6)
- [NIT] web/index.html:43851: this_name matched by name only
- [NIT] web/index.html:43270: typeof guard on a let in its dead zone (existing pattern)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (a code value, fixed normally)
- [WARNING] engine/remote.js:1971: 500 ms of margin only --> FIXED (78a855248: 1.5 + 10.2 + 2 s, test requires a second of headroom; a claim about the unshipped binary's deadline deleted)
- [WARNING] engine/remote.js:1954: the tunnel verb is unshipped --> DEFERRED: the documented rollout dependency (#4754); the unsupported path is tested
- [WARNING] web/index.html:43226: state machine risk --> DEFERRED: names no defect; the gated check covers each path and ran every round
- [WARNING] web/index.html:44000: refusal recognised by the coordinator's sentences --> DEFERRED: the contract gives a code only for not-bought, which is matched; other wording falls back to a safe Try again

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] web/index.html:44004: a second Finish during the re-read drew the list over a running register --> FIXED (173e7704b: every register bumps the read sequence; scenario fails without it)
- [WARNING] web/index.html:43858: bought free rows ignored by the first-free rule --> DEFERRED: Kitty's review-3 item 5, the free first address follows the unbought computer

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
**Duplicates of prior findings:** 1 (refusal wording)
- [WARNING] engine/remote.js:1984: a failed /v1/meta read counted as the switch off --> FIXED (22db9abb7: fetchMetaFlag's `unread`; the read fails and the page keeps the way back to the list)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [NIT] .claude/plans/boughtaddr-4756.md:22: the What-changes bullet contradicted the decision --> fixed (aed50ebb1)
- [NIT] web/index.html:43231: the fallback catch did not count as a list not read --> fixed (aed50ebb1)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Duplicates of prior findings:** 1 (first-free fail-open)
- [WARNING] server.js:8283: unsupported dropped at the route, so an old binary was offered a re-read that cannot work --> FIXED (f7f64063c: carried and read as off; route test and scenario fail without it)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] web/index.html:44008: the typed-name re-read's loader sat in a hidden panel with Finish still live --> FIXED (3cb33eef5: the wait is shown and Finish hidden; both arms fail on the old page)
- [NIT] engine/remote.js:1972: a test seam's read was published as in flight --> fixed (3cb33eef5)
- [NIT] web/index.html:43787: a thrown re-read left the list buttons disabled --> fixed (3cb33eef5)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
**Duplicates of prior findings:** 2 (refusal wording, state flags)
- [WARNING] engine/remote.js:1969: a stale shared read after a re-sign-in with the same token --> DEFERRED: session tokens are unique per sign-in, and the engine drops any answer whose session changed

Then: main merged (8ed9b8771); the README index and selector-id guards met (168441f46).

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] web/index.html:44060: an unused free first address (a retired computer's) was never offered --> FIXED (d2bbec394: any first_free row sends the page to the list; scenario fails without it)
- [WARNING] engine/remote.js:1972: the in-flight share was untested --> FIXED (d2bbec394: two callers, one run; resetForTests clears it)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Duplicates of prior findings:** 2 (refusal wording, the test env flag)
- [WARNING] web/index.html:44443: the read's sequence is taken after the call --> DEFERRED: correct today (no await precedes the bump, checked); a hazard for a future edit, not a defect
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/remote.js:2004 | BRANCH | fields dropped, first-free rule dead | FIXED | 16ac33fad |
| 2 | 1 | WARNING | web/index.html:43868 | BRANCH | fails toward "buy one" | FIXED | 16ac33fad |
| 3 | 1 | WARNING | engine/remote.js:1969 | BRANCH | timeouts past the page's | FIXED | 16ac33fad |
| 4 | 2 | WARNING | engine/remote.js:1971 | SELF | 500 ms margin | FIXED | 78a855248 |
| 5 | 2 | WARNING | engine/remote.js:1954 | BRANCH | verb unshipped | DEFERRED | rollout dependency |
| 6 | 2 | WARNING | web/index.html:43226 | BRANCH | state machine risk | DEFERRED | no defect named |
| 7 | 2 | WARNING | web/index.html:44000 | BRANCH | refusal wording | DEFERRED | safe fallback |
| 8 | 3 | WARNING | web/index.html:44004 | BRANCH | Finish during re-read | FIXED | 173e7704b |
| 9 | 3 | WARNING | web/index.html:43858 | BRANCH | bought free rows ignored | DEFERRED | review-3 item 5 |
| 10 | 4 | WARNING | engine/remote.js:1984 | BRANCH | unread switch read as off | FIXED | 22db9abb7 |
| 11 | 6 | WARNING | server.js:8283 | BRANCH | unsupported dropped | FIXED | f7f64063c |
| 12 | 7 | WARNING | web/index.html:44008 | BRANCH | hidden loader, live Finish | FIXED | 3cb33eef5 |
| 13 | 8 | WARNING | engine/remote.js:1969 | BRANCH | same-token shared read | DEFERRED | tokens unique |
| 14 | 9 | WARNING | web/index.html:44060 | BRANCH | retired free first address | FIXED | d2bbec394 |
| 15 | 9 | WARNING | engine/remote.js:1972 | BRANCH | in-flight share untested | FIXED | d2bbec394 |
| 16 | 10 | WARNING | web/index.html:44443 | BRANCH | seq read after the call | DEFERRED | correct today |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] web/index.html:43851: this_name matched by name only (iteration 1)
- [NIT] web/index.html:43270: typeof guard on a let in its dead zone, an existing pattern (iterations 1, 10)
- [NIT] engine/remote.js:1444: a long comment line (iteration 8)
- [NIT] server.js:8285: every non-ok read answers 400 (iteration 8)
- [NIT] web/index.html:44000: a thrown re-read after a refused pick leaves the checking line (iteration 9)
- [NIT] engine/remote.js:2000: the unsupported match is not anchored on clap's error: prefix (iteration 9)

### Strengths (across all iterations)
- The session token never leaves the engine: stdin to the tunnel binary, never argv or a Bearer request, asserted with controls (every iteration)
- An unreadable switch is kept apart from an off one; rows, buy links and first_free are filtered to their own shapes (iterations 5, 9)
- The timing budget is asserted against the page's real constant (iterations 3, 5, 9, 10)
- The gated browser check has a scenario per path, and each fix in this loop added one that fails without it (iterations 7, 9)

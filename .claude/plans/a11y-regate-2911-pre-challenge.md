---
pre_challenge: true
method: challenge-loop
branch: a11y-regate-2911
diff_hash: fa9d2c29285c237c1c8aa6abb184945a1326cb5dd43a1b20703fa48b1225c142
validation: passed
subdir_audit: passed
timestamp: 2026-09-14T21:40:58Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (iteration 1 = the 6.0 fix-and-validate baseline; iterations 2-7 = fresh blind reviewer passes, alternating sonnet/opus per kosmos#2032)
**Converged:** Yes (iteration 7 produced zero NEW BLOCKER/WARNING/CONVENTION after dedup)
**Total findings:** 2 BLOCKERs, 10 WARNINGs, 4 CONVENTIONs, 5 NITs
**Fixed:** 19 | **Deferred:** 2 (double-spawn refactor; legacy data-gate key rename) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation baseline)
**Reviewer model:** n/a (validation helper, not a reviewer)
**New findings:** 1 BLOCKER
**Self-generated:** 0 (synthetic finding from a helper exit code, BRANCH by instruction)
- [BLOCKER] docs/browser-checks/render-win32-board-copy.js -- the browser-check declares coverage of the `data-win-hide` surface, which changed in web/index.html (3 new Mac-only tmux-a11y elements) but the check was not updated --> FIXED (fd40afc9: added the tmux-a11y mock + gate row to the Mac-only selector map)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 4 WARNINGs
**Self-generated:** 0 (the 3 stale comments are pre-existing prose the #2559 re-gate falsified, BRANCH; the test gap is a coverage gap, BRANCH)
- [WARNING] web/index.html:44039 -- FR_GATES header comment "both S3 rows advisory" --> FIXED (377c3834)
- [WARNING] web/index.html:44178 -- frPollGates comment "only S2 can set anyBlocked" --> FIXED (377c3834)
- [WARNING] web/index.html:44437 -- step-3 dispatch comment "Both ADVISORY" --> FIXED (377c3834)
- [WARNING] engine/a11ystatus.js appGrant -- production cache path untested (asymmetric vs tmuxGrant) --> FIXED (377c3834: added the prod-cache/resetAppGrantCache test)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 3 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 0 (3 more pre-existing stale comments the re-gate falsified, BRANCH; the plan em dashes are SELF but a house-style fix, not a behavior claim)
- [WARNING] web/index.html:9561 -- S3 pane comment "Both status rows ADVISORY" --> FIXED (b92b1b9e)
- [WARNING] web/index.html:9564 -- SCREEN 3 doc block "Next always available (both gates advisory)" --> FIXED (b92b1b9e)
- [WARNING] web/index.html:44908 -- Turn-On handler header "two Turn On buttons... neither flips Next" --> FIXED (b92b1b9e)
- [CONVENTION] .claude/plans/a11y-regate-2911.md -- em dashes (house rule) --> FIXED (b92b1b9e: replaced with hyphens)
- [NIT] server.js /api/tmux-a11y-status -- present:false advisory mapping only text-asserted --> FIXED (b92b1b9e: added server.tmux-a11y-status-2911.test.js, a behavioral route test)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 2 CONVENTIONs, 1 NIT
**Self-generated:** 0
- [WARNING] server.js /api/a11y-status -- the re-gate merge conditional had no behavioral test (only source-text grep) --> FIXED (b1ed90d9: added server.a11y-status-regate-2559.test.js driving the real route with both sources controlled)
- [CONVENTION] .claude/plans/a11y-regate-2911.md -- "reviewer joshualeestone" conflicts with the Kosmos no-human-reviewer convention (repo CLAUDE.md:152) --> FIXED (b1ed90d9: corrected; josh-review is a provenance label, not a GitHub reviewer)
- [CONVENTION] docs/browser-checks/README.md:370 -- stale render-gated-next description (still "S3 rows ADVISORY") --> FIXED (b1ed90d9)
- [NIT] engine/a11ystatus.js appSqliteRunner -- SQL string-concatenates APP_CLIENT vs the sibling's no-interpolation pattern --> FIXED (b1ed90d9: dropped the concatenation; select by service only, JS narrows to APP_CLIENT)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 1 WARNING, 2 NITs
**Self-generated:** 0 (the merge WARNING is about server.js:8155, a commit-1 line = SELF, but a code fix not a prose claim)
- [WARNING] server.js /api/a11y-status + engine appGrant -- appGrant authoritative both ways, so a false not-granted (a fresh install keying the grant on a client string != APP_CLIENT) would hard-block at the #2912 trap surface --> FIXED (fc167785: the route now treats a fresh native read() trusted:true as an authoritative GRANTED override, so a trusted app is never blocked even if appGrant missed its row; a genuine not-granted still blocks)
- [NIT] engine.reachable.test.js -- setSqliteRunner/setAppSqliteRunner escape the #265 sweep only via an incidental comment mention --> FIXED (fc167785: excused explicitly)
- [NIT] server.js -- S3 poll fires two sqlite subprocess spawns per tick --> DEFERRED (each reader has its own 2s memo vs the 750ms poll, so most spawns elide; a combined single read is a follow-up if S3 poll load ever shows it). A cost note was added at iteration 6.

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 1 WARNING, 1 CONVENTION, 1 NIT
**Self-generated:** 0 (the BLOCKER docblock is pre-existing prose the #2911 route-wiring falsified, BRANCH)
- [BLOCKER] engine/a11ystatus.js tmuxGrant docblock -- a 🛑-flagged "this function is NOT route-called -- do not re-wire the gate to it", directly contradicted by the new /api/tmux-a11y-status route this PR adds --> FIXED (2f6edeb0: rewrote the docblock; tmuxGrant IS route-called now for tmux's own grant, the old "tmux never holds the grant" claim retracted)
- [WARNING] server.js merge -- the read() GRANTED override is stale-tolerant, so a just-revoked app within read()'s ~5min staleness could momentarily serve granted; not a regression, worth a note --> FIXED (2f6edeb0: added an ACCEPTED-TRADEOFF comment; the window is narrow and fails toward not-trapping, strictly no worse than pre-#2559)
- [CONVENTION] .claude/plans/a11y-regate-2911.md -- cites commit 75a53a79a, orphaned by the branch's rebase (bulletin a-rebase-orphans-every-recorded-run) --> FIXED (2f6edeb0: dropped the fragile sha citation)
- [NIT] server.js -- doubled sqlite spawn per poll wants an acknowledging note --> FIXED (2f6edeb0: added a cost note near the route; refactor stays deferred)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 (after dedup) -- CONVERGED
**Self-generated:** 0
- [WARNING] server.js:8170 stale-revoke false-green window --> DUPLICATE of iteration 6's WARNING; reviewer confirms it is "named as an accepted tradeoff... not a merge blocker" (confirmed resolved)
- [NIT] server.js doubled sqlite spawn --> DUPLICATE (confirmed resolved; the cost note is present)
- [NIT] web/index.html legacy data-gate="tmux" key names the APP gate (invertible with the new tmux-a11y sibling) --> DEFERRED: renaming would churn ~6 browser-checks + the handler + FR_GATES for a cosmetic gain, and it is mitigated by thorough comments and the "Kosmos" vs "tmux" label tests. Reviewer agrees keeping it is defensible.
**Converged** -- every finding deduplicated away or is a non-blocking NIT; no unresolved ASKED findings.

### Final Ledger (representative; full detail in the per-iteration breakdown)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | render-win32-board-copy.js | BRANCH | new data-win-hide surface uncovered | FIXED | fd40afc9 |
| 2-4 | 2 | WARNING | web/index.html (3 sites) | BRANCH | stale S3-advisory comments | FIXED | 377c3834 |
| 5 | 2 | WARNING | engine/a11ystatus.js | BRANCH | appGrant prod-cache untested | FIXED | 377c3834 |
| 6-8 | 3 | WARNING | web/index.html (3 sites) | BRANCH | stale S3-advisory comments | FIXED | b92b1b9e |
| 9 | 3 | CONVENTION | plan | SELF | em dashes | FIXED | b92b1b9e |
| 10 | 3 | NIT | tmux-a11y route | BRANCH | present:false mapping untested | FIXED | b92b1b9e |
| 11 | 4 | WARNING | server.js a11y-status | SELF | re-gate merge untested | FIXED | b1ed90d9 |
| 12 | 4 | CONVENTION | plan | SELF | reviewer joshualeestone vs Kosmos convention | FIXED | b1ed90d9 |
| 13 | 4 | CONVENTION | README.md:370 | BRANCH | stale render-gated-next doc | FIXED | b1ed90d9 |
| 14 | 4 | NIT | engine/a11ystatus.js:159 | SELF | APP_CLIENT SQL concatenation | FIXED | b1ed90d9 |
| 15 | 5 | WARNING | server.js merge | SELF | appGrant both-ways trap (client mismatch) | FIXED | fc167785 |
| 16 | 5 | NIT | engine.reachable.test.js | BRANCH | sqlite seams escape sweep incidentally | FIXED | fc167785 |
| 17 | 5 | NIT | server.js poll | BRANCH | doubled sqlite spawn (refactor) | DEFERRED | 2s memo elides most; combined read is a follow-up |
| 18 | 6 | BLOCKER | engine/a11ystatus.js docblock | BRANCH | stale "not route-called" directive | FIXED | 2f6edeb0 |
| 19 | 6 | WARNING | server.js merge | SELF | stale-revoke false-green window | FIXED | 2f6edeb0 (accepted-tradeoff note) |
| 20 | 6 | CONVENTION | plan | SELF | rebase-orphaned sha citation | FIXED | 2f6edeb0 |
| 21 | 7 | NIT | web/index.html | BRANCH | legacy data-gate="tmux" naming | DEFERRED | high-churn rename; mitigated by comments + label tests |

### Outstanding questions (ASKED, still unresolved)
None.

### NITs (non-blocking, across all iterations)
- [NIT] server.js -- S3 polls two sqlite readers (appGrant + tmuxGrant); acknowledged with a cost note, combined-read refactor deferred (iterations 5-7).
- [NIT] web/index.html -- the legacy data-gate="tmux" key names the APP gate, invertible with the new tmux-a11y sibling; kept for back-compat, mitigated by comments + label tests (iteration 7).

### Strengths (across all iterations)
- The /api/a11y-status merge is trap-free by construction: a block is only ever set from a live checkable+not-trusted reading (never inferred from the native fallback's absence), and read() is consulted only to UPGRADE toward granted -- so the laggy #2912 false-negative can never resurface as a false block. Traced across all arms by iterations 5, 6 and 7.
- tmuxGrant's `present` flag keeps the re-gate block-on-positive while never trapping a user reached before tmux registers (present:false -> advisory), covered from three angles: engine unit tests, the route test, and a browser-check arm.
- Tests are red-capable in both directions and drive the REAL routes/DOM (not source-text greps): the two server route tests control both sources; render-gated-next isolates every S3 gate arm; the web tests use codeOnly() so prose cannot satisfy a check (a-check-containing-a-copy-cannot-fail).
- Every stale/false-premise comment from the prior design was rewritten with measured evidence, not left behind (the "tmux never holds the grant" over-generalization retracted in code and plan).

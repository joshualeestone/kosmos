---
pre_challenge: true
method: challenge-loop
branch: sessionblock-8782
diff_hash: d53dc22f9d347e6168f981793e604eaf81e49c15f8a0cb3c876c60603eb41db1
validation: failed under load - full run on 4cc49479c9 at load 15.66 on 12 cores (5-min load 39) had 12 fails of 30157 in 4 files, none touching this change; each of the 4 files passed alone right after (52/52). The validation log records status=failed; CI runs the full suite on the PR.
subdir_audit: passed
timestamp: 2026-11-20T03:09:58Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes
**Total findings:** 33 (0 BLOCKERs, 11 WARNINGs, 3 CONVENTIONs, 19 NITs)
**Fixed:** 9 WARNINGs, 1 CONVENTION, 9 NITs | **Deferred:** 2 WARNINGs, 2 CONVENTIONs | **Asked (awaiting user):** 0

Validation per iteration: the three selfreport test files (the new one, selfreport.autoclear-2456, selfreport) after
every fix, 64 -> 67 -> 68 -> 70 -> 71 -> 73 tests, all passing; a mutation check for each new rule (each failed as
expected and was restored from a copy). Full validation started twice mid-loop was stopped before a fix (it would
have measured superseded code); the final full run is described in the frontmatter.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/selfreport.js — "a different instance" is not "the old run is over": two live runs overlap (#570) --> FIXED (gate on sendertoken.instanceState 'gone'; measured: the 11-19 crashed instances read gone, new ones held)
- [WARNING] engine/selfreport.js — the #900/#2456 comment still said transient-only --> FIXED
- [NIT] engine/kosmos-report-hook.js header --> FIXED
- [NIT] engine/chat.js:3148 "nothing ever writes" --> FIXED ("within one run")
- [NIT] the provider prefix regex written twice --> FIXED (PROVIDER_BLOCK_ON, isAnyAutoProviderBlockRow)
- [NIT] mixed-instance run keeps the block --> FIXED (stated residual in the plan, pinned by a test)
- [NIT] no mixed-instance or legacy tests --> FIXED (later iterations)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the "run has ENDED" wording, written in iteration 1)
- [WARNING] "ended" vs "token gone" wording --> FIXED (comment, plan and hook header say "token is gone")
- [WARNING] inline require with a silent catch --> FIXED (top-level require; no cycle; instanceState never throws)
- [WARNING] the gone walk stepped over a live sibling's block --> FIXED (walk limited; sibling test added)
- [NIT] isAutoProviderBlock and the any-kind test could drift --> DEFERRED: #6209's function left as is to keep its behaviour byte-identical
- [NIT] chat.js comment could mention the cross-run clear --> DEFERRED: the edit says "within one run", which is accurate
- [NIT] plan test section read as history --> FIXED

#### Iteration 3
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above (code written in iteration 2)
- [WARNING] engine/selfreport.js:381 — a gone run's TRANSIENT block could be kept where main clears it --> FIXED (gone walk only for kinds #6209 keeps; test with a transient sibling)
- [NIT] nearest comment named only #6209 --> FIXED
- [NIT] no legacy-instance test --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the walk written in iteration 2)
- [WARNING] two gone runs in a row stopped the walk --> FIXED (walk steps over any provider block whose run's token is gone; test added)
- [WARNING] synchronous token read on the Stop path; replaced-but-live token reads gone --> FIXED (plan "Cost and a known edge")
- [NIT] comment could mention both instances must be known --> noted (the tests pin it)
- [NIT] plan's "full validation" line is a promise --> noted (result recorded here)
- [NIT] chat.js comment --> DEFERRED (as iteration 2)

#### Iteration 5
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 of the above
- [CONVENTION] install/kosmos-report-hook.sh:21,43 — the Mac hook's header still said #6209 only --> FIXED
- [NIT] gone walk did not also step over live transient blocks --> FIXED (test added)
- [NIT] token read wasted when the standing block is transient --> FIXED (checked first)
- [NIT] not every automatic idle is a turn end --> FIXED (weakest premise in the plan)
- [NIT] permission prompt under the block, and a cut tail, untested --> FIXED for the permission prompt; the cut tail is #6209's existing path

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs (2 deduplicated), 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] a non-turn-end idle from a new run clears a still-real sign-in block --> DEFERRED (duplicate of iteration 5's NIT, accepted in the plan's weakest premise; for a Claude agent the hook sends idle only at a turn end, and a still-broken sign-in fails that turn and writes a fresh block)
- [WARNING] a token rotated while its process still runs reads gone --> DEFERRED (duplicate of iteration 4's, in the plan's "known edge"; the comment says what the code checks)
- [CONVENTION] full validation unproven in the diff --> recorded in this proof
- [NIT] read() could someday carry instance forward --> noted (it does not today)
- [NIT] a live transient block is swept with the gone run's, as on main --> noted (deliberate, tested)
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/selfreport.js | BRANCH | overlapping live runs | FIXED | e13e0083cf |
| 2 | 1 | WARNING | engine/selfreport.js | BRANCH | stale transient-only comment | FIXED | e13e0083cf |
| 3 | 2 | WARNING | engine/selfreport.js | SELF | "ended" wording | FIXED | a941704931 |
| 4 | 2 | WARNING | engine/selfreport.js | BRANCH | silent inline require | FIXED | a941704931 |
| 5 | 2 | WARNING | engine/selfreport.js | BRANCH | walk swept a live sibling's block | FIXED | a941704931 |
| 6 | 3 | WARNING | engine/selfreport.js:381 | SELF | gone run's transient block kept | FIXED | 8d544d3378 |
| 7 | 4 | WARNING | engine/selfreport.js:233 | SELF | two gone runs stopped the walk | FIXED | 9a4af19626 |
| 8 | 4 | WARNING | engine/selfreport.js:208 | BRANCH | token read cost and replaced-token edge | FIXED | plan, 9a4af19626 |
| 9 | 5 | CONVENTION | install/kosmos-report-hook.sh:21 | BRANCH | Mac hook header | FIXED | 4cc49479c9 |
| 10 | 6 | WARNING | engine/selfreport.js:403 | BRANCH | non-turn-end idle | DEFERRED | dup of iter 5, in plan |
| 11 | 6 | WARNING | engine/selfreport.js:236 | BRANCH | rotated live token reads gone | DEFERRED | dup of iter 4, in plan |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- isAutoProviderBlock could be built on the any-kind test (iteration 2), left for #6209's stability.
- read() carrying instance forward in future would mis-aim the check (iteration 6).

### Strengths (across all iterations)
- The premise held on real data: the crashed instances' tokens are gone, the new ones held (iterations 1 and 2).
- Every unclear case keeps the block: held, unknown, legacy, missing or equal instances, a covered deliberate wait.
- Same-run #6209 behaviour unchanged; transient kinds never read the token file.
- One derivation (providerBlockEnds) feeds both the clearing branch and the protected-wait guard.

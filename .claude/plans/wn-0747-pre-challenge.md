---
pre_challenge: true
method: challenge-loop
branch: wn-0747
diff_hash: 36a5b3099dce21895e029c58c8196d72f4db316b1eed3ff0a4b56eb3bdc54c6a
validation: passed
subdir_audit: passed
timestamp: 2026-10-13T22:07:47Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 5 converged; the window then changed when Qwen was held, so iteration 6 re-reviewed it and converged)
**Total findings:** 17 actionable (2 BLOCKERs, 14 WARNINGs, 1 CONVENTION) plus NITs
**Fixed:** 10 | **Deferred:** 7 | **Asked (awaiting user):** 0

Validation: Mortals full suite on b78f2df023, clean (20238 tests, 0 failed; shell 232/232; browser-check gates 0 failed). Mortals hashed the diff with ids at 9 characters (464246472ba0); the local abbrev-9 hash of the same diff is identical (measured), and run_or_skip matched it ("the clean entry is this diff with its ids spelled '9'"). Base on Mortals was main 7ef94612f9; main has since moved, so the merged tree is measured by the PR's CI.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 4 WARNINGs, 1 CONVENTION, NITs
**Self-generated:** 0 of the above
- [BLOCKER] web/whats-new.json:5 - the scroll-back line describes #6097, still open --> DEFERRED: by order, not by wording; this PR is a draft until #6097 is on main, and the cut waits on both
- [WARNING] web/whats-new.json:5 - "a long conversation" is broader than #6097 (direct conversations only) --> FIXED ("with an agent")
- [WARNING] web/whats-new.json:20 - imports line promised an answer on every move --> FIXED
- [WARNING] web/whats-new.json:27 - Gemini line false where updates were allowed --> FIXED
- [WARNING] web/whats-new.json:27 - Gemini line promised a version the change does not set --> FIXED
- [CONVENTION] .claude/plans/ - no plan file --> FIXED (wn-0747.md; the first commit also wrote the window by hand, redone from the pool)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, NITs
**Self-generated:** 1 of the above (the escaped character, from iteration 1's rewrite)
- [WARNING] web/whats-new.json:6 - merge order only stated in the plan --> DEFERRED: duplicate of iteration 1's BLOCKER (draft PR)
- [WARNING] engine/connections.js:86 - the agents' guide still says Qwen cannot be chosen --> DEFERRED: outside this diff, owner's slice; commented #5977 and told PigeonPete, who fixed it in #6099 (and found the Qwen add route itself broken)
- [WARNING] release/whats-new-pool.json - Gemini line omitted the person's own gemini on the default account --> FIXED
- [NIT] release/whats-new-pool.json:349 - a literal character escaped by iteration 1's rewrite --> FIXED

#### Iteration 3
**Reviewer model:** haiku
**New findings:** 0 BLOCKERs, 3 WARNINGs, NITs
**Self-generated:** 0 of the above
- [WARNING] pool - imports line omitted the git repository exception --> FIXED
- [WARNING] web/whats-new.json:6 - nothing enforces the merge order --> DEFERRED: duplicate; now enforced by the draft state, recorded in the plan
- [WARNING] pool - Gemini item untagged although not run on Windows --> FIXED (tagged mac)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, NITs
**Self-generated:** 0 of the above
- [WARNING] web/whats-new.json:6 - merge order --> DEFERRED: duplicate
- [WARNING] pool - Gemini claim not measured on the Kosmos-managed copy --> DEFERRED: the keys are gemini's own settings and the managed copy is the same gemini 0.61.0 reading the same file; pool only (rank 16)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 new WARNINGs (2 repeats), NITs
**Self-generated:** 0 of the above
- [WARNING] merge order --> duplicate
- [WARNING] pool - Gemini mac tag is a verification gap, not a platform fact --> duplicate of iteration 3's decision, argued the other way; kept (under-claims), reason in the plan
**Converged** - then Qwen was held (Splinter 15:57: every Qwen add refused on main until #6099), which changed the window.

#### Iteration 6
**Reviewer model:** haiku
**New findings:** 0 new BLOCKERs, WARNINGs or CONVENTIONs
**Self-generated:** 0 of the above
- [BLOCKER] merge order --> duplicate (draft PR)
- [WARNING] Gemini mac tag --> duplicate (iteration 5)
- [WARNING] web/whats-new.json:24 - phone-fit sub-claims unverified --> DEFERRED: an existing pool entry this branch does not change, reviewed when written (whatsnew-0729 review round 2 measured the Community fix at about 360 px)
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/whats-new.json:5 | BRANCH | scroll-back announced before #6097 merges | DEFERRED | draft PR until #6097 is on main; cut waits on both |
| 2 | 1 | WARNING | web/whats-new.json:5 | BRANCH | scope wider than direct conversations | FIXED | 7568d4ba83 |
| 3 | 1 | WARNING | web/whats-new.json:20 | BRANCH | imports line too broad | FIXED | 7568d4ba83 |
| 4 | 1 | WARNING | web/whats-new.json:27 | BRANCH | Gemini line false when updates allowed | FIXED | 7568d4ba83 |
| 5 | 1 | WARNING | web/whats-new.json:27 | BRANCH | Gemini line promised a version | FIXED | 7568d4ba83 |
| 6 | 1 | CONVENTION | .claude/plans/ | BRANCH | no plan file | FIXED | 6c01ff18ba / plan commit |
| 7 | 2 | WARNING | engine/connections.js:86 | BRANCH | guide says Qwen unavailable | DEFERRED | owner's slice; fixed in #6099 |
| 8 | 2 | WARNING | release/whats-new-pool.json | BRANCH | Gemini side effect unstated | FIXED | 77739df867 |
| 9 | 2 | NIT | release/whats-new-pool.json:349 | SELF | escaped literal character | FIXED | 77739df867 |
| 10 | 3 | WARNING | release/whats-new-pool.json | BRANCH | git repository exception | FIXED | 17f927cf10 |
| 11 | 3 | WARNING | release/whats-new-pool.json | BRANCH | Gemini not run on Windows | FIXED | 17f927cf10 |
| 12 | 4 | WARNING | release/whats-new-pool.json | BRANCH | managed gemini copy unmeasured | DEFERRED | same program, same settings file; pool only |
| 13 | 6 | WARNING | web/whats-new.json:24 | BRANCH | phone-fit sub-claims | DEFERRED | unchanged entry, reviewed in whatsnew-0729 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- "keeping your place" holds when a batch lands; pictures that load later can still move rows (iteration 5)
- "Long task and room messages": the title says task, the line colleague (iterations 4, 5, 6)
- "Subprojects": the "(3)" count appears in the Tasks picker only (iteration 6)
- the squash message should not carry the first draft's titles (iteration 2): edit it at merge

### Strengths (across all iterations)
- The built window is exactly the pool's top 5 pending by rank, checked with the tool's own choose() (iterations 2 to 6)
- The pool bookkeeping is the tool's own: lastProd 0.7.46 and exactly 0.7.46's five titles marked shown (iterations 2 to 6)
- No em dash in any spelling, with a live positive control (iteration 6)
- A held entry carries its reason and is never chosen (iteration 6)

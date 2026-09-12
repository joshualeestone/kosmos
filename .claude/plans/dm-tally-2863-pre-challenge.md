---
pre_challenge: true
method: challenge-loop
branch: dm-tally-2863
diff_hash: f245de59f959174e80e31d2e9e15705d5f3cd15a2d734e8238c9628029ff98d3
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T07:39:36Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (Sonnet, Opus - model varied per kosmos#2032)
**Converged:** Yes, iteration 2 found no BLOCKER/WARNING/CONVENTION.
**Total findings:** 3 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs)
**Fixed:** 2 | **Deferred:** 1 (a NIT) | **Asked:** 0

The change is the AGENTS half of #2863's top tally: a "Messages" tile in the agents tile row summing
`a.dmUnread` across the fleet (the rollup of the per-agent DM bubbles from #2885, on Angel's engine
#2881). The projects tally is the follow-up.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 (first reviewer pass)
- [WARNING] the tally summed a.dmUnread across ALL agents with no CURRENT exclusion; correct only
  because paintTalk zeroed the open agent earlier in the same tick (implicit execution-order coupling),
  where the per-agent badge suppresses the open agent EXPLICITLY -- a two-derivations-of-one-fact drift
  hazard. --> FIXED: exclude CURRENT in the reduce, byte-for-byte the dmBadge guard; test injects CURRENT
  + a fleet-based exclusion case.
- [NIT] .dmtile-g had no explicit box, unlike sibling glyphs --> FIXED (16px box).

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
- [NIT] server.test.js:3040's pre-existing "the slice INCLUDES every tile write" comment no longer
  literally covers the new st-dm write (it sits just past the slice boundary). --> DEFERRED: not a real
  coverage gap (the reduce IS executed in the dedicated test, the tile wiring is trivial and
  string-matched); extending that large untouched test's slice for a cosmetic comment adds risk for no
  gain. The reviewer called it optional.
**Converged** — no actionable findings; the reviewer independently confirmed the CURRENT exclusion is
byte-for-byte dmBadge's guard, test quality high, and consistent with the rest of the tile row.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html | BRANCH | tally did not exclude the open agent (CURRENT) | FIXED | 5631845d |
| 2 | 1 | NIT | web/index.html | BRANCH | .dmtile-g had no explicit box | FIXED | 5631845d |
| 3 | 2 | NIT | server.test.js:3040 | BRANCH | stale "every tile write" slice comment | DEFERRED | not a real gap; touching it adds risk |

### Outstanding questions (ASKED)
None.

### NITs (non-blocking)
- .dmtile-g explicit box (iteration 1, FIXED)
- server.test.js:3040 stale slice comment (iteration 2)

### Strengths
- The CURRENT exclusion is byte-for-byte the dmBadge guard, null-safe, explicit rather than relying on
  paintTalk's execution order (repo convention #5, two-derivations-of-one-fact). (iteration 2)
- The test extracts the real reduce from source and evals it with CURRENT injected (guards the code,
  not a paraphrase), with a fleet-based exclusion case + a control, fixture-discipline compliant. (iteration 2)
- Consistent with the tile row: summed client-side like Working/Idle, null/negative -> 0, hidden at
  zero, `?`+hidden on a failed poll like the red tiles. (iteration 2)

### Validation note
Full suite + post-test gates passed clean (6373 tests, 0 fail; `validation PASSED for stack=typescript`),
taken in a lower-load window. Under the fleet's heavy load tonight (peaked at load ~21) two runs
false-red on timing/concurrency tests unrelated to this change (engine/feedbacksend.test.js scrub,
server.doorflight-1618.test.js) - both pass in isolation, both named by the harness as contention. The
clean run above was taken once load dropped to ~7.8. Subdir CLAUDE.md audit clean.

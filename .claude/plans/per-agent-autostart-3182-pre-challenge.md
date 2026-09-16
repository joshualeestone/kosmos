---
pre_challenge: true
method: challenge-loop
branch: per-agent-autostart-3182
diff_hash: 9303dae4d53fcb7e084391cebce2b14bd95b4c39819013f7667cb3aa68b460f2
validation: passed
subdir_audit: passed
timestamp: 2026-09-16T15:17:45Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3, opus, on the post-fix code, found zero actionable findings)
**Total findings:** 6 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs)
**Fixed:** 3 | **Deferred:** 3 | **Asked (awaiting user):** 0

The multi-model rotation earned its keep: iteration 1 (opus) found no actionable issue, but iteration
2 (sonnet) caught a real WARNING opus missed - the removed-list read was unconditional, wasting a disk
read on the common OK path AND breaking test hermeticity (the removed read, unlike the disabled read,
was not runner-injected, so empty-disabled tests touched the operator's real store.ROOT). Fixed by
short-circuiting to OK before the removed read; iteration 3 (opus) re-reviewed the fix clean.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 (the loop is reviewing the pre-loop build commit; no loop fix had committed yet)
- [NIT] engine/machine.js (~check wiring) -- check() shells `launchctl print-disabled` twice per tick (board arm + agent arm), a duplicate subprocess --> DEFERRED: acceptable for v1, the two are independent fail-soft seams; sharing the read would couple them.
- [NIT] engine/machine.js (removed-exclusion) -- keys on create.cleanName (trim, no case-fold) --> DEFERRED: verified correct today, both sides derive from the same cleanName path and agent slugs are lowercased at write time.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 (findings sit on the pre-loop build commit's lines, not a loop-fix commit -> BRANCH)
- [WARNING] engine/machine.js:1715-1720 -- removedNames() read unconditionally: wasted disk read on the common OK path, AND a hermeticity gap (the non-injected removed read touched the real store.ROOT on empty-disabled tests; they passed by accidental correlation, not hermetically) --> FIXED (9d1b76b): return OK before the removed read when no agents are disabled.
- [NIT] engine/machine.js:1716-1719 -- the try/catch on the removed read was untested (only the ok:false branch was) --> FIXED (9d1b76b): added a throwing-getter test exercising the catch.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Converged** -- no new actionable findings; the iter-2 fix confirmed correct (ordering load-bearing, no okRow aliasing, tests hermetic).
- [NIT] engine/machine.js:1728 -- the production require('./remove').removedNames() real-file read is never exercised (all ATTENTION tests inject opts.removed; non-injected tests short-circuit at OK) --> DEFERRED: deliberate hermeticity tradeoff (reaching the real read touches store.ROOT); the ok:false + throwing branches ARE covered via injection.
- [NIT] .claude/plans/per-agent-autostart-3182.md -- plan said "12 branch tests", file has 13 --> FIXED (e2495bb): corrected to 13.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | NIT | engine/machine.js (check wiring) | BRANCH | double print-disabled exec (board + agent arms) | DEFERRED | acceptable v1; independent fail-soft seams |
| 2 | 1 | NIT | engine/machine.js (removed key) | BRANCH | cleanName key is trim-only (no case-fold) | DEFERRED | verified correct today; same cleanName path both sides |
| 3 | 2 | WARNING | engine/machine.js:1715-1720 | BRANCH | unconditional removed read: wasted disk read + hermeticity gap | FIXED | 9d1b76b |
| 4 | 2 | NIT | engine/machine.js:1716-1719 | BRANCH | removed-read catch branch untested | FIXED | 9d1b76b |
| 5 | 3 | NIT | engine/machine.js:1728 | BRANCH | production real-file removed read untested | DEFERRED | deliberate hermeticity tradeoff; guard branches covered by injection |
| 6 | 3 | NIT | .claude/plans/...-3182.md | BRANCH | plan test count 12 vs 13 | FIXED | e2495bb |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, deferred)
- Double print-disabled exec per check() tick (iteration 1) - independent seams, acceptable for v1.
- cleanName key is trim-only (iteration 1) - correct today; an awareness note for any future case-drifting rename path.
- Production real-file removed read untested (iteration 3) - the hermeticity tradeoff; the guard's fallback branches are covered via injection.

### Strengths (across iterations)
- Clean mirror of the sibling boardAutostartCheck: same 'in opts' seam discipline, runner threading, STATE.UNKNOWN-for-could-not-look, and never-mutates-launchd guard.
- Correct fail-soft / cannot-see-zero discipline: unreadable disabled read -> UNKNOWN (never a false OK); unreadable or throwing removed read -> none-removed (surfaces a live disabled agent, the safe direction). Both directions tested.
- create.disabledJobsResult(runner) gains the injected runner fully backward-compatibly (every existing caller unchanged); world-scoping + the both-tokens regex + fail-soft stay owned in one place.
- Thorough, non-vacuous branch coverage (off-darwin null, UNKNOWN, empty->OK, Set/Array shapes, singular/plural, sorted "and N more", removed-excluded, mix, ok:false + throwing catch, a runner-path integration through disabledJobsResult, and a read-only guard); the row-count sibling test bumped 5->6 with an injected disabled seam so it stays hermetic.
- No em dashes in any changed line; user-facing copy plain-language (System Settings > General > Login Items).

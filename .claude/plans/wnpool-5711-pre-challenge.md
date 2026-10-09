---
pre_challenge: true
method: challenge-loop
branch: wnpool-5711
diff_hash: 97cbbe442da40497bceca3984a349da82a71fae2750f44625fe8c1fdb0347087
validation: passed (Mortals: node 18005 tests, 17763 pass, 0 fail; shell FAILS 0; entry clean for this hash)
subdir_audit: passed
timestamp: 2026-10-09T22:47:50Z
iterations: 14
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 14 (blind reviewers alternating opus and sonnet)
**Converged:** Yes. Round 8 first returned only duplicates; a self-found fix after it (where the frozen sha is recorded)
changed code, so the loop resumed and converged again at round 14, whose three warnings all dedup to ledger entries.
**Total findings (from the plan's per-round records):** 0 BLOCKERs, 36 WARNINGs, 0 CONVENTION defects, about 41 NITs
**Fixed:** 27 warnings | **Deferred or stated, with reasons:** 9 (each a duplicate of an earlier stated item by the
round it recurred) | **Asked (awaiting user):** 0

### Per-Iteration Breakdown
Reviewer model per round: 1 opus, 2 sonnet, 3 opus, 4 sonnet, 5 opus, 6 sonnet, 7 opus, 8 sonnet, 9 opus, 10 sonnet,
11 opus, 12 sonnet, 13 opus, 14 sonnet. Self-generated findings: rounds 9 and 11 each named one gap left by an
earlier round's fix (--ref optional, then --ref walking back); counted as SELF.

- Round 1 (opus): 4 warnings fixed (unmatched titles refused, prod reminder, live-count test, platform gate).
- Round 2 (sonnet): build refuses a version not newer than lastProd; premise stated; #5713 deferral stated.
- Round 3 (opus): `shown` runs on main's pool; forgotten-shown risk stated on #5713; options and items validated.
- Round 4 (sonnet): `shown` needs --promoted; atomic pool write; zero pending is legal.
- Round 5 (opus): no v<ver> tags exist, so --from-history; 0.7.33 item un-held; real-pool test runs build.
- Round 6 (sonnet): throwaway-repo history test; real-history arm skips on a shallow clone (proven in a --depth 1 clone).
- Round 7 (opus): both runbooks describe the pool; --ref=<frozen sha>; prod means the Mac family.
- Round 8 (sonnet): 3 warnings, all duplicates. Converged; then the frozen-sha location fix (self-found).
- Round 9 (opus): Windows-only items stay pending on a Mac promote; --from-history requires --ref.
- Round 10 (sonnet): the real-history test pins lastProd (the old test proven red after a promote).
- Round 11 (opus): read exactly at --ref, never walk back; lastProd validated.
- Round 12 (sonnet): the announcement cost restated plainly in build's output and on the card.
- Round 13 (opus): usage lines show --ref as required.
- Round 14 (sonnet): 3 warnings, all duplicates (cut-time check with #5713; Windows-only retire stated; premise stated).

### Final Ledger
[WARNING] tools/whats-new-pool.js: a forgotten `shown` after a prod promote repeats prod's highlights. DEFERRED to #5713 (Angel, built and stacked); `build` prints the step every run.
[WARNING] release/whats-new-pool.json: "since the last PROD release" is read as "not yet announced to prod users", so 0.7.36 names 0.7.31 to 0.7.34 features prod users already have. STATED on #5711 (6089064728) with the one-line data change that reverses it.
[WARNING] tools/release.sh 1b-ii: nothing checks that the committed web/whats-new.json equals `build`'s output. DEFERRED to #5713 (Angel's cut-side prod check).
[WARNING] tools/whats-new-pool.js: a Windows-only highlight is never retired by a Mac promote. STATED in the docblock: retire it by hand.
[WARNING] tools/whats-new-pool.js choose(): a platform-tagged item takes one of the five shared slots. STATED: per-platform slots need a new file shape.
[NIT] tools/whats-new-pool.js: the tie-break comparator never returns 0 (titles are unique, enforced at read).
[NIT] tools.whats-new-pool-5711.test.js: the real-pool count assertion restates slice; kept as the live-data guard.
[NIT] .claude/plans: the rank-1 and rank-6 community items overlap in subject; re-rank by hand if rank 1 is shown first.
[STRENGTH] The seed matches every version's final web/whats-new.json from 0.7.31 to 0.7.35, word for word, checked by several reviewers.
[STRENGTH] `shown` refuses without --promoted, another version's file, an older version, unmatched titles, --ref missing, and reads exactly at the frozen sha; each refusal has a control that proceeds.
[STRENGTH] Every refusal and gate has a mutant proven red (M1 to M15), and `build`'s output is accepted by the cut's own check for mac and windows.
[STRENGTH] Conversation mode is held and cannot resurface; the 0.7.36 list is deterministic (rank, newest, title).

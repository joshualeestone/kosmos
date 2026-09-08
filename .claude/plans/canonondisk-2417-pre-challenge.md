---
pre_challenge: true
method: challenge-loop
branch: canonondisk-2417
diff_hash: 1d9d60e4028ae7db0a0032f3fa786078fa54e4b3edd70d6d276c5c4b75ab9267
validation: passed
subdir_audit: passed
timestamp: 2026-09-07T17:02:51Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (iter 1 = 6.0 baseline; iters 2-3 = fresh blind agent reviews)
**Converged:** Yes (both blind passes returned zero NEW BLOCKER/WARNING/CONVENTION)
**Total findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 3 NITs
**Fixed:** 3 NITs | **Deferred:** 0 | **Asked:** 0

This is an AUDIT card. One code fix (codexsession.forWorkdir); every other candidate site verified
and LEFT with a documented reason. Both blind reviews confirmed the fix correct and the LEAVE
reasoning sound; their only findings were audit-doc-completeness NITs (name one more out-of-class
dedup site), all addressed, and the plan now states the LEAVE class once so the doc is self-completing.

### Per-Iteration Breakdown

#### Iteration 1 (6.0 baseline)
Full validation + subdir audit on the initial commits: clean (5086/0).

#### Iteration 2 (blind agent, fix commit 38f5ea67)
**New findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 2 NITs
- [NIT] test skip was a bare `return;` (reads as a silent pass) --> FIXED: `(t)` + `t.skip()`.
- [NIT] plan did not name discover.js 310/313 (foundCodex byDir dedup) + 239 (codexIdentity read)
  --> FIXED: added as LEAVE (on-disk-vs-on-disk / read target).
Confirmed as STRENGTHs: fix correct + minimal, gone-folder fallback byte-identical, test genuinely
armed (reverting reds it), status.js comments accurate, no require cycle, LEAVE reasoning sound.

#### Iteration 3 (blind agent, fix commit ee1b1151)
**New findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 1 NIT
- [NIT] plan did not name geminisession.js:62-65 (projects() dedup) --> FIXED: added as LEAVE, and
  stated the four out-of-class LEAVE shapes once so a future realpathSync grep needs no per-site
  re-derivation.
**Converged** -- iter 2 was already zero-actionable, iter 3 confirmed on the changed code.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 2 | NIT | codexsession.test.js | bare `return;` skip reads as silent pass | FIXED | 38f5ea67 |
| 2 | 2 | NIT | plan | discover.js 310/313/239 undocumented | FIXED | 38f5ea67 |
| 3 | 3 | NIT | plan | geminisession.js:62-65 undocumented | FIXED | ee1b1151 |

### The audit result (the card's deliverable)
- **FIX:** codexsession.js `forWorkdir` -- the one recorded-vs-getcwd site. `trust.canonicalOnDisk`
  on both sides (case + /private + unicode fold) so a case-divergent launch folder matches its
  codex rollout; plain realpathSync preserved case and missed it (the #2257 symptom via this door).
  Armed case-variant test; stale status.js comments updated to say the door is closed.
- **LEAVE (with reasons in the plan):** accounts.js 168/367/444 (symmetric derived-vs-derived),
  delete-leftover.js:192 (delete guard -- folding case would only loosen it), reporthook.js 230/259
  (self-resolutions), discover.js 1166/1289/310/313/239 (dedup keys / read targets), geminisession.js
  62-65 (dedup), workerfile.js 140-141 (escape guard), status.js 75/80 (fixture guard), projects.js
  446 + status.js 3177/3186 (already canonicalOnDisk/.native).

### Outstanding questions (ASKED)
None.

### NITs (all fixed)
- test visible-skip; plan completeness (three sites); class-statement.

### Strengths (across iterations)
- The fix reuses the shared canonicalOnDisk primitive, is byte-identical on the gone-folder path,
  and no case exists where the old code matched and the new does not.
- The armed test reds on plain realpathSync and skips visibly on a case-sensitive fs.
- The audit's value is the documented LEAVE class, not just the one fix.
- No require cycle; no em dashes in changed lines.

### Perturbation record
- codexsession fix reverted to plain realpathSync-on-both-sides: reds the case-variant test.

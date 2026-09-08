---
pre_challenge: true
method: challenge-loop
branch: chgdlg-control-fix
diff_hash: b54e60f27416c166b48ccd4725904c8fa52801def5d037d3993ad22a3cd228a7
validation: passed
subdir_audit: passed
timestamp: 2026-09-08T02:17:37Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 1 WARNING, 3 NITs (0 BLOCKERs, 0 CONVENTIONs)
**Fixed:** 0 | **Deferred:** 1 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] web.change-dialog.test.js:103 — On current origin/main the control now always skips (dormant guard); ongoing coverage rests on the main test at line 74 --> DEFERRED: deliberate, documented design choice. The control was always a one-time proof-of-bite tied to the fix's merge lifecycle; once merged, origin/main cannot serve as a pre-fix reference. The live guard is the main test (line 74). Rejected alternative (pin a pre-fix sha to keep it biting in CI): trades dormancy for a shallow-clone skip risk and hardcodes git archaeology. Documented as the plan's weakest premise.
- [NIT] web.change-dialog.test.js:102-103 — Behaviour guard runs the full change() flow before it can skip; a future refactor removing changeDialog/changeModelNow would RED (arguably desirable) --> no action; a broken reference surfacing as RED is acceptable.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Duplicates of prior findings:** 1 (the dormant-control NIT dedupes to the iteration-1 DEFERRED WARNING)
- [NIT] web.change-dialog.test.js:103 — (duplicate of iter-1 WARNING) control permanently dormant on origin/main.
- [NIT] web.change-dialog.test.js:103 — Guard skips (rather than bites) against any pre-fix reference whose message is not exactly 'Working…' (e.g. an ASCII-ellipsis old checkout). Cannot produce a false red; not a risk for the intended references (origin/main fixed; 8b52626d~1 uses U+2026). --> no action; minor robustness note.
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | web.change-dialog.test.js:103 | Control dormant on origin/main (always skips post-fix) | DEFERRED | Deliberate design choice; main test (line 74) is the live guard; pinning a sha rejected (shallow-clone skip risk). Documented in plan. |

### NITs (non-blocking, across all iterations)
- [NIT] web.change-dialog.test.js:102-103 — guard runs the flow before skipping; a removed function would RED (arguably desirable) (iter 1)
- [NIT] web.change-dialog.test.js:103 — guard skips vs bites on a non-'Working…' pre-fix reference; cannot false-red (iter 2)

### Strengths (across all iterations)
- Core logic correct: cannot bite-when-it-should-skip (a fixed reference produces the post-#768 message and skips) nor skip-when-it-should-bite for the intended pre-fix reference (msg stays 'Working…', so it asserts keep.hidden===true). Verified both arms: skips on current origin/main, bites on 8b52626d~1. (iters 1, 2)
- Behaviour guard is refactor-proof where the old source-string grep (`say(out.because || 'Changed.'`) went stale after #768 and produced the false red. (iters 1, 2)
- Scope clean: test-only, no touch to web/index.html or product code (avoids the #1720 web/ browser-check gate), main test untouched (no regression), U+2026 ellipsis consistent across all sites, no em dashes, plan file present with both verification arms and the weakest premise. (iters 1, 2)
